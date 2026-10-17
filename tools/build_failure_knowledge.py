"""Build physical_design/layout_candidates/failure_knowledge.json from the real daq_subsystem OpenLane run folders.

    python tools/build_failure_knowledge.py            # rewrite the JSON
    python tools/build_failure_knowledge.py --check    # exit 1 if the JSON on disk differs from what the run folders give

Everything under "verified" is read from files in the run folders (resolved.json placements, error.log, stage directories, final/metrics.json).
Claims that exist only in NEXT_SESSION.md notes are kept under "notes_only" and are never used by a rule. Rules (nogoods) are curated here
and may be enforce="reject" only when a pass and a fail bracket the feature value.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import failure_knowledge as fk  # noqa: E402

RUNS_DIR = ROOT / "samples" / "sample_test_4" / "asic" / "daq_subsystem" / "runs"
OUT = fk.KNOWLEDGE
DESIGN = "daq_subsystem"
KEY_STAGES = ("openroad-resizertimingpostcts", "openroad-globalrouting")

RUNS = [
    ("daq-grid-baseline-20260924", "hierarchical_auto_20260924_142552", "config_hierarchical.json", "grid baseline (rows y=100/1200, channel 300 um)"),
    ("daq-grid-baseline-20260925-interrupted", "hierarchical_auto_20260925_193305", "config_hierarchical.json", "same grid placement, rerun that stopped at stage 36 with no error"),
    ("daq-macrotetris-v1-20260925", "macrotetris_20260925_203844", "config_hierarchical_macrotetris.json", "bottom row moved up 200 um: channel 300 -> 100 um"),
    ("daq-macrotetris-v1-20260926-interrupted", "macrotetris_20260926_124029", "config_hierarchical_macrotetris.json", "same as v1, rerun that stopped at stage 12 with no error"),
    ("daq-macrotetris-v2-20260926", "macrotetris_v2_20260926_133315", "config_hierarchical_macrotetris_v2.json", "scattered non-grid 8-macro candidate from the parallel search"),
]

# Claims known only from NEXT_SESSION.md (2026-09-25/26/27 session); not re-verifiable in the current run folders.
NOTES_ONLY = {
    "daq-macrotetris-v1-20260925": [
        "ResizerTimingPostCTS hold repair: 6301 hold violations, 300 hold buffers could not be legally placed ([DPL-0034]/[DPL-0036])",
        "the run was resumed twice by different sessions after the host slept; it failed identically both times",
        "the earlier usableLeftoverPct metric (42%, 154 cells) was identical for this candidate and the baseline, so it could not tell them apart",
    ],
    "daq-macrotetris-v2-20260926": [
        "model weighted wirelength 55,752 vs 59,600 for the grid baseline (lower on paper)",
        "the model's congestion heuristic (congestionCells/routabilityRisk) flagged both this candidate and the passing grid baseline as HIGH",
    ],
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def stage_dirs(run: Path) -> list[str]:
    return sorted((p.name for p in run.iterdir() if p.is_dir() and re.match(r"^\d+-", p.name)), key=lambda n: int(n.split("-", 1)[0]))


def stage_name(directory: str) -> str:
    return directory.split("-", 1)[1]


def metrics_subset(run: Path) -> dict | None:
    path = run / "final" / "metrics.json"
    if not path.exists():
        return None
    m = read_json(path)
    keys = {
        "setup_ws_ns": "timing__setup__ws", "setup_tns_ns": "timing__setup__tns", "setup_violations": "timing__setup_vio__count",
        "hold_ws_ns": "timing__hold__ws", "hold_violations": "timing__hold_vio__count", "route_drc_errors": "route__drc_errors",
        "antenna_violating_nets": "antenna__violating__nets", "lvs_error_count": "design__lvs_error__count",
        "stdcell_area_um2": "design__instance__area__stdcell", "route_wirelength_um": "route__wirelength",
    }
    return {out: m.get(src) for out, src in keys.items()}


def build_record(record_id: str, tag: str, config: str, label: str) -> dict:
    run = RUNS_DIR / tag
    resolved = read_json(run / "resolved.json")
    placements = []
    for definition in resolved.get("MACROS", {}).values():
        for instance, p in definition.get("instances", {}).items():
            placements.append({"instance": instance, "x": float(p["location"][0]), "y": float(p["location"][1]), "orientation": p.get("orientation", "N")})
    placements.sort(key=lambda p: p["instance"])
    stages = stage_dirs(run)
    error = (run / "error.log").read_text(encoding="utf-8", errors="replace").strip() if (run / "error.log").exists() else ""
    has_final = (run / "final").is_dir()
    last = stages[-1] if stages else None
    if has_final and last and stage_name(last).startswith("misc-reportmanufacturability"):
        status = "completed_flow"
    elif error:
        status = "failed"
    else:
        status = "incomplete_no_error"
    stage_outcomes = {}
    names = [stage_name(s) for s in stages]
    for key in KEY_STAGES:
        if key not in names:
            stage_outcomes[key] = "not_reached"
        elif status == "completed_flow":
            stage_outcomes[key] = "pass"
        elif last and stage_name(last) == key:
            stage_outcomes[key] = "fail" if status == "failed" else "interrupted"
        else:
            stage_outcomes[key] = "pass"
    return {
        "id": record_id, "design": DESIGN, "flow": "OpenLane 2.3.10 hierarchical P&R, 8 hardened chan_top macros",
        "run_tag": tag, "run_dir": str(run.relative_to(ROOT)).replace("\\", "/"), "config": config, "description": label,
        "die_um": resolved.get("DIE_AREA"), "placement": placements, "features": fk.daq_features(placements),
        "status": status, "last_stage": last, "stages_present": len(stages),
        "error_log": error or None, "error_codes": re.findall(r"\[([A-Z]{3}-\d{4})\]", error),
        "stage_outcomes": stage_outcomes,
        "metrics": metrics_subset(run),
        "evidence": {"verified": ["resolved.json placements", "stage directory listing", "error.log"] + (["final/metrics.json"] if has_final else []),
                     "notes_only": NOTES_ONLY.get(record_id, [])},
        "usable_as_label": status in {"completed_flow", "failed"},
    }


def curated_nogoods(records: list[dict]) -> list[dict]:
    by = {r["id"]: r for r in records}
    base, v1, v2 = by["daq-grid-baseline-20260924"], by["daq-macrotetris-v1-20260925"], by["daq-macrotetris-v2-20260926"]
    return [
        {
            "id": "daq-row-channel-min-300", "design": DESIGN,
            "condition": {"feature": "row_channel_um", "op": "<", "value": 300.0},
            "enforce": "reject",
            "effect": "Hold-repair buffers cannot be legalized in the narrowed channel: [DPL-0036] Detailed placement failed at ResizerTimingPostCTS",
            "contrast": "clean_pair_two_points",
            "evidence": {"pass": [{"record": base["id"], "row_channel_um": base["features"]["row_channel_um"]}],
                         "fail": [{"record": v1["id"], "row_channel_um": v1["features"]["row_channel_um"], "error_codes": v1["error_codes"]}]},
            "unresolved": "The pass/fail boundary lies somewhere between 100 and 300 um. 300 is only the smallest value seen to pass; the rule may be stricter than needed.",
            "mirrors": "CHANNEL_SAFE_MARGIN = 300 in my_dashboard/src/game/macroTetrisModel.ts",
        },
        {
            "id": "daq-scattered-global-route-congestion", "design": DESIGN,
            "condition": {"feature": "topology", "op": "==", "value": "scattered"},
            "enforce": "record_only",
            "effect": "Global routing failed with [GRT-0118] Routing congestion too high / [GRT-0097] at OpenROAD.GlobalRouting",
            "contrast": "single_failure",
            "evidence": {"pass": [], "fail": [{"record": v2["id"], "topology": v2["features"]["topology"], "error_codes": v2["error_codes"]}]},
            "unresolved": "Only one scattered candidate was run and it failed. Nothing separates it from the passing grid baseline except the layout itself; "
                          "the model's congestion heuristic rated both HIGH, so it cannot be used as a gate yet. Needs a pass/fail pair along a single changed factor.",
        },
    ]


def next_experiments() -> list[dict]:
    return [
        {"id": "bisect-row-channel", "design": DESIGN, "purpose": "locate the hold-repair legalization boundary between 100 and 300 um",
         "vary": "row_channel_um", "keep_fixed": "grid topology, macro order, die", "suggested_values_um": [200], "then": [150, 250],
         "stop_after_stage": "openroad-resizertimingpostcts", "why_this_one": "uses the only clean pass/fail contrast we have; 3-4 runs instead of a random search"},
        {"id": "interpolate-grid-to-v2", "design": DESIGN, "purpose": "find where congestion starts when moving from the passing grid to the failing scattered candidate",
         "vary": "fraction of macros displaced toward the v2 positions", "keep_fixed": "channel >= 300 um", "suggested_values": [0.25, 0.5, 0.75],
         "stop_after_stage": "openroad-globalrouting", "why_this_one": "creates the missing pass/fail pair for the congestion rule"},
    ]


def build() -> dict:
    records = [build_record(*r) for r in RUNS]
    return {
        "schema_version": 1, "design": DESIGN,
        "description": "Real OpenLane outcomes for daq_subsystem macro placements and the rules derived from them. See failure_knowledge.py.",
        "records": records, "nogoods": curated_nogoods(records), "next_experiments": next_experiments(),
        "related": {"ppa3_adc_capture_top": "physical_design/layout_candidates/drc_knowledge.json (avoid_patterns, read by failure_knowledge.py)"},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if a.check:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == text
        print("up to date" if ok else "DIFFERS from run folders")
        return 0 if ok else 1
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(data['records'])} records, {len(data['nogoods'])} rules, generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    for r in data["records"]:
        print(f"  {r['id']:42} {r['status']:20} channel={r['features']['row_channel_um']} topo={r['features']['topology']} stages={r['stages_present']} errors={r['error_codes']} outcomes={r['stage_outcomes']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
