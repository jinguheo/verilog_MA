"""The read-only probe (tools/vvirt/probe/vb_probe.il) runs in the virtual Virtuoso and writes parseable JSON.

    PYTHONPATH=tools/vvirt/src python3 tools/vvirt/tests/test_probe.py

This checks the probe's own logic (escaping, errset per section, file writing) against vvirt. It says nothing about which
functions exist in a real Cadence installation; that is what running the probe there is for.
"""
import json
import os
import sys
import tempfile

ROOT = os.environ.get("VVIRT_ROOT", "/mnt/d/MyWork/Veriolg_MA")
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import skill_funcs  # noqa: E402
from vvirt.odb import Database  # noqa: E402
from vvirt.skill_lang import Interp  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402

checks = []


def check(name, ok, detail=""):
    checks.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def main() -> int:
    ws = tempfile.mkdtemp(prefix="probe_")
    os.makedirs(ws + "/_out")
    it = Interp()
    db = Database(ws + "/libs", StdCellLib())
    skill_funcs.install(it, db, ws + "/_out")
    out = ws + "/_out/probe"
    il = open(ROOT + "/tools/vvirt/probe/vb_probe.il", encoding="utf-8").read()
    # a small user cell with shapes (the virtual Virtuoso exposes PDK masters without ~>shapes)
    it.eval_text(f'ddCreateLib("ulib" "{ws}/libs/ulib")')
    it.eval_text('let((cv) cv = dbOpenCellViewByType("ulib" "ucell" "layout" "maskLayout" "a") '
                 'dbCreateRect(cv list("met1" "drawing") list(list(0 0) list(1 1))) '
                 'dbCreateRect(cv list("met2" "drawing") list(list(0 0) list(2 1))) dbSave(cv) dbClose(cv))')
    pre = f'vbpOut = "{out}"\nvbpLib = "ulib"\nvbpCell = "ucell"\nvbpMax = 5\n'
    it.eval_text(pre + il)
    summary = it.eval_text("vbpRun()")
    print("summary:", summary)
    secs = ["functions", "libraries", "cells", "tech", "cell"]
    docs = {}
    for s in secs:
        p = f"{out}/probe_{s}.json"
        ok = os.path.isfile(p)
        if ok:
            try:
                docs[s] = json.load(open(p, encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                ok = False
                print("  parse error", s, exc)
        check(f"probe_{s}.json written and parses", ok)
    st = {s: d.get("status") for s, d in docs.items()}
    print("skill status per section:", st)
    if "functions" in docs and docs["functions"]["status"] == "ok":
        ex = {d["name"]: d["exists"] for d in docs["functions"]["data"]}
        check("functions: existence is reported per name", "ddGetLibList" in ex and ex["ddGetLibList"] is True, f"{sum(ex.values())}/{len(ex)} exist")
        check("functions: a missing function is reported as false, not an error", ex.get("techDumpTechFile") is False)
    if "libraries" in docs and docs["libraries"]["status"] == "ok":
        names = [d["name"] for d in docs["libraries"]["data"]]
        check("libraries: sky130_fd_sc_hd and the user library listed", "sky130_fd_sc_hd" in names and "ulib" in names, ",".join(names[:4]))
    if "cells" in docs and docs["cells"]["status"] == "ok":
        d = docs["cells"]["data"]
        check("cells: total counted", d["total"] == 1 and d["listed"] == 1 and d["names"] == ["ucell"], f"total {d['total']} listed {d['listed']}")
    if "cell" in docs:
        check("cell: section status ok", docs["cell"]["status"] == "ok")
        if docs["cell"]["status"] == "ok":
            d = docs["cell"]["data"]
            check("cell: bBox + layer/purpose counts", len(d["bBox"]) == 2 and d["shapeCount"] == 2 and sorted(k["key"] for k in d["shapesByLayerPurpose"]) == ["met1/drawing", "met2/drawing"],
                  f"{d['shapeCount']} shapes, {len(d['shapesByLayerPurpose'])} layer/purpose keys")
    # a section that fails inside the probe must not stop the others
    it.eval_text('vbpLib = "no_such_lib"')
    it.eval_text("vbpRun()")
    bad = json.load(open(f"{out}/probe_cell.json", encoding="utf-8"))
    check("failing section is recorded as status=error and the run continues", bad["status"] == "error" and os.path.isfile(f"{out}/probe_functions.json"))
    print(f"{sum(checks)}/{len(checks)} checks passed")
    return 0 if all(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
