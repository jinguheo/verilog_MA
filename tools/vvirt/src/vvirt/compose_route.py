"""Detailed routing of a composed cell with OpenROAD (met1-met3), used by vvirt.compose.

The abutted library cells are FIXED components of a one-row DEF, the cell's ports are met3 pin bars, and OpenROAD routes the nets
with the PDK tech LEF + cell LEF (so pin access, spacing and via rules come from the PDK files, not from this code).
The routed DEF is turned back into rectangles (wires from the tech LEF widths, vias from the tech LEF VIA shapes).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile

OPENROAD_DEFAULT = "/nix/store/zzypcxbrgw1qink1l7fwgwpbk7fvdwpg-openroad/bin/openroad"
SITE_W = 0.46
GRID = 0.005


def g(v: float) -> float:
    return round(round(v / GRID) * GRID, 4)


def dbu(v: float) -> int:
    return int(round(v * 1000))


def find_openroad() -> str | None:
    for c in (os.environ.get("VVIRT_OPENROAD"), shutil.which("openroad"), OPENROAD_DEFAULT):
        if c and os.path.exists(c):
            return c
    return None


def _ov(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def port_boxes(width: float, nets: dict, ports: dict, pinxy: dict) -> tuple[dict, list[str]]:
    """port -> (net, (x0, y0, x1, y1)): a 0.8 x 0.30 met3 bar on a met3 track (pitch 0.68), near the mean x of the net's cell pins."""
    ytracks = [0.34, 1.02, 1.70, 2.38]
    placed: list[tuple] = []
    out: dict = {}
    errs: list[str] = []
    for net, refs in nets.items():
        for r in refs:
            if not r.startswith("port:"):
                continue
            p = r[5:]
            xs = [pinxy[q][1] for q in refs if q in pinxy]
            cx = sum(xs) / len(xs) if xs else width / 2
            done = False
            for dx in [0.0] + [s * k * 0.46 for k in range(1, 12) for s in (1, -1)]:
                x = min(max(g(round((cx + dx) / 0.23) * 0.23), 0.4), width - 0.4)
                for yt in ytracks:
                    bx = (g(x - 0.4), g(yt - 0.15), g(x + 0.4), g(yt + 0.15))
                    if all(not _ov((bx[0] - 0.3, bx[1] - 0.3, bx[2] + 0.3, bx[3] + 0.3), q) for q in placed):
                        placed.append(bx)
                        out[p] = (net, bx)
                        done = True
                        break
                if done:
                    break
            if not done:
                errs.append(f"no free met3 track for port {p}")
    return out, errs


def write_def(name: str, width: float, height: float, placed, tech, ports: dict, port_dir: dict, nets: dict, pinxy: dict, path: str) -> None:
    W, H = dbu(width), dbu(height)
    L = ["VERSION 5.8 ;", 'DIVIDERCHAR "/" ;', 'BUSBITCHARS "[]" ;', f"DESIGN {name} ;", "UNITS DISTANCE MICRONS 1000 ;",
         f"DIEAREA ( 0 0 ) ( {W} {H} ) ;", f"ROW ROW_0 unithd 0 0 N DO {int(round(width / SITE_W))} BY 1 STEP {dbu(SITE_W)} 0 ;"]
    for lname, tl in tech.layers.items():
        if tl.type != "ROUTING" or tl.pitch is None:
            continue
        off = tl.offset if tl.offset is not None else tl.pitch / 2
        # OpenROAD wants a track grid in both directions for every routing layer (the preferred one first)
        xs = f"TRACKS X {dbu(off)} DO {int((width - off) / tl.pitch) + 1} STEP {dbu(tl.pitch)} LAYER {lname} ;"
        ys = f"TRACKS Y {dbu(off)} DO {int((height - off) / tl.pitch) + 1} STEP {dbu(tl.pitch)} LAYER {lname} ;"
        L += [xs, ys] if tl.direction == "V" else [ys, xs]
    L.append(f"COMPONENTS {len(placed)} ;")
    for n, m, x in placed:
        L.append(f"- {n} {m} + FIXED ( {dbu(x)} 0 ) N ;")
    L += ["END COMPONENTS", f"PINS {len(ports)} ;"]
    for p, (net, bx) in ports.items():
        cx, cy = dbu((bx[0] + bx[2]) / 2), dbu((bx[1] + bx[3]) / 2)
        d = {"input": "INPUT", "output": "OUTPUT"}.get(port_dir[p].lower(), "INOUT")
        L.append(f"- {p} + NET {net} + DIRECTION {d} + USE SIGNAL + LAYER met3 ( {dbu(bx[0]) - cx} {dbu(bx[1]) - cy} ) "
                 f"( {dbu(bx[2]) - cx} {dbu(bx[3]) - cy} ) + FIXED ( {cx} {cy} ) N ;")
    L.append("END PINS")
    routable = []
    for n, refs in nets.items():
        terms = []
        for r in refs:
            if r.startswith("port:"):
                terms.append(f"( PIN {r[5:]} )")
            elif r in pinxy:
                i, _, pn = r.partition(".")
                terms.append(f"( {i} {pn} )")
        if len(terms) >= 2:
            routable.append(f"- {n} " + " ".join(terms) + " + USE SIGNAL ;")
    L += [f"NETS {len(routable)} ;"] + routable + ["END NETS", "END DESIGN", ""]
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(L))


