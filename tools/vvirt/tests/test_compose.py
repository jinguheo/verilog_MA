"""compose: spec -> abutted library cells + routing -> GDS/LEF/Verilog + review list.

    PYTHONPATH=tools/vvirt/src python3 tools/vvirt/tests/test_compose.py

Runs with drc=False (the official KLayout deck is a separate, slow step); geometry checks inside compose still run.
"""
import json
import os
import sys
import tempfile

ROOT = os.environ.get("VVIRT_ROOT", "/mnt/d/MyWork/Veriolg_MA")
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import compose  # noqa: E402

checks = []


def check(name, ok, detail=""):
    checks.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def main() -> int:
    spec = ROOT + "/tools/vvirt/examples/specs/dff_en.json"
    out = tempfile.mkdtemp(prefix="compose_")
    res = compose.build(spec, out, drc=False)
    check("name from spec", res.name == "custom_dff_en", res.name)
    check("both instances placed", len(res.placed) == 2, str(len(res.placed)))
    check("height is one std-cell row", abs(res.height - compose.ROW_H) < 1e-6, str(res.height))
    check("width is a whole number of sites", abs(res.width / compose.SITE_W - round(res.width / compose.SITE_W)) < 1e-6, str(res.width))
    check("routing produced shapes", len(res.wires) > 0, str(len(res.wires)))
    check("no error-severity review item", not [i for i in res.items if i.severity == "error"],
          str([i.msg for i in res.items if i.severity == "error"]))
    for f in ("custom_dff_en.gds", "custom_dff_en.lef", "custom_dff_en.v", "review.json", "review.md", "review.svg"):
        p = os.path.join(out, f)
        check("wrote " + f, os.path.isfile(p) and os.path.getsize(p) > 0)
    v = open(os.path.join(out, "custom_dff_en.v")).read()
    check("verilog keeps spec instance names", "u_mux" in v and "u_dff" in v)
    check("review.json parses", isinstance(json.load(open(os.path.join(out, "review.json"))), (dict, list)))
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
