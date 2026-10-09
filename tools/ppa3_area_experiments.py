#!/usr/bin/env python3
"""Prepare PPA3 variable-die candidates and collect DRC experience; never runs OpenLane."""
from __future__ import annotations

import argparse
import copy
import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "samples/sample_test_4/asic/ppa3_adc_capture"
SOURCE = DESIGN / "config_antfix5.json"
SOURCE_FULL = DESIGN / "config_antfix4.json"
RUNS = DESIGN / "runs"
KNOWLEDGE = ROOT / "physical_design/layout_candidates/drc_knowledge.json"
MANIFEST = DESIGN / "area_candidates_manifest.json"
CONSTRAINTS = ROOT / "physical_design/layout_candidates/ppa3_constraint_knowledge.json"
ADC = "u_adc"
SRAM = "u_capture_path.u_capture.u_capture_sram.u_sram22"
BASE_AREA = 1250 * 600
SITE_W, ROW_H, HALO = 0.46, 2.72, 10.0
CORE_L, CORE_B, CORE_R_INSET, CORE_T_INSET = 20.24, 21.76, 20.42, 20.64
MAX_XML_BYTES = 10_000_000

# Deliberately span compact, aspect-ratio exchange, and vertical stacking.
# All candidates move the ADC away from the observed 9.76 um left row fragment.
SPECS = [
    ("compact-balanced", 1230, 580, (30.24, 150), (430, 65)),
    ("compact-limit", 1225, 556, (30.24, 150), (430, 65)),
    ("wide-short", 1250, 571, (30.24, 150), (430, 65)),
    ("narrow-tall", 1210, 590, (30.24, 150), (405, 65)),
    ("left-shift-compact", 1180, 585, (30.24, 150), (375, 65)),
    ("wide-low", 1260, 550, (30.24, 140), (430, 50)),
    ("vertical-stack", 830, 850, (30.24, 525), (30.24, 32)),
    ("vertical-relaxed", 840, 860, (30.24, 535), (30.24, 32)),
]

HYPOTHESES = {
    "compact-balanced": "Moderate shrink + remove the observed ADC left fragment; first tap/PDN check.",
    "compact-limit": "Probe the fixed-placement halo boundary; high edge-access risk, not a first full-flow run.",
    "wide-short": "Near-equal-area aspect-ratio alternative to compact-balanced; test vertical row capacity.",
    "narrow-tall": "Near-equal-area narrow alternative with SRAM shifted left; test macro channel and pins.",
    "left-shift-compact": "More x compaction; test SRAM pin access and inter-macro routing.",
    "wide-low": "More y compaction with SRAM moved down; test bottom pin escape and PDN.",
    "vertical-stack": "Alternative topology with narrow vertical channel; high information, high risk.",
    "vertical-relaxed": "Vertical topology with larger channel; test whether reorientation beats horizontal packing.",
}
INITIAL_SHORTLIST = ["compact-balanced", "wide-low", "vertical-relaxed"]