def route(name: str, width: float, height: float, placed, ports: dict, port_dir: dict, nets: dict, pinxy: dict, pdk_root: str, libname: str):
    """Run OpenROAD. Returns (rects, notes) with rects = [(layer, x0, y0, x1, y1, net)] and notes = [(severity, message)]."""
    from . import def_export, pnr_est, techlef

    notes: list[tuple[str, str]] = []
    orb = find_openroad()
    tpath = techlef.find_tlef(pdk_root)
    if not orb or not tpath:
        return [], [("error", "routing not run: OpenROAD or the tech LEF was not found (set VVIRT_OPENROAD / VVIRT_PDK_ROOT)")]
    tech = techlef.parse(tpath)
    wd = tempfile.mkdtemp(prefix="cmproute_")
    dpath = os.path.join(wd, "in.def")
    write_def(name, width, height, placed, tech, ports, port_dir, nets, pinxy, dpath)
    lef = os.path.join(pdk_root, "libs.ref", libname, "lef", libname + ".lef")
    tcl = os.path.join(wd, "r.tcl")
    with open(tcl, "w") as fh:
        fh.write(f"read_lef {tpath}\nread_lef {lef}\nread_def {dpath}\n"
                 "set_routing_layers -signal met1-met3\nglobal_route -allow_congestion\n"
                 f"detailed_route -bottom_routing_layer met1 -top_routing_layer met3 -output_drc {wd}/drc.rpt\n"
                 f"write_def {wd}/out.def\nexit\n")
    proc = subprocess.run([orb, "-no_splash", "-exit", tcl], capture_output=True, text=True, timeout=600, cwd=wd)
    log = os.path.join(wd, "log.txt")
    with open(log, "w") as fh:
        fh.write(proc.stdout + proc.stderr)
    out = os.path.join(wd, "out.def")
    if not os.path.exists(out):
        return [], [("error", "OpenROAD produced no routed DEF; see " + log)]
    d = pnr_est.read_def(out)
    vias = def_export.read_tlef_vias(tpath)
    rects: list = []
    for nm, net in d.nets.items():
        for lay, x0, y0, x1, y1 in net.segs:
            w = tech.layers[lay].width or 0.14
            rects.append((lay, g(min(x0, x1) - w / 2), g(min(y0, y1) - w / 2), g(max(x0, x1) + w / 2), g(max(y0, y1) + w / 2), nm))
        for lay, x0, y0, x1, y1 in net.rects:
            rects.append((lay, g(x0), g(y0), g(x1), g(y1), nm))
        for vn, vx, vy in net.via_at:
            sh = vias.get(vn) or (def_export.def_via_shapes(d.vias[vn]) if vn in d.vias else [])
            if not sh:
                notes.append(("check", f"via {vn} has no shape definition; skipped at ({vx:.2f}, {vy:.2f})"))
            for lay, a0, b0, a1, b1 in sh:
                rects.append((lay, g(vx + a0), g(vy + b0), g(vx + a1), g(vy + b1), nm))
    for nm, refs in nets.items():
        n_term = len([x for x in refs if x.startswith("port:") or x in pinxy])
        if n_term >= 2 and not (d.nets.get(nm) and (d.nets[nm].segs or d.nets[nm].via_at)):
            notes.append(("error", f"net {nm} was not routed (OpenROAD log: {log})"))
    m = re.search(r"Number of violations\s*=\s*(\d+)", proc.stdout)
    if m and int(m.group(1)):
        notes.append(("check", f"OpenROAD detailed route reports {m.group(1)} violations (see {wd}/drc.rpt)"))
    return rects, notes
