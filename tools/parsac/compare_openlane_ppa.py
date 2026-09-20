"""Report measured PPA comparison readiness or compare two OpenLane metrics files."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


FIELDS = {
    "area_um2": "design__instance__area",
    "wirelength_um": "route__wirelength",
    "power_w": "power__total",
    "setup_wns_ns": "timing__setup__wns",
    "hold_wns_ns": "timing__hold__wns",
}


def _metrics(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {name: raw.get(key) for name, key in FIELDS.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline-metrics", type=Path)
    parser.add_argument("--parsac-metrics", type=Path)
    args = parser.parse_args()
    result = json.loads(args.result.read_text(encoding="utf-8"))
    blocks = result["best"]["blocks"]
    measured = {
        "instance_area_um2": sum((block.get("measured") or {}).get("instance_area_um2") or 0 for block in blocks),
        "block_die_area_um2": sum((block.get("measured") or {}).get("die_area_um2") or 0 for block in blocks),
        "block_wirelength_um": sum((block.get("measured") or {}).get("wirelength_um") or 0 for block in blocks),
        "block_power_w": sum((block.get("measured") or {}).get("power_total_w") or 0 for block in blocks),
    }
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "component_signoff_actuals": measured,
        "parsac_floorplan": {
            "seed": result["best"]["seed"], "cost": result["best"]["cost"],
            "placement_validation": result.get("placement_validation"),
        },
    }
    if args.baseline_metrics and args.parsac_metrics:
        baseline, candidate = _metrics(args.baseline_metrics), _metrics(args.parsac_metrics)
        report.update({"status": "compared", "baseline": baseline, "parsac": candidate,
                       "delta": {key: (candidate[key] - baseline[key]) if candidate[key] is not None and baseline[key] is not None else None for key in FIELDS}})
    else:
        report.update({
            "status": "awaiting_hierarchical_openlane_runs",
            "reason": "The three hardened blocks are not peers in the current RTL hierarchy; a baseline and a PARSAC-constrained run of the same hierarchical top do not exist yet.",
            "required_next": [
                "Create or select a hierarchical top whose direct instances match u_chan_ctrl, u_cnt_sat, and u_skid_buffer.",
                "Run OpenLane once with baseline macro placement and once with the generated PARSAC macro placement.",
                "Pass both final/metrics.json files to this script.",
            ],
        })
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"PPA_REPORT={args.output}")
    print(f"STATUS={report['status']}")


if __name__ == "__main__":
    main()