def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_generated(path: Path, data: str, *, allow_update: bool = False) -> None:
    """Preserve edited candidate configs; allow the generated manifest to refresh."""
    if path.exists():
        if path.read_text(encoding="utf-8") == data:
            return
        if not allow_update:
            raise RuntimeError(f"Existing generated file differs; refusing overwrite: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data, encoding="utf-8")


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def lef_size(ref: str) -> tuple[float, float]:
    assert ref.startswith("dir::"), ref
    lef = (SOURCE.parent / ref[5:]).resolve()
    match = re.search(r"\bSIZE\s+([\d.]+)\s+BY\s+([\d.]+)\s*;", lef.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"No SIZE in {lef}")
    return float(match.group(1)), float(match.group(2))


def macro_dimensions(config: dict) -> dict[str, tuple[float, float]]:
    result = {}
    for definition in config["MACROS"].values():
        size = lef_size(definition["lef"][0])
        for instance in definition["instances"]:
            result[instance] = size
    return result


def row_sites(width: int, height: int, placed: dict, sizes: dict) -> int:
    """Cut-row/site model calibrated against the baseline final DEF."""
    rows = math.floor((height - CORE_T_INSET - CORE_B) / ROW_H + 1e-8)
    sites = math.floor((width - CORE_R_INSET - CORE_L) / SITE_W + 1e-8)
    total = 0
    for row in range(rows):
        y = CORE_B + row * ROW_H
        cuts = []
        for instance, (x, my) in placed.items():
            mw, mh = sizes[instance]
            if y + ROW_H <= my - HALO or y >= my + mh + HALO:
                continue
            start = max(0, math.floor((x - HALO - CORE_L) / SITE_W))
            stop = min(sites, math.ceil((x + mw + HALO - CORE_L) / SITE_W))
            cuts.append((start, stop))
        cursor = 0
        for start, stop in sorted(cuts) + [(sites, sites)]:
            total += max(0, start - cursor)
            cursor = max(cursor, stop)
    return total


def feature_values(placed: dict) -> dict:
    return {"adc_left_row_fragment_um": round(max(0.0, placed[ADC][0] - HALO - CORE_L), 3)}


def load_knowledge() -> dict:
    if KNOWLEDGE.exists():
        return read_json(KNOWLEDGE)
    return {
        "schema_version": 1,
        "design": "ppa3_adc_capture_top",
        "observations": [],
        "resolutions": [],
        "avoid_patterns": [{
            "id": "adc-left-fragment-antfix5",
            "rule": "nwell.4",
            "feature": "adc_left_row_fragment_um",
            "lower_exclusive": 9.5,
            "upper_inclusive": 10.0,
            "source_run": "ppa3_antfix5_signoff",
            "confidence": "observed_failure_not_proven_causal",
            "note": "The baseline ADC x=40 leaves a 9.76 um left row segment; do not repeat this exact geometry."
        }],
        "proposed_fixes": [{
            "id": "adc-left-to-core",
            "addresses": "adc-left-fragment-antfix5",
            "change": "Set ADC x=30.24 um so the left row fragment disappears.",
            "status": "unverified_until_same_scope_drc_and_lvs_pass"
        }]
    }


def avoid_hits(features: dict, db: dict) -> list[str]:
    hits = []
    for pattern in db.get("avoid_patterns", []):
        value = features.get(pattern.get("feature"))
        if value is None:
            continue
        if pattern["lower_exclusive"] < value <= pattern["upper_inclusive"]:
            hits.append(pattern["id"])
    return hits


def validate_geometry(width: int, height: int, placed: dict, sizes: dict) -> dict:
    margins = {}
    for instance, (x, y) in placed.items():
        mw, mh = sizes[instance]
        values = {
            "left": x - HALO - CORE_L,
            "bottom": y - HALO - CORE_B,
            "right": width - CORE_R_INSET - (x + mw + HALO),
            "top": height - CORE_T_INSET - (y + mh + HALO),
        }
        if min(values.values()) < -1e-6:
            raise ValueError(f"{instance} halo outside core for {width}x{height}: {values}")
        margins[instance] = {key: round(value, 3) for key, value in values.items()}
    ax, ay = placed[ADC]
    aw, ah = sizes[ADC]
    sx, sy = placed[SRAM]
    sw, sh = sizes[SRAM]
    if not (ax + aw <= sx or sx + sw <= ax or ay + ah <= sy or sy + sh <= ay):
        raise ValueError(f"Macros overlap in {width}x{height}")
    return margins


def generate() -> list[dict]:
    db = load_knowledge()
    constraints = read_json(CONSTRAINTS)
    site = constraints["placement"]["site"]
    if (site["width_um"], site["height_um"]) != (SITE_W, ROW_H):
        raise RuntimeError("Candidate grid disagrees with installed PDK placement site.")
    if constraints["placement"]["welltap_cell"] != "sky130_fd_sc_hd__tapvpwrvgnd_1":
        raise RuntimeError("Unexpected welltap cell; review candidate rules before generation.")
    source = read_json(SOURCE)
    full_source = read_json(SOURCE_FULL)
    sizes = macro_dimensions(source)
    original = {
        ADC: tuple(source["MACROS"]["sky130_ef_ip__adc3v_12bit"]["instances"][ADC]["location"]),
        SRAM: tuple(source["MACROS"]["sram22_1024x32m8w8"]["instances"][SRAM]["location"]),
    }
    baseline_sites = row_sites(1250, 600, original, sizes)
    if baseline_sites != 175564:
        raise RuntimeError(f"Cut-row calibration changed: {baseline_sites} != 175564")
    entries = []
    for name, width, height, adc_xy, sram_xy in SPECS:
        placed = {ADC: adc_xy, SRAM: sram_xy}
        margins = validate_geometry(width, height, placed, sizes)
        features = feature_values(placed)
        hits = avoid_hits(features, db)
        if hits:
            raise ValueError(f"{name} repeats observed failure: {hits}")
        config = copy.deepcopy(source)
        full_config = copy.deepcopy(full_source)
        for target in (config, full_config):
            target["DIE_AREA"] = [0, 0, width, height]
            target["CORE_AREA"] = [20, 20, width - 20, height - 20]
            target["MACRO_PLACEMENT_CFG"] = f"dir::area_candidate_{name}.cfg"
            for definition in target["MACROS"].values():
                for instance, settings in definition["instances"].items():
                    settings["location"] = list(placed[instance])
        full_config["MAGIC_DRC_USE_GDS"] = True
        cfg = DESIGN / f"area_candidate_{name}.cfg"
        config_file = DESIGN / f"area_candidate_{name}.json"
        full_file = DESIGN / f"area_candidate_{name}_full.json"
        placement_text = "".join(
            f"{instance} {placed[instance][0]:.3f} {placed[instance][1]:.3f} N\n"
            for instance in (ADC, SRAM)
        )
        write_generated(cfg, placement_text)
        write_generated(config_file, json_text(config))
        write_generated(full_file, json_text(full_config))
        area = width * height
        entries.append({
            "id": name,
            "status": "geometry_only_not_physically_verified",
            "die_um": [width, height],
            "area_um2": area,
            "area_reduction_pct": round((1 - area / BASE_AREA) * 100, 3),
            "macro_xy_um": {key: list(value) for key, value in placed.items()},
            "row_sites_estimate": row_sites(width, height, placed, sizes),
            "halo_to_core_margin_um": margins,
            "features": features,
            "knowledge_avoid_hits": hits,
            "hypothesis": HYPOTHESES[name],
            "first_round_shortlist": name in INITIAL_SHORTLIST,
            "screening_config": str(config_file.relative_to(ROOT)).replace("\\", "/"),
            "full_gds_drc_config": str(full_file.relative_to(ROOT)).replace("\\", "/"),
            "macro_placement": str(cfg.relative_to(ROOT)).replace("\\", "/"),
        })
    manifest = {
        "schema_version": 1,
        "screening_source_config": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "full_gds_source_config": str(SOURCE_FULL.relative_to(ROOT)).replace("\\", "/"),
        "baseline_die_um": [1250, 600],
        "baseline_area_um2": BASE_AREA,
        "baseline_def_row_sites": baseline_sites,
        "physical_runs_started": 0,
        "note": "Geometry-only candidates. ADC x-shift is a proposed fix, not a verified DRC resolution.",
        "constraint_db": str(CONSTRAINTS.relative_to(ROOT)).replace("\\", "/"),
        "pdk_version": constraints["pdk"]["version"],
        "first_round_shortlist": INITIAL_SHORTLIST,
        "shortlist_policy": "Three distinct hypotheses first; promote more candidates only when results change the constraint model.",
        "candidates": entries,
    }
    write_generated(MANIFEST, json_text(manifest), allow_update=True)
    return entries


def run_config(name: str) -> Path | None:
    if name in {"ppa3_antfix4_signoff", "ppa3_antfix5_signoff"}:
        path = DESIGN / f"config_{name.split('_')[1]}.json"
        return path if path.exists() else None
    for candidate_id, *_ in SPECS:
        if name.endswith(f"{candidate_id}_full"):
            path = DESIGN / f"area_candidate_{candidate_id}_full.json"
            return path if path.exists() else None
        if name.endswith(candidate_id):
            path = DESIGN / f"area_candidate_{candidate_id}.json"
            return path if path.exists() else None
    return None


def magic_rules(xml: Path) -> dict[str, int] | None:
    if not xml.exists() or xml.stat().st_size > MAX_XML_BYTES:
        return None
    counts: Counter[str] = Counter()
    for _, element in ET.iterparse(xml, events=("end",)):
        if element.tag == "item":
            category = element.findtext("category", "").strip("'")
            counts[category] += 1
            element.clear()
    return dict(sorted(counts.items()))


def observation(run: Path) -> dict | None:
    metrics_file = run / "final/metrics.json"
    completed = metrics_file.exists()
    if completed:
        metrics = read_json(metrics_file)
    else:
        states = sorted(run.glob("*-magic-drc/state_out.json"))
        if not states:
            return None
        metrics_file = states[-1]
        metrics = read_json(metrics_file).get("metrics", {})
    if not any(key in metrics for key in ("magic__drc_error__count", "route__drc_errors", "design__lvs_error__count")):
        return None
    cfg_path = run_config(run.name)
    if cfg_path is None:
        configs = sorted(run.glob("*-magic-drc/config.json"))
        cfg_path = configs[-1] if configs else None
    cfg = read_json(cfg_path) if cfg_path else {}
    drc_scope = "macro_abstracted" if cfg.get("MAGIC_DRC_USE_GDS") is False else (
        "gds_default" if cfg_path else "unknown"
    )
    reports = sorted(run.glob("*-magic-drc/reports/drc_violations.magic.xml"))
    xml = reports[-1] if reports else run / "missing-magic-drc.xml"
    rules = magic_rules(xml)
    drc = metrics.get("magic__drc_error__count")
    lvs = metrics.get("design__lvs_error__count")
    slew = metrics.get("design__max_slew_violation__count")
    cap = metrics.get("design__max_cap_violation__count")
    placements = {}
    for definition in cfg.get("MACROS", {}).values():
        for instance, settings in definition.get("instances", {}).items():
            placements[instance] = settings.get("location")
    return {
        "run": run.name,
        "status": "completed_measured_not_waived" if completed else "partial_drc_measured",
        "drc_scope": drc_scope,
        "die_area_um2": metrics.get("design__die__area"),
        "die_um": cfg.get("DIE_AREA", [None, None, None, None])[2:],
        "macro_xy_um": placements,
        "magic_drc_count": drc,
        "magic_rule_counts": rules,
        "magic_rule_detail_status": "parsed" if rules is not None else "unavailable_or_report_too_large",
        "route_drc_count": metrics.get("route__drc_errors"),
        "lvs_error_count": lvs,
        "max_slew_count": slew,
        "max_cap_count": cap,
        "full_pass": bool(completed and drc_scope == "gds_default" and drc == 0 and lvs == 0 and slew == 0 and cap == 0 and metrics.get("route__drc_errors") == 0),
        "sources": {
            "metrics": str(metrics_file.relative_to(ROOT)).replace("\\", "/"),
            "magic_xml": str(xml.relative_to(ROOT)).replace("\\", "/") if xml.exists() else None,
            "config": str(cfg_path.relative_to(ROOT)).replace("\\", "/") if cfg_path else None,
        }
    }


def collect() -> dict:
    db = load_knowledge()
    seen = {item["run"]: item for item in db.get("observations", [])}
    for run in sorted(RUNS.iterdir()):
        if run.is_dir():
            item = observation(run)
            if item:
                seen[item["run"]] = item
    db["observations"] = [seen[key] for key in sorted(seen)]
    KNOWLEDGE.parent.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE.write_text(json_text(db), encoding="utf-8")
    return db


def record_resolution(before: str, after: str, rule: str, change: str) -> dict:
    db = collect()
    indexed = {item["run"]: item for item in db["observations"]}
    if before not in indexed or after not in indexed:
        raise ValueError("Both runs need collected final metrics.")
    old, new = indexed[before], indexed[after]
    if old["drc_scope"] != new["drc_scope"] or old["drc_scope"] == "unknown":
        raise ValueError("DRC scopes differ or are unknown; cannot claim a resolution.")
    a = (old.get("magic_rule_counts") or {}).get(rule)
    b = (new.get("magic_rule_counts") or {}).get(rule)
    if a is None or b is None or a <= 0 or b != 0:
        raise ValueError("Need comparable per-rule reports with before > 0 and after = 0.")
    item = {
        "before_run": before, "after_run": after, "rule": rule,
        "before_count": a, "after_count": b,
        "change": change,
        "status": "observed_resolution_causality_not_proven",
        "drc_scope": old["drc_scope"],
    }
    if item not in db["resolutions"]:
        db["resolutions"].append(item)
        KNOWLEDGE.write_text(json_text(db), encoding="utf-8")
    return item


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("generate", help="prepare geometry-only candidate configs; no physical run")
    sub.add_parser("collect", help="ingest existing final DRC/LVS metrics, idempotently")
    fix = sub.add_parser("resolve", help="record a same-scope rule going from violations to zero")
    fix.add_argument("--before", required=True)
    fix.add_argument("--after", required=True)
    fix.add_argument("--rule", required=True)
    fix.add_argument("--change", required=True)
    args = parser.parse_args()
    if args.command == "generate":
        collect()
        entries = generate()
        print(f"Prepared {len(entries)} candidates; no OpenLane runs started.")
    elif args.command == "collect":
        db = collect()
        print(f"Collected {len(db['observations'])} run observations.")
    else:
        print(json_text(record_resolution(args.before, args.after, args.rule, args.change)))


if __name__ == "__main__":
    main()
