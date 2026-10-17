"""Remove duplicate candidates from physical_design/layout_candidates/optimization_history.json.

    python tools/dedup_candidate_history.py                 # dry run: print what would be kept and dropped
    python tools/dedup_candidate_history.py --apply         # rewrite the history, archive the dropped entries
    python tools/dedup_candidate_history.py --tol-rel 5 --tol-abs 5 --keep-per-class 1

Entries are ranked best first (lowest search.cost, then earliest) and the first of each class stays as the representative. Dropped entries are
NOT lost: they are appended to optimization_history_duplicates.json with the representative id and the reason, and each kept entry records
`equivalent_count` and `equivalents` (signature + reason). Re-running is idempotent.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import candidate_dedup as dd  # noqa: E402

HISTORY = ROOT / "physical_design" / "layout_candidates" / "optimization_history.json"
ARCHIVE = HISTORY.with_name("optimization_history_duplicates.json")


def rank_key(entry: dict):
    return (entry.get("search", {}).get("cost", float("inf")), entry.get("created_at", ""))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--tol-rel", type=float, default=dd.DEFAULT_TOL_REL)
    ap.add_argument("--tol-abs", type=float, default=dd.DEFAULT_TOL_ABS)
    ap.add_argument("--keep-per-class", type=int, default=1)
    a = ap.parse_args()
    history = json.loads(HISTORY.read_text(encoding="utf-8"))
    ranked = sorted(history, key=rank_key)
    kept, dropped = dd.dedupe(ranked, tol_rel=a.tol_rel, tol_abs=a.tol_abs, keep_per_class=a.keep_per_class)
    reasons = Counter(d["reason"] for d in dropped)
    print(f"{len(history)} entries -> keep {len(kept)}, drop {len(dropped)} {dict(reasons)}  (tol_rel={a.tol_rel} um, tol_abs={a.tol_abs} um)")
    verified = [e for e in history if e.get("verification")]
    print(f"physically verified entries before: {len(verified)}")
    for e in kept:
        n = sum(1 for d in dropped if d["representative"]["id"] == e["id"])
        print(f"  keep {e['id']}  cost={e.get('search', {}).get('cost')}  arrangement={dd.relative_signature(e['placements'])}  (+{n} equivalents)")
    if not a.apply:
        print("dry run: nothing written (use --apply)")
        return 0
    equivalents: dict[str, list[dict]] = {}
    for d in dropped:
        equivalents.setdefault(d["representative"]["id"], []).append({"id": d["entry"]["id"], "signature": d["entry"]["signature"], "reason": d["reason"]})
    new_history = []
    for e in history:  # keep original chronological order
        if any(e["id"] == k["id"] for k in kept):
            e = dict(e)
            extra = equivalents.get(e["id"], [])
            e["equivalent_count"] = int(e.get("equivalent_count", 0)) + len(extra)
            e["equivalents"] = (e.get("equivalents", []) + extra)[:20]
            new_history.append(e)
    archived = json.loads(ARCHIVE.read_text(encoding="utf-8")) if ARCHIVE.exists() else []
    have = {x["entry"]["id"] for x in archived}
    for d in dropped:
        if d["entry"]["id"] not in have:
            archived.append({"entry": d["entry"], "representative_id": d["representative"]["id"], "reason": d["reason"]})
    ARCHIVE.write_text(json.dumps(archived, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    HISTORY.write_text(json.dumps(new_history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {HISTORY.name} ({len(new_history)} entries) and {ARCHIVE.name} ({len(archived)} archived)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
