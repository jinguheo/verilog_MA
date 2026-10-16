"""Round-trip an externally produced GDS through a Virtuoso tech and report what changed.

    (in WSL)  PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/roundtrip_check.py <in.gds> [--top CELL] [--limit N] [--json OUT]

in.gds (external placement/routing result)  ->  import into a user library (the tech's layer map decides what survives)
  ->  export again  ->  structure-by-structure compare against in.gds.
Anything dropped, remapped, moved or snapped shows up as added/removed shapes per layer/datatype, plus the layers the import skipped.

This runs against the vvirt virtual Virtuoso (sky130A tech tables in vvirt.layers). Against a real Virtuoso the same two steps are
a stream-in with that library's tech file and layer map, then a stream-out with the same map; feed the second GDS to
`vvGdsCompare` (or gds_report.compare) the same way. The virtual run only measures the virtual tech, not the Cadence one.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

ROOT = os.environ.get("VVIRT_ROOT", "/mnt/d/MyWork/Veriolg_MA")
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import gds_report, skill_funcs  # noqa: E402
from vvirt.odb import Database  # noqa: E402
from vvirt.skill_lang import Interp  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402


def _d(x):
    """vvirt records are lists of [key, value] pairs; turn them into dicts for reporting."""
    if isinstance(x, list) and x and all(isinstance(i, list) and len(i) == 2 and isinstance(i[0], str) for i in x):
        return {k: _d(v) for k, v in x}
    if isinstance(x, list):
        return [_d(i) for i in x]
    return x


def roundtrip(gds_in: str, top: str | None, limit: int) -> dict:
    ws = tempfile.mkdtemp(prefix="rt_")
    os.makedirs(ws + "/_out")
    it = Interp()
    db = Database(ws + "/libs", StdCellLib())
    skill_funcs.install(it, db, ws + "/_out")
    it.eval_text(f'ddCreateLib("rt" "{ws}/libs/rt")')
    topq = f' "{top}"' if top else ""
    imp = _d(it.eval_text(f'vvImportGds("rt" "{gds_in}"{topq})'))
    top = top or gds_report._tops(gds_report._load(gds_in)[1])[0]
    out = ws + "/_out/after.gds"
    it.eval_text(f'vvExportGds("rt" "{top}" "{out}")')
    cmp = _d(gds_report.compare(gds_in, out, top, limit))
    ch = cmp.get("changed") or cmp.get("structuresChanged") or []
    return {"top": top, "imported": {k: imp[k] for k in ("cells", "shapes", "instances", "skippedShapes", "skippedLayers")},
            "identical": cmp.get("identical"), "changed": ch, "after": out}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gds")
    ap.add_argument("--top")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--json")
    a = ap.parse_args()
    r = roundtrip(a.gds, a.top, a.limit)
    txt = json.dumps(r, indent=1, default=str)
    print(txt)
    if a.json:
        open(a.json, "w", encoding="utf-8").write(txt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
