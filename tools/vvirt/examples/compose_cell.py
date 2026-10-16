"""Compose a custom standard cell from library cells, outside Virtuoso.

    (in WSL)  PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/compose_cell.py <spec.json> [--out DIR] [--no-drc]

Writes <out>/<name>.gds .lef .v and review.json / review.md / review.svg. Spec example: tools/vvirt/examples/specs/dff_en.json
"""
import argparse
import os
import sys

ROOT = os.environ.get("VVIRT_ROOT", "/mnt/d/MyWork/Veriolg_MA")
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import compose  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--out", default=ROOT + "/tools/vvirt/workspace/_out/compose")
    ap.add_argument("--no-drc", action="store_true")
    a = ap.parse_args()
    res = compose.build(a.spec, a.out, drc=not a.no_drc)
    sev = {}
    for i in res.items:
        sev[i.severity] = sev.get(i.severity, 0) + 1
    print(f"{res.name}: {res.width:.2f} x {res.height:.2f} um, {len(res.placed)} cells, {len(res.wires)} wire shapes -> {a.out}")
    print("review items:", sev or "none")
    for i in sorted(res.items, key=lambda i: {"error": 0, "check": 1, "info": 2}[i.severity])[:25]:
        print(f"  [{i.severity}] {i.kind}: {i.msg}" + ("" if i.bbox is None else f" @ {tuple(round(v, 2) for v in i.bbox)}"))
    return 1 if sev.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
