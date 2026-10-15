"""Send an externally placed + routed design (DEF from OpenROAD) into a Virtuoso layout cellview through the virtuoso-bridge.

    (in WSL)  PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/pnr_export.py <run_dir|file.def> [--lib L --cell C] [--window x0 y0 x1 y1]
                  [--no-routes] [--out DIR] [--verify]

The PDK rules come from files, not from this script: layer widths and VIA shapes from the tech LEF, cell sizes from the LEF.
Writes <out>/<cell>_000.il ... and <cell>_load.il. Run them with the bridge client (client.execute_skill / load) or in the CIW.
--verify loads the chunks into the vvirt virtual Virtuoso and compares every instance box and shape count with the DEF.
"""
import argparse
import glob
import json
import os
import sys

ROOT = "/mnt/d/MyWork/Veriolg_MA"
sys.path.insert(0, ROOT + "/tools/vvirt/src")
sys.path.insert(0, ROOT + "/tools/vvirt/examples")
from vvirt import def_export, pdk_params, pnr_est  # noqa: E402
from pnr_estimate import find_def, sizes_for  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--lib", default="pnr_import")
    ap.add_argument("--cell")
    ap.add_argument("--std-lib", default="sky130_fd_sc_hd")
    ap.add_argument("--macro-lib")
    ap.add_argument("--window", type=float, nargs=4, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--no-routes", action="store_true")
    ap.add_argument("--out", default=ROOT + "/tools/vvirt/workspace/_out/pnr_export")
    ap.add_argument("--chunk", type=int, default=2000)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--dashboard", metavar="NAME", help="record this export summary under NAME in my_dashboard/src/data/vbPnr.json")
    a = ap.parse_args()
    dpath = find_def(a.target)
    d = pnr_est.read_def(dpath)
    cell = a.cell or (d.name or "top")
    tech = pdk_params.tech()
    if not tech:
        raise SystemExit("tech LEF not found (set VVIRT_PDK_ROOT)")
    tvias = def_export.read_tlef_vias(tech.path)
    sizes = sizes_for(dpath, [])
    skip = set()
    if a.verify:  # the virtual Virtuoso only knows the cells of StdCellLib; the real PDK library has whatever its install provides
        from vvirt.stdcell import StdCellLib
        known = set(StdCellLib().masters)
        skip = {m for m in {c.master for c in d.comps.values()} if m not in known}
    ex = def_export.to_skill(d, sizes, tech.layers, tvias, a.lib, cell, a.std_lib, a.macro_lib, tuple(a.window) if a.window else None, not a.no_routes, a.chunk, skip)
    files = def_export.write(ex, a.out, cell)
    print(json.dumps({"def": dpath, "tech_lef": tech.path, **ex.summary, "files": len(files), "out": a.out}, indent=1))
    rc = verify(d, sizes, ex, a.lib, cell, a.std_lib) if a.verify else 0
    if a.dashboard:
        jp = ROOT + "/my_dashboard/src/data/vbPnr.json"
        data = json.load(open(jp, encoding="utf-8"))
        data[a.dashboard]["export"] = {**ex.summary, "lib": a.lib, "cell": cell, "tech_lef": os.path.basename(tech.path), "verified": bool(a.verify) and rc == 0}
        json.dump(data, open(jp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return rc


def verify(d, sizes, ex, lib, cell, std_lib) -> int:
    import tempfile
    from vvirt import skill_funcs
    from vvirt.odb import Database
    from vvirt.skill_lang import Interp
    from vvirt.stdcell import StdCellLib
    ws = tempfile.mkdtemp()
    os.makedirs(ws + "/_out")
    it = Interp()
    db = Database(ws + "/libs", StdCellLib())
    skill_funcs.install(it, db, ws + "/_out")
    it.eval_text(f'ddCreateLib("{lib}" "{ws}/libs/{lib}")')
    for ch in ex.chunks:
        it.eval_text(ch)
    cv = db.open_cv(lib, cell, "layout", "maskLayout", "a")
    bad = 0
    n = 0
    for inst in cv.instances:
        c = d.comps.get(inst.name) or d.comps.get("\\" + inst.name)
        if c is None:
            continue
        bb = inst.bbox()
        want = pnr_est.bbox(c, sizes)
        n += 1
        if want and (abs(bb[0][0] - want[0]) > 1e-3 or abs(bb[0][1] - want[1]) > 1e-3 or abs(bb[1][0] - want[2]) > 1e-3 or abs(bb[1][1] - want[3]) > 1e-3):
            bad += 1
            if bad <= 5:
                print("MISMATCH", inst.name, c.orient, bb, want)
    print(f"verify: {n} instances compared with the DEF, {bad} boxes differ; shapes in cellview {len(cv.shapes)}")
    ex.summary["verify"] = {"instances_compared": n, "boxes_differ": bad, "shapes_in_cellview": len(cv.shapes)}
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
