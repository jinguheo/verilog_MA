"""Duplicate detection for macro-placement candidates.

Why this exists: the optimizer's cost for the recorded estimate (ADC-SRAM Manhattan distance) depends only on the RELATIVE arrangement
of the macros. In physical_design/layout_candidates/optimization_history.json 25 stored candidates were exact-distinct placements but
only 3 distinct relative arrangements (15 were translations of one arrangement), and none had ever been physically verified. Running
translations of one arrangement through an expensive flow adds almost no information about the arrangement itself.

Two levels of "same":
  near_identical        every macro is within `tol_abs` of the other candidate's position (rounding / 1 um SA jitter)
  translation_equivalent the arrangement relative to a reference macro matches within `tol_rel` but absolute positions differ

Matching is done against class representatives (never transitively), so tolerance cannot chain-drift. Orientation must match.
The representative is the first entry in the order given, so pass entries best-first (lowest cost / earliest verified).
"""
from __future__ import annotations

from typing import Any, Callable, Iterable

DEFAULT_TOL_REL = 5.0
DEFAULT_TOL_ABS = 5.0


def _items(placements: Iterable[dict]) -> list[dict]:
    items = sorted(placements, key=lambda p: str(p["instance"]))
    if not items:
        raise ValueError("placements must not be empty")
    return items


def relative_offsets(placements: Iterable[dict]) -> dict[str, tuple[float, float, str]]:
    """instance -> (dx, dy, orientation) relative to the first instance by name; translation-invariant."""
    items = _items(placements)
    x0, y0 = float(items[0]["x"]), float(items[0]["y"])
    return {str(p["instance"]): (float(p["x"]) - x0, float(p["y"]) - y0, str(p.get("orientation", "N")).upper()) for p in items}


def relative_signature(placements: Iterable[dict], *, grid: float = 1.0) -> str:
    """Stable text key of the relative arrangement (rounded to `grid`). Exact-match key only; use `same_class` for tolerance matching."""
    parts = []
    for instance, (dx, dy, orient) in relative_offsets(placements).items():
        parts.append(f"{instance}:{round(dx / grid) * grid:.3f}:{round(dy / grid) * grid:.3f}:{orient}")
    return "|".join(parts)


def _same_instances(a: dict, b: dict) -> bool:
    return set(a) == set(b)


def classify(a: Iterable[dict], b: Iterable[dict], *, tol_rel: float = DEFAULT_TOL_REL, tol_abs: float = DEFAULT_TOL_ABS) -> str:
    """'near_identical' | 'translation_equivalent' | 'distinct' for two placements of the same macro set."""
    pa, pb = {str(p["instance"]): p for p in a}, {str(p["instance"]): p for p in b}
    if not _same_instances(pa, pb):
        return "distinct"
    for k in pa:
        if str(pa[k].get("orientation", "N")).upper() != str(pb[k].get("orientation", "N")).upper():
            return "distinct"
    ra, rb = relative_offsets(pa.values()), relative_offsets(pb.values())
    if any(abs(ra[k][0] - rb[k][0]) > tol_rel or abs(ra[k][1] - rb[k][1]) > tol_rel for k in ra):
        return "distinct"
    if all(abs(float(pa[k]["x"]) - float(pb[k]["x"])) <= tol_abs and abs(float(pa[k]["y"]) - float(pb[k]["y"])) <= tol_abs for k in pa):
        return "near_identical"
    return "translation_equivalent"


def dedupe(entries: list[dict], *, placements_of: Callable[[dict], list[dict]] = lambda e: e["placements"],
           tol_rel: float = DEFAULT_TOL_REL, tol_abs: float = DEFAULT_TOL_ABS, keep_per_class: int = 1) -> tuple[list[dict], list[dict]]:
    """Split `entries` (best first) into (kept, dropped).

    Each dropped record is {"entry", "representative", "reason"}. A class holds the representative plus up to `keep_per_class - 1`
    translation-equivalent members (near-identical ones are always dropped). keep_per_class=1 keeps one entry per relative arrangement.
    """
    classes: list[dict[str, Any]] = []
    kept: list[dict] = []
    dropped: list[dict] = []
    for entry in entries:
        pl = placements_of(entry)
        home = None
        reason = "distinct"
        for cls in classes:
            r = classify(placements_of(cls["rep"]), pl, tol_rel=tol_rel, tol_abs=tol_abs)
            if r != "distinct":
                home, reason = cls, r
                break
        if home is None:
            classes.append({"rep": entry, "members": [entry]})
            kept.append(entry)
            continue
        near_any = any(classify(placements_of(m), pl, tol_rel=tol_rel, tol_abs=tol_abs) == "near_identical" for m in home["members"])
        if near_any or len(home["members"]) >= keep_per_class:
            dropped.append({"entry": entry, "representative": home["rep"], "reason": "near_identical" if near_any else reason})
        else:
            home["members"].append(entry)
            kept.append(entry)
    return kept, dropped


def find_equivalent(placements: list[dict], existing: list[dict], *, placements_of: Callable[[dict], list[dict]] = lambda e: e["placements"],
                    tol_rel: float = DEFAULT_TOL_REL, tol_abs: float = DEFAULT_TOL_ABS) -> tuple[dict | None, str]:
    """First existing entry whose placement is near-identical or translation-equivalent to `placements`, with the reason."""
    for entry in existing:
        r = classify(placements_of(entry), placements, tol_rel=tol_rel, tol_abs=tol_abs)
        if r != "distinct":
            return entry, r
    return None, "distinct"
