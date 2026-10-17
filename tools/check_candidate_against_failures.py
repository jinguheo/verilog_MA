"""Check an OpenLane config's macro placement against the recorded real failures.

    python tools/check_candidate_against_failures.py samples/sample_test_4/asic/daq_subsystem/config_hierarchical_macrotetris.json
    python tools/check_candidate_against_failures.py <config.json> --json

Exit code 1 when a rule with enforce="reject" matches (the candidate repeats a bracketed real failure), 0 otherwise. Rules with
enforce="record_only" are printed as warnings and do not change the exit code.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import failure_knowledge as fk  # noqa: E402


def placements_from_config(config: dict) -> list[dict]:
    out = []
    for definition in config.get("MACROS", {}).values():
        for instance, p in definition.get("instances", {}).items():
            out.append({"instance": instance, "x": float(p["location"][0]), "y": float(p["location"][1]), "orientation": p.get("orientation", "N")})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    config = json.loads(Path(a.config).read_text(encoding="utf-8"))
    design = str(config.get("DESIGN_NAME", ""))
    result = fk.check_placements(design, placements_from_config(config))
    if a.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"design {design}: features {result['features']}")
        if not result["hits"]:
            print("no recorded failure rule matches")
        for h in result["hits"]:
            tag = "REJECT" if h["enforce"] == "reject" else "warn (record_only)"
            print(f"  [{tag}] {h['id']}: {h['feature']}={h['value']}  -> {h['effect']}  (contrast: {h['contrast']})")
    return 1 if result["rejected"] else 0


if __name__ == "__main__":
    sys.exit(main())
