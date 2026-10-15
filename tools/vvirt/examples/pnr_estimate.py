"""Fast place-and-route estimate of an existing OpenLane/OpenROAD placement (no layout is created).

    (in WSL)  PYTHONPATH=tools/vvirt/src python3 tools/vvirt/examples/pnr_estimate.py <run_dir | file.def> [--compare other.def]
                  [--lef extra.lef ...] [--out DIR] [--name NAME]

<run_dir> is an OpenLane run folder: its final/def/*.def and the macro LEFs of its resolved.json are used.
Writes into --out (default tools/vvirt/workspace/_out/pnr):
    <name>.json       estimate + findings + suggested minimal ECO (+ diff when --compare is given)
    <name>.svg        placement with the findings drawn as an overlay
    <name>_overlay.il SKILL that draws the same findings as marker shapes - send it with the virtuoso-bridge client so the
                      person can overlay it on the real layout, review it and delete the markers
"""
import argparse
import glob
import json
import os
import sys
import time

ROOT = "/mnt/d/MyWork/Veriolg_MA"
sys.path.insert(0, ROOT + "/tools/vvirt/src")
from vvirt import conn_check, def_export, netlist, pdk_params, pnr_est, route_check  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402


def find_def(p: str) -> str:
    if os.path.isdir(p):
        c = glob.glob(os.path.join(p, "final", "def", "*.def"))
        if not c:
            raise SystemExit(f"no final/def/*.def in {p}")
        return c[0]
    return p


def find_netlist(target: str, explicit: str | None) -> str | None:
    if explicit:
        return explicit
    if os.path.isdir(target):
        c = sorted(glob.glob(os.path.join(target, "final", "nl", "*.nl.v")))
        return c[0] if c else None
    return None


def macro_lefs(defpath: str) -> list[str]:
    run = os.path.dirname(os.path.dirname(os.path.dirname(defpath)))
    res = os.path.join(run, "resolved.json")
    out: list[str] = []
    if os.path.exists(res):
        cfg = json.load(open(res, encoding="utf-8"))
        for m in (cfg.get("MACROS") or {}).values():
            out += [str(x) for x in (m.get("lef") or [])]
    return out


def sizes_for(defpath: str, extra: list[str]) -> dict:
    lib = StdCellLib()
    sizes = {n: (m.width, m.height) for n, m in lib.masters.items()}
    pdk_extra = []
    if lib.root:
        pdk_extra = glob.glob(os.path.join(lib.root, "libs.ref", "sky130_fd_sc_hd", "lef", "sky130_ef_sc_hd.lef"))
    sizes.update(pnr_est.read_lef_sizes(pdk_extra + macro_lefs(defpath) + extra))
    return sizes


