"""Build a PARSAC model from completed OpenLane macro runs."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re

SIZE_RE = re.compile(r"^\s*SIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)\s*;", re.MULTILINE)


def _relative(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _latest_complete_run(runs_dir: Path, module: str) -> tuple[Path, dict, Path]:
    candidates = []
    for run in sorted(runs_dir.glob("RUN_*"), reverse=True):
        metrics_path = run / "final" / "metrics.json"
        lef_path = run / "final" / "lef" / f"{module}.lef"
        gds_path = run / "final" / "gds" / f"{module}.gds"
        if metrics_path.is_file() and lef_path.is_file() and gds_path.is_file():
            candidates.append((run, metrics_path, lef_path))
    if not candidates:
        raise FileNotFoundError(f"No completed OpenLane run found for {module}: {runs_dir}")
    run, metrics_path, lef_path = candidates[0]
    return run, json.loads(metrics_path.read_text(encoding="utf-8")), lef_path


def _view(run: Path, kind: str, module: str, suffix: str) -> Path | None:
    path = run / "final" / kind / f"{module}.{suffix}"
    return path if path.is_file() else None


def _metric(metrics: dict, key: str):
    value = metrics.get(key)
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[2]
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    scale = int(manifest.get("units_per_micron", 10))
    margin = float(manifest.get("outline_area_margin", 1.55))
    blocks = []

    for item in manifest["blocks"]:
        module = item["module"]
        run, metrics, lef_path = _latest_complete_run(project_root / item["runs_dir"], module)
        match = SIZE_RE.search(lef_path.read_text(encoding="utf-8", errors="replace"))
        if not match:
            raise ValueError(f"LEF SIZE not found: {lef_path}")
        width_um, height_um = map(float, match.groups())
        views = {}
        for kind, suffix in (("lef", "lef"), ("gds", "gds"), ("def", "def"), ("nl", "nl.v"), ("pnl", "pnl.v"), ("json_h", "h.json")):
            path = _view(run, kind, module, suffix)
            if path:
                views[kind] = _relative(path, project_root)
        blocks.append({
            "name": item.get("name", module), "module": module, "instance": item["instance"],
            "width": max(1, round(width_um * scale)), "height": max(1, round(height_um * scale)),
            "width_um": width_um, "height_um": height_um, "edge": item.get("edge", 0),
            "group": item.get("group", 0), "fixed_aspect": True,
            "source_run": _relative(run, project_root), "views": views,
            "measured": {
                "instance_count": _metric(metrics, "design__instance__count"),
                "instance_area_um2": _metric(metrics, "design__instance__area"),
                "die_area_um2": _metric(metrics, "design__die__area"),
                "wirelength_um": _metric(metrics, "route__wirelength"),
                "power_total_w": _metric(metrics, "power__total"),
                "setup_wns_ns": _metric(metrics, "timing__setup__wns"),
                "hold_wns_ns": _metric(metrics, "timing__hold__wns"),
            },
        })

    area_um2 = sum(block["width_um"] * block["height_um"] for block in blocks)
    max_width = max(block["width_um"] for block in blocks)
    max_height = max(block["height_um"] for block in blocks)
    target_area = area_um2 * margin
    clearance_um = float(manifest.get("outline_clearance_um", 2.0))
    width_um = math.ceil(max(max_width * 1.25, math.sqrt(target_area)) + clearance_um)
    height_um = math.ceil(max(max_height * 1.25, target_area / width_um) + clearance_um)
    outline = {"width": width_um * scale, "height": height_um * scale,
               "width_um": width_um, "height_um": height_um, "unit": f"1/{scale} micrometer"}

    pins = []
    for pin in manifest.get("pins", []):
        side, offset = pin["side"].lower(), float(pin.get("offset", 0.5))
        if side == "left": x, y = 0, round(outline["height"] * offset)
        elif side == "right": x, y = outline["width"], round(outline["height"] * offset)
        elif side == "bottom": x, y = round(outline["width"] * offset), 0
        elif side == "top": x, y = round(outline["width"] * offset), outline["height"]
        else: raise ValueError(f"Unsupported pin side: {side}")
        pins.append({"name": pin["name"], "x": x, "y": y, "side": side})

    model = {
        "name": manifest["name"], "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Completed OpenLane final LEF/GDS/metrics",
        "connectivity_source": manifest.get("connectivity_source", "declared architecture manifest"),
        "coordinate_scale": {"units_per_micron": scale}, "seed": manifest.get("seed", 4400),
        "outline": outline, "blocks": blocks, "pins": pins, "nets": manifest["nets"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OPENLANE_MODEL={args.output}")
    for block in blocks:
        print(f"{block['name']}: {block['width_um']} x {block['height_um']} um ({block['source_run']})")


if __name__ == "__main__":
    main()
