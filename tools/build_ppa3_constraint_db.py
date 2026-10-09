#!/usr/bin/env python3
"""Build a provenance-aware PPA3 PDK/library placement catalog. Run in WSL."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / "samples/sample_test_4/asic/ppa3_adc_capture"
EFFECTIVE = DESIGN / "runs/RUN_2026-09-24_14-07-59/06-yosys-synthesis/config.json"
DESIGN_CONFIG = DESIGN / "config_antfix5.json"
DRC_KNOWLEDGE = ROOT / "physical_design/layout_candidates/drc_knowledge.json"
OUTPUT = ROOT / "physical_design/layout_candidates/ppa3_constraint_knowledge.json"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_tech_site(path: Path, name: str) -> dict:
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"(?ms)^SITE\s+{re.escape(name)}\s*$.*?^\s*SIZE\s+([\d.]+)\s+BY\s+([\d.]+)\s*;.*?^END\s+{re.escape(name)}\s*$",
        text,
    )
    if not match:
        raise ValueError(f"Could not find placement site {name} in {path}")
    return {"name": name, "width_um": float(match.group(1)), "height_um": float(match.group(2)), "source": str(path)}


def lef_catalog(path: Path, site_width: float) -> dict[str, dict]:
    text = path.read_text(encoding="utf-8")
    result = {}
    starts = list(re.finditer(r"(?m)^MACRO\s+(\S+)\s*$", text))
    for start in starts:
        name = start.group(1)
        ending = re.search(rf"(?m)^END\s+{re.escape(name)}\s*$", text[start.end():])
        if ending is None:
            raise ValueError(f"Unterminated LEF macro {name} in {path}")
        body = text[start.end():start.end() + ending.start()]
        size = re.search(r"\bSIZE\s+([\d.]+)\s+BY\s+([\d.]+)\s*;", body)
        if not size:
            raise ValueError(f"No SIZE for {name} in {path}")
        width, height = float(size.group(1)), float(size.group(2))
        class_match = re.search(r"\bCLASS\s+([^;]+)\s*;", body)
        pin_names = re.findall(r"(?m)^\s*PIN\s+(\S+)\s*$", body)
        result[name] = {
            "width_um": width,
            "height_um": height,
            "site_widths": round(width / site_width, 6),
            "class": class_match.group(1).strip() if class_match else None,
            "pins": pin_names,
            "source_lef": str(path),
        }
    return result


def liberty_areas(path: Path) -> dict[str, dict]:
    text = path.read_text(encoding="utf-8")
    starts = list(re.finditer(r"\bcell\s*\(\s*\"?([^\"\)]+)\"?\s*\)\s*\{", text))
    result = {}
    for index, match in enumerate(starts):
        # The first cell-level area/dont_use attributes precede nested timing tables.
        body = text[match.end():starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        area = re.search(r"(?m)^\s*area\s*:\s*([\d.eE+-]+)\s*;", body)
        dont_use = re.search(r"(?m)^\s*dont_use\s*:\s*(true|false)\s*;", body)
        if area:
            result[match.group(1)] = {
                "area_um2": float(area.group(1)),
                "dont_use": dont_use.group(1) == "true" if dont_use else False,
            }
    return result


def source(path: Path, field: str | None = None) -> dict:
    result = {"file": str(path), "exists": path.exists()}
    if field:
        result["field"] = field
    return result


def main() -> None:
    effective = read_json(EFFECTIVE)
    design = read_json(DESIGN_CONFIG)
    pdk_root = Path(effective["PDK_ROOT"])
    if not pdk_root.exists():
        raise RuntimeError(f"PDK path not accessible: {pdk_root}. Run this script inside WSL.")
    site_name = effective["PLACE_SITE"]
    tech_lef = Path(effective["TECH_LEFS"]["nom_*"])
    site = parse_tech_site(tech_lef, site_name)
    catalog = {}
    for path_text in effective["CELL_LEFS"]:
        catalog.update(lef_catalog(Path(path_text), site["width_um"]))
    typical_key = "*_tt_025C_1v80"
    typical_paths = [Path(value) for value in effective["LIB"][typical_key]]
    liberty_catalog = {}
    for path in typical_paths:
        liberty_catalog.update(liberty_areas(path))
    for name, cell in catalog.items():
        if name in liberty_catalog:
            cell["liberty_tt"] = liberty_catalog[name]
    macros = {}
    for module, definition in design["MACROS"].items():
        lef_ref = definition["lef"][0]
        lef_path = (DESIGN / lef_ref[5:]).resolve()
        master = lef_catalog(lef_path, site["width_um"])
        if module not in master:
            raise ValueError(f"Missing {module} from {lef_path}")
        macros[module] = master[module]
        macros[module]["instances"] = {
            instance: settings["location"]
            for instance, settings in definition["instances"].items()
        }
    drc = read_json(DRC_KNOWLEDGE) if DRC_KNOWLEDGE.exists() else {}
    observed_rules = sorted({
        rule
        for item in drc.get("observations", [])
        for rule in (item.get("magic_rule_counts") or {})
    })
    magic_deck = pdk_root / "sky130A/libs.tech/magic/sky130A.tech"
    deck_text = magic_deck.read_text(encoding="utf-8")
    boundary_rules = {}
    for rule_id in ("nwell.4", "LU.2", "LU.3"):
        match = re.search(rf'"([^"\n]*\({re.escape(rule_id)}\))"', deck_text)
        if not match:
            raise ValueError(f"Expected Magic rule {rule_id} missing from {magic_deck}")
        description = match.group(1)
        threshold = re.search(r"<\s*([\d.]+)um", description)
        boundary_rules[rule_id] = {
            "description": description,
            "threshold_um": float(threshold.group(1)) if threshold else None,
            "deck_line": deck_text.count("\n", 0, match.start()) + 1,
            "source": str(magic_deck),
            "status": "pdk_deck_rule_not_yet_candidate_specific",
        }
    result = {
        "schema_version": 1,
        "design": design["DESIGN_NAME"],
        "pdk": {
            "name": effective["PDK"],
            "root": str(pdk_root),
            "version": pdk_root.name,
            "standard_cell_library": effective["STD_CELL_LIBRARY"],
        },
        "placement": {
            "site": site,
            "tapcell_dist_config_um": {
                "value": effective.get("FP_TAPCELL_DIST"),
                "source": source(EFFECTIVE, "FP_TAPCELL_DIST"),
            },
            "welltap_cell": effective.get("WELLTAP_CELL"),
            "endcap_cell": effective.get("ENDCAP_CELL"),
            "filler_cell_patterns": effective.get("FILL_CELL"),
            "decap_cell_order": effective.get("DECAP_CELL"),
            "macro_row_halo_um": {
                "value": 10.0,
                "status": "inferred_from_baseline_cutrows_not_universal_pdk_rule",
                "source": "ppa3_antfix5_signoff final DEF cut-row calibration",
            },
            "target_density_pct": {
                "value": design.get("PL_TARGET_DENSITY_PCT"),
                "status": "placer_target_not_minimum_required_whitespace",
                "source": source(DESIGN_CONFIG, "PL_TARGET_DENSITY_PCT"),
            },
        },
        "timing_and_power": {
            "clock_period_ns": design.get("CLOCK_PERIOD"),
            "clock_uncertainty_ns": effective.get("CLOCK_UNCERTAINTY_CONSTRAINT"),
            "clock_transition_ns": effective.get("CLOCK_TRANSITION_CONSTRAINT"),
            "max_capacitance": effective.get("MAX_CAPACITANCE_CONSTRAINT"),
            "output_cap_load": effective.get("OUTPUT_CAP_LOAD"),
            "pdn_macro_connections": design.get("PDN_MACRO_CONNECTIONS"),
            "corner_liberties": effective["LIB"],
            "note": "Library area and pin data are indexed; actual timing legality requires STA for each candidate.",
        },
        "drc": {
            "magic_deck": source(magic_deck),
            "observed_rule_ids": observed_rules,
            "macro_boundary_relevant_rules": boundary_rules,
            "note": "Magic deck values are not reduced to guessed thresholds. Evaluate exact DRC for promoted candidates.",
        },
        "cells": catalog,
        "macros": macros,
        "sources": {
            "effective_openlane_config": source(EFFECTIVE),
            "design_config": source(DESIGN_CONFIG),
            "tech_lef": source(tech_lef),
            "cell_lefs": [source(Path(value)) for value in effective["CELL_LEFS"]],
            "typical_liberties": [source(path) for path in typical_paths],
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Indexed {len(catalog)} LEF cells, {len(liberty_catalog)} Liberty cells, {len(macros)} macros.")


if __name__ == "__main__":
    main()