def publish(name: str, res: dict, out: str) -> None:
    """Merge this run into my_dashboard/src/data/vbPnr.json and copy the svg / overlay script under public/vb/pnr (read by VbPnrEstimate.tsx)."""
    import shutil
    dash = ROOT + "/my_dashboard"
    os.makedirs(dash + "/public/vb/pnr", exist_ok=True)
    for ext in (".svg", "_overlay.il"):
        shutil.copy(os.path.join(out, name + ext), dash + "/public/vb/pnr/" + name + ext)
    jp = dash + "/src/data/vbPnr.json"
    data = json.load(open(jp, encoding="utf-8")) if os.path.exists(jp) else {}
    e = res["estimate"]
    data[name] = {"def": os.path.relpath(res["def"], ROOT).replace(os.sep, "/"), "seconds": res["seconds"], "stats": {k: v for k, v in e["stats"].items() if k != "longest_nets"},
                  "findings": [f for f in e["findings"] if f["kind"] != "congestion"][:40], "congestion": [f for f in e["findings"] if f["kind"] == "congestion"][:12],
                  "eco": res["eco"][:40], "rules": res["rules"], "route_check": e.get("route_check"), "connectivity": e.get("connectivity"), "longest_nets": e["stats"].get("longest_nets", [])[:5], "die": e["die"]}
    json.dump(data, open(jp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--compare")
    ap.add_argument("--lef", action="append", default=[])
    ap.add_argument("--out", default=ROOT + "/tools/vvirt/workspace/_out/pnr")
    ap.add_argument("--name")
    ap.add_argument("--lu", type=float, help="override the latch-up distance read from the PDK (um)")
    ap.add_argument("--lib", default="testlib", help="library of the cellview the markers are drawn into (open the real layout cell there)")
    ap.add_argument("--cell", help="cell the markers are drawn into (default <name>_overlay)")
    ap.add_argument("--netlist", help="structural Verilog netlist to check the DEF connectivity against (default: final/nl/*.nl.v of a run folder)")
    ap.add_argument("--no-netlist", action="store_true", help="skip the netlist-versus-DEF connectivity check")
    ap.add_argument("--dashboard", action="store_true", help="also publish json + svg + overlay for the dashboard VB tab")
    a = ap.parse_args()
    dpath = find_def(a.target)
    name = a.name or os.path.basename(os.path.normpath(a.target)).replace(".def", "")
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    d = pnr_est.read_def(dpath)
    t1 = time.time()
    sizes = sizes_for(dpath, a.lef)
    pp = pdk_params.read(run_dir=os.path.dirname(os.path.dirname(os.path.dirname(dpath))))
    est = pnr_est.estimate(d, sizes, lu_um=a.lu if a.lu else pp["lu_um"], site_um=pp["site_um"], row_um=pp["row_um"])
    est["rules"] = pp
    if d.routed:  # routing rules (spacing / shorts) from the tech LEF
        tl = pdk_params.tech()
        if tl:
            rc = route_check.check(d, tl.layers, def_export.read_tlef_vias(tl.path), def_export.def_via_shapes)
            est["route_check"] = {"counts": rc["counts"], "layers_checked": rc["layers_checked"], "tech_lef": os.path.basename(tl.path)}
            est["findings"] += rc["findings"]
    nlpath = None if a.no_netlist else find_netlist(a.target, a.netlist)
    if nlpath:
        try:
            est["connectivity"] = conn_check.check(d, netlist.load(nlpath, power_pins={"VPWR", "VGND", "VPB", "VNB"}))
            est["connectivity"]["netlist"] = os.path.relpath(nlpath, ROOT).replace(os.sep, "/")
        except netlist.NetlistError as exc:
            est["connectivity"] = {"error": str(exc), "netlist": nlpath}
    t2 = time.time()
    eco = pnr_est.suggest_eco(d, sizes, est)
    res = {"name": name, "def": dpath, "seconds": {"read": round(t1 - t0, 2), "estimate": round(t2 - t1, 2)}, "rules": pp, "estimate": est, "eco": eco, "routed": d.routed}
    if a.compare:
        d2 = pnr_est.read_def(find_def(a.compare))
        res["diff"] = pnr_est.diff(d, d2, sizes)
    json.dump(res, open(os.path.join(a.out, name + ".json"), "w", encoding="utf-8"), indent=1)
    pnr_est.overlay_svg(d, sizes, est, os.path.join(a.out, name + ".svg"))
    open(os.path.join(a.out, name + "_overlay.il"), "w", encoding="utf-8").write(pnr_est.overlay_skill(est["findings"], cell=a.cell or name + "_overlay", lib=a.lib))
    if a.dashboard:
        publish(name, res, a.out)
    s = est["stats"]
    print(f"{name}: read {t1 - t0:.1f}s + estimate {t2 - t1:.1f}s | comps {s['components']} unknown masters {sum(s['unknown_masters'].values())}")
    print(f"  overlaps {s['overlaps']}  off-grid {s['off_grid']}  utilisation {s['utilization'] * 100:.1f}%  max bin density {s['max_bin_density']:.2f}")
    print(f"  HPWL {s['hpwl_um'] / 1000:.1f} mm over {s['nets']} nets" + (f"  routed {s['routed_um'] / 1000:.1f} mm ({s['routed_over_hpwl']:.2f} x HPWL, {s['vias']} vias)" if 'routed_um' in s else ""))
    print(f"  taps {s['taps']}  rows with tap-far points: {s['tap_far_rows']}  RUDY hot bins {s.get('rudy_hot_bins', 0)}")
    for f in est["findings"]:
        if f["severity"] == "error":
            print("  ERROR", f["kind"], [round(v, 1) for v in f["bbox"]], f["msg"])
            break
    if "route_check" in est:
        print(f"  route check ({est['route_check']['tech_lef']}): shorts {est['route_check']['counts']['short']}  spacing {est['route_check']['counts']['spacing']}  layers {len(est['route_check']['layers_checked'])}")
    cc = est.get("connectivity")
    if cc and "error" in cc:
        print(f"  connectivity: netlist not read ({cc['error']})")
    elif cc:
        i, n = cc["instances"], cc["nets"]
        print(f"  connectivity vs {os.path.basename(cc['netlist'])}: instances netlist {i['netlist']} / def {i['def']} (physical-only {i['physical_only_in_def']}), only-netlist {i['only_in_netlist_count']}, only-def {i['only_in_def_count']}, master mismatch {i['master_mismatch_count']}")
        print(f"    nets equal {n['equal']}/{n['def_checked']}  open {n['open']}  short {n['short']}  unknown pins {n['unknown_pins']}  absent from def {n['netlist_nets_absent_from_def']}  -> {'consistent' if cc['clean'] else 'DIFFERENCES'}")
    print(f"  findings {len(est['findings'])}  suggested ECO edits {len(eco)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
