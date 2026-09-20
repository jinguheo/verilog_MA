"""Convert a PARSAC result to OpenLane 2 macro configuration files."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def _overlap(a: dict, b: dict) -> bool:
    return not (
        a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
        or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"]
    )


def _dir_path(path_text: str, output_dir: Path, project_root: Path) -> str:
    absolute = project_root / path_text
    relative = Path("../../../") / absolute.relative_to(project_root)
    return "dir::" + relative.as_posix()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[2]
    result = json.loads(args.result.read_text(encoding="utf-8"))
    scale = int((result.get("coordinate_scale") or {}).get("units_per_micron", 1))
    outline = result["outline"]
    blocks = result["best"]["blocks"]

    errors = []
    for block in blocks:
        if block["x"] < 0 or block["y"] < 0:
            errors.append(f"{block['instance']} has a negative coordinate")
        if block["x"] + block["width"] > outline["width"] or block["y"] + block["height"] > outline["height"]:
            errors.append(f"{block['instance']} exceeds the floorplan boundary")
    for index, first in enumerate(blocks):
        for second in blocks[index + 1:]:
            if _overlap(first, second):
                errors.append(f"{first['instance']} overlaps {second['instance']}")
    if errors:
        raise ValueError("Invalid PARSAC placement: " + "; ".join(errors))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    placement_path = args.output_dir / "macro_placement.cfg"
    placement_lines = [
        f"{block['instance']} {block['x'] / scale:.3f} {block['y'] / scale:.3f} N"
        for block in blocks
    ]
    placement_path.write_text("\n".join(placement_lines) + "\n", encoding="utf-8")

    macros = {}
    for block in blocks:
        views = block["views"]
        entry = {
            "instances": {
                block["instance"]: {
                    "location": [round(block["x"] / scale, 3), round(block["y"] / scale, 3)],
                    "orientation": "N",
                }
            },
            "lef": [_dir_path(views["lef"], args.output_dir, project_root)],
            "gds": [_dir_path(views["gds"], args.output_dir, project_root)],
        }
        for source_key, openlane_key in (("nl", "nl"), ("pnl", "pnl"), ("json_h", "json_h")):
            if source_key in views:
                entry[openlane_key] = [_dir_path(views[source_key], args.output_dir, project_root)]
        macros[block["module"]] = entry

    config = {
        "MACRO_PLACEMENT_CFG": "dir::macro_placement.cfg",
        "MACROS": macros,
        "PARSAC_PROVENANCE": {
            "source_result": args.result.name,
            "seed": result["best"]["seed"],
            "outline_um": [outline["width"] / scale, outline["height"] / scale],
            "validation": "boundary and pairwise overlap checks passed",
        },
    }
    config_path = args.output_dir / "openlane_macros.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"MACRO_PLACEMENT={placement_path}")
    print(f"OPENLANE_MACROS={config_path}")
    print("PLACEMENT_VALIDATION=passed")


if __name__ == "__main__":
    main()
