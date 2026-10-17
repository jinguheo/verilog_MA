"""Failure experience store: real OpenLane outcomes -> checkable rules ("nogoods") for candidate generators.

Data file: physical_design/layout_candidates/failure_knowledge.json (written by tools/build_failure_knowledge.py from the real run folders).
The ppa3 DRC avoid pattern stays in drc_knowledge.json (single source) and is read from there.

A nogood may only be set to enforce="reject" when real runs bracket it (a pass and a fail that differ in the feature). A rule backed by a
single failure is enforce="record_only": it is reported to the person/agent but does not remove candidates, because one failure cannot say
where the boundary is. Features are computed here from placements so every generator and checker uses the same definition.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent
KNOWLEDGE = ROOT / "physical_design" / "layout_candidates" / "failure_knowledge.json"
DRC_KNOWLEDGE = ROOT / "physical_design" / "layout_candidates" / "drc_knowledge.json"

# ppa3_adc_capture_top row model constants; must equal HALO and CORE_L in tools/ppa3_area_experiments.py
PPA3_HALO_UM = 10.0
PPA3_CORE_LEFT_UM = 20.24
PPA3_ADC = "u_adc"
# daq_subsystem hardened chan_top macro footprint (MacroTetris HARD macros, real GDS)
DAQ_MACRO_UM = (800.0, 800.0)


# ---------------------------------------------------------------------------------------------------------------- features
def merged_intervals(macros: Iterable[dict], axis: str) -> list[list[float]]:
    """Project macros on an axis and merge overlapping intervals (mirror of mergedIntervals in macroTetrisModel.ts)."""
    spans = sorted(([m["y"], m["y"] + m["h"]] if axis == "y" else [m["x"], m["x"] + m["w"]]) for m in macros)
    merged: list[list[float]] = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return merged


def internal_projection_gaps(macros: list[dict]) -> tuple[list[float], str]:
    """Gaps between merged macro bands on the channel axis = the axis that splits the macros into FEWER groups (both if equal).

    Mirror of internalProjectionGaps in macroTetrisModel.ts. Edge margins at the die boundary are not channels and are excluded.
    """
    mx, my = merged_intervals(macros, "x"), merged_intervals(macros, "y")
    if len(mx) < len(my):
        picks, axis = [mx], "x"
    elif len(my) < len(mx):
        picks, axis = [my], "y"
    else:
        picks, axis = [mx, my], "both"
    gaps = [merged[i][0] - merged[i - 1][1] for merged in picks for i in range(1, len(merged))]
    return gaps, axis


def macros_from_placements(placements: Iterable[dict], size: tuple[float, float] = DAQ_MACRO_UM) -> list[dict]:
    return [{"instance": str(p["instance"]), "x": float(p["x"]), "y": float(p["y"]), "w": float(p.get("width", size[0])),
             "h": float(p.get("height", size[1])), "orientation": str(p.get("orientation", "N")).upper()} for p in placements]


def daq_features(placements: Iterable[dict], size: tuple[float, float] = DAQ_MACRO_UM) -> dict[str, Any]:
    """Features of a daq_subsystem macro placement used by the failure rules."""
    macros = macros_from_placements(placements, size)
    gaps, axis = internal_projection_gaps(macros)
    xs, ys = {round(m["x"], 3) for m in macros}, {round(m["y"], 3) for m in macros}
    topology = "grid" if len(xs) * len(ys) == len(macros) else "scattered"
    return {
        "row_channel_um": round(min(gaps), 3) if gaps else None,
        "channel_axis": axis,
        "band_counts": {"x": len(merged_intervals(macros, "x")), "y": len(merged_intervals(macros, "y"))},
        "topology": topology,
    }


def ppa3_features(placements: Iterable[dict]) -> dict[str, Any]:
    adc = next((p for p in placements if str(p["instance"]) == PPA3_ADC), None)
    if adc is None:
        return {}
    return {"adc_left_row_fragment_um": round(max(0.0, float(adc["x"]) - PPA3_HALO_UM - PPA3_CORE_LEFT_UM), 3)}


def features_for(design: str, placements: Iterable[dict]) -> dict[str, Any]:
    placements = list(placements)
    if design == "daq_subsystem":
        return daq_features(placements)
    if design == "ppa3_adc_capture_top":
        return ppa3_features(placements)
    return {}


# ---------------------------------------------------------------------------------------------------------------------- DB
def load_db(path: Path | None = None) -> dict:
    path = path or KNOWLEDGE
    if not path.exists():
        return {"schema_version": 1, "records": [], "nogoods": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _ppa3_avoid_nogoods() -> list[dict]:
    if not DRC_KNOWLEDGE.exists():
        return []
    out = []
    for pat in json.loads(DRC_KNOWLEDGE.read_text(encoding="utf-8")).get("avoid_patterns", []):
        out.append({
            "id": pat["id"], "design": "ppa3_adc_capture_top",
            "condition": {"feature": pat["feature"], "op": "open_closed", "lower": pat["lower_exclusive"], "upper": pat["upper_inclusive"]},
            "enforce": "reject", "effect": f"DRC {pat.get('rule', '?')} failure seen at this geometry ({pat.get('source_run', '?')})",
            "contrast": "single_observation_exact_geometry", "confidence": pat.get("confidence", ""), "source": "drc_knowledge.json",
            "note": pat.get("note", ""),
        })
    return out


def _matches(cond: dict, value: Any) -> bool:
    if value is None:
        return False
    op = cond["op"]
    if op == "<":
        return value < cond["value"]
    if op == "<=":
        return value <= cond["value"]
    if op == ">":
        return value > cond["value"]
    if op == ">=":
        return value >= cond["value"]
    if op == "==":
        return value == cond["value"]
    if op == "!=":
        return value != cond["value"]
    if op == "open_closed":
        return cond["lower"] < value <= cond["upper"]
    raise ValueError(f"unknown op {op}")


def all_rules(db: dict | None = None) -> list[dict]:
    """Every rule from failure_knowledge.json plus the ppa3 DRC avoid patterns. Load once and pass to hits(rules=...) in hot loops."""
    db = db if db is not None else load_db()
    return [*db.get("nogoods", []), *_ppa3_avoid_nogoods()]


def hits(design: str, features: dict[str, Any], db: dict | None = None, rules: list[dict] | None = None) -> list[dict]:
    """Rules of `design` whose condition holds for `features`. Each hit has id, enforce (reject|record_only), effect, contrast, evidence."""
    out = []
    for rule in (rules if rules is not None else all_rules(db)):
        if rule.get("design") != design:
            continue
        cond = rule["condition"]
        if _matches(cond, features.get(cond["feature"])):
            out.append({"id": rule["id"], "enforce": rule["enforce"], "effect": rule.get("effect", ""), "contrast": rule.get("contrast", ""),
                        "evidence": rule.get("evidence", {}), "feature": cond["feature"], "value": features.get(cond["feature"])})
    return out


def rejecting(found: list[dict]) -> list[dict]:
    return [h for h in found if h["enforce"] == "reject"]


def check_placements(design: str, placements: Iterable[dict], db: dict | None = None) -> dict:
    placements = list(placements)
    features = features_for(design, placements)
    found = hits(design, features, db)
    return {"design": design, "features": features, "hits": found, "rejected": bool(rejecting(found))}
