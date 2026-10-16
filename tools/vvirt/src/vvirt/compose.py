"""Compose a new standard cell from library cells, entirely outside Virtuoso.

    spec (json) -> abutted row of library cells -> met2/met3 routing inside the cell box -> GDS + LEF + Verilog
                -> checks (library fit, geometry connectivity vs spec, boundary, official DRC) -> review list + overlay

The result is meant to be finished by a person in Virtuoso, so the output keeps the hierarchy (one SREF per library cell, the
spec's instance names), names every net and pin, and lists every place a human should look (`review.json` / `review.md` /
`review.svg`, each item with a bounding box in cell coordinates, um).

Routing is a deliberately small design: every pin gets a via stack to met3, a vertical met3 stub, and one met2 trunk per net on a
free track (left-edge assignment). It is not a general router; what it cannot do cleanly it reports as review items.
Rules used (sky130A): met2/met3 width, pad size and pitch below; the official KLayout deck is the judge, not these constants.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field

from . import layers
from .gdsio import write_gds
from .stdcell import StdCellLib

GRID = 0.005
SITE_W = 0.46
ROW_H = 2.72
TRUNK_W = 0.14
STUB_W = 0.30
PAD = 0.30
CUT = {"mcon": 0.17, "via": 0.15, "via2": 0.20}
TRACKS = [0.46, 0.92, 1.38, 1.84, 2.30]
POWER = {"VPWR", "VGND", "VPB", "VNB"}
MARK = (235, 4)


def g(v: float) -> float:
    return round(round(v / GRID) * GRID, 4)


def dbu(v: float) -> int:
    return int(round(v * 1000))


@dataclass
class Rect:
    layer: str
    x0: float
    y0: float
    x1: float
    y1: float
    purpose: str = "drawing"
    tag: str = ""  # net name or "inst.pin" for connectivity extraction

    def box(self):
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass
class Item:
    kind: str
    severity: str  # error | check | info
    msg: str
    bbox: tuple[float, float, float, float] | None = None


@dataclass
class Result:
    name: str
    width: float
    height: float
    placed: list[tuple[str, str, float]] = field(default_factory=list)  # inst, master, x
    wires: list[Rect] = field(default_factory=list)
    pins: list[Rect] = field(default_factory=list)      # port + power pins (layer, purpose=pin)
    nets: dict[str, list[str]] = field(default_factory=dict)
    ports: dict[str, str] = field(default_factory=dict)  # port -> direction
    items: list[Item] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    pinxy: dict = field(default_factory=dict)


def load_spec(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        spec = json.load(fh)
    for k in ("name", "instances", "nets"):
        if k not in spec:
            raise ValueError(f"spec is missing '{k}'")
    return spec


def _pin_rect(lib: StdCellLib, master: str, pin: str):
    m = lib.masters[master]
    p = m.pins.get(pin)
    if p is None:
        return None
    for want in ("li1", "met1"):
        rs = [r for r in p.rects if r[0] == want]
        if rs:
            r = max(rs, key=lambda q: (q[3] - q[1]) * (q[4] - q[2]))
            return want, r[1:]
    return None


def _stack(x: float, y: float, base: str, top: str) -> list[Rect]:
    """Via stack at (x, y) from base ('li1' or 'met1') up to top ('met2' or 'met3'), pads on every conductor in between."""
    order = ["li1", "met1", "met2", "met3"]
    cuts = {("li1", "met1"): "mcon", ("met1", "met2"): "via", ("met2", "met3"): "via2"}
    out: list[Rect] = []
    seq = order[order.index(base): order.index(top) + 1]
    for a, b in zip(seq, seq[1:]):
        c = CUT[cuts[(a, b)]]
        out.append(Rect(cuts[(a, b)], g(x - c / 2), g(y - c / 2), g(x + c / 2), g(y + c / 2)))
    for lay in seq[1:]:
        out.append(Rect(lay, g(x - PAD / 2), g(y - PAD / 2), g(x + PAD / 2), g(y + PAD / 2)))
    return out


def compose(spec: dict, lib: StdCellLib | None = None) -> Result:
    lib = lib or StdCellLib()
    pre = spec.get("lib", "sky130_fd_sc_hd") + "__"
    res = Result(spec["name"], 0.0, ROW_H)
    items = res.items
    insts = spec["instances"]
    for i in insts:
        m = i["master"] if i["master"].startswith(pre) else pre + i["master"]
        i["_m"] = m
        if m not in lib.masters:
            raise ValueError(f"master {m} is not in the library")
    names = [i["name"] for i in insts]
    if len(set(names)) != len(names):
        raise ValueError("duplicate instance names")
    # ---- placement: one abutted row in spec order
    x = 0.0
    for i in insts:
        mm = lib.masters[i["_m"]]
        if abs(mm.height - ROW_H) > 1e-6:
            items.append(Item("library", "error", f"{i['name']} ({i['_m']}) height {mm.height} != row height {ROW_H}"))
        if abs(mm.width / SITE_W - round(mm.width / SITE_W)) > 1e-3:
            items.append(Item("library", "check", f"{i['name']} width {mm.width} is not a multiple of the {SITE_W} site"))
        res.placed.append((i["name"], i["_m"], x))
        x = g(x + mm.width)
    res.width = x
    xof = {n: px for n, _m, px in res.placed}
    mof = {n: m for n, m, _px in res.placed}
    # ---- nets
    ports = spec.get("ports", {})
    res.ports = {p: (v.get("dir", "input") if isinstance(v, dict) else v) for p, v in ports.items()}
    pinxy: dict[str, tuple[str, float, float, tuple]] = {}  # "inst.pin" -> (base layer, cx, cy, abs rect)
    for net, refs in spec["nets"].items():
        res.nets[net] = list(refs)
        for ref in refs:
            if ref.startswith("port:") or ref in pinxy:
                continue
            inst, _, pin = ref.partition(".")
            if inst not in mof:
                items.append(Item("spec", "error", f"net {net}: unknown instance in '{ref}'"))
                continue
            pr = _pin_rect(lib, mof[inst], pin)
            if pr is None:
                items.append(Item("spec", "error", f"net {net}: {mof[inst]} has no usable li1/met1 pin '{pin}'"))
                continue
            base, (a, b, c, d) = pr
            ax0, ax1 = g(a + xof[inst]), g(c + xof[inst])
            pinxy[ref] = (base, g((ax0 + ax1) / 2), g((b + d) / 2), (ax0, b, ax1, d))
    # direction sanity
    for net, refs in res.nets.items():
        outs = [r for r in refs if not r.startswith("port:") and r in pinxy
                and lib.masters[mof[r.split('.')[0]]].pins[r.split('.', 1)[1]].direction == "OUTPUT"]
        outs += [f"port:{p}" for p, d in res.ports.items() if f"port:{p}" in refs and d.lower() == "input"]
        if len(outs) > 1:
            items.append(Item("spec", "error", f"net {net} has {len(outs)} drivers: {', '.join(outs)}"))
        if not outs:
            items.append(Item("spec", "check", f"net {net} has no driver (no output pin or input port)"))
    # ---- routing: OpenROAD detailed route of the abutted row (met1-met3); pin access and rules come from the PDK files
    from . import compose_route
    res.pinxy = pinxy
    boxes, errs = compose_route.port_boxes(res.width, res.nets, res.ports, pinxy)
    for e in errs:
        items.append(Item("route", "error", e))
    for pname, (_net, bx) in boxes.items():
        res.pins.append(Rect("met3", *bx, purpose="pin", tag=pname))
    rects, notes = compose_route.route(res.name, res.width, res.height, res.placed, boxes, res.ports, res.nets, pinxy,
                                       lib.root or "", lib.libname)
    for lay, x0, y0, x1, y1, nm in rects:
        res.wires.append(Rect(lay, x0, y0, x1, y1, tag=nm))
    for sev, msg in notes:
        items.append(Item("route", sev, msg))
    # ---- power pins (full-width met1 rails from the first cell's LEF)
    first = lib.masters[res.placed[0][1]]
    for pn in ("VPWR", "VGND"):
        rs = [r for r in first.pins.get(pn).rects if r[0] == "met1"] if first.pins.get(pn) else []
        if not rs:
            items.append(Item("rail", "error", f"{res.placed[0][1]} has no met1 rail for {pn}"))
            continue
        r = rs[0]
        res.pins.append(Rect("met1", 0.0, r[2], res.width, r[4], purpose="pin", tag=pn))
    # ---- ports without a net
    for p in res.ports:
        if not any(f"port:{p}" in refs for refs in res.nets.values()):
            items.append(Item("spec", "error", f"port {p} is not on any net"))
    _check_geometry(res, lib)
    return res


# --------------------------------------------------------------------------------------------------------------- geometry checks
def _overlap(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _touch(a, b) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def _check_geometry(res: Result, lib: StdCellLib) -> None:
    items = res.items
    W, H = res.width, res.height
    # boundary
    for r in res.wires + res.pins:
        if r.tag in ("VPWR", "VGND"):
            continue
        if r.x0 < -1e-6 or r.y0 < -1e-6 or r.x1 > W + 1e-6 or r.y1 > H + 1e-6:
            items.append(Item("boundary", "error", f"{r.layer} shape leaves the cell box", r.box()))
    # rails: abutment continuity of VPWR/VGND met1 across cells
    spans: dict[str, list[tuple[float, float]]] = {"VPWR": [], "VGND": []}
    for inst, master, px in res.placed:
        for pn in spans:
            p = lib.masters[master].pins.get(pn)
            rs = [r for r in (p.rects if p else []) if r[0] == "met1"]
            if rs:
                spans[pn].append((g(rs[0][1] + px), g(rs[0][3] + px)))
    for pn, sp in spans.items():
        sp.sort()
        for (a0, a1), (b0, b1) in zip(sp, sp[1:]):
            if b0 - a1 > 1e-3:
                items.append(Item("rail", "error", f"{pn} rail is broken between x={a1} and x={b0}", (a1, 0.0, b0, H)))
        if len(sp) != len(res.placed):
            items.append(Item("rail", "error", f"{pn} rail missing in some cells"))
    # connectivity extracted from the geometry vs the spec (description-level LVS)
    nodes: list[tuple[str, tuple, str]] = []  # layer, box, label
    for r in res.wires:
        nodes.append((r.layer, r.box(), r.tag))
    for p in res.pins:
        if p.layer == "met3":
            nodes.append((p.layer, p.box(), p.tag))
    pin_labels = {}
    for inst, master, px in res.placed:
        for pn, pin in lib.masters[master].pins.items():
            if pn in POWER:
                continue
            for lay, a, b, c, d in pin.rects:
                if lay in ("li1", "met1"):
                    nodes.append((lay, (g(a + px), b, g(c + px), d), f"{inst}.{pn}"))
    parent = list(range(len(nodes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    cond = {"li1", "met1", "met2", "met3"}
    for i, (la, ba, ta) in enumerate(nodes):
        for j in range(i + 1, len(nodes)):
            lb, bb, tb = nodes[j]
            if la == lb and la in cond and _overlap(ba, bb):
                union(i, j)
    cut_between = {"mcon": ("li1", "met1"), "via": ("met1", "met2"), "via2": ("met2", "met3")}
    for i, (la, ba, _t) in enumerate(nodes):
        if la not in cut_between:
            continue
        lo, hi = cut_between[la]
        for j, (lb, bb, _u) in enumerate(nodes):
            if lb in (lo, hi) and _overlap(ba, bb):
                union(i, j)
    # label-based merge: all rects of one cell pin are one terminal
    by_label: dict[str, int] = {}
    for i, (_l, _b, t) in enumerate(nodes):
        if "." in t:
            if t in by_label:
                union(i, by_label[t])
            else:
                by_label[t] = i
    comp: dict[int, set[str]] = {}
    for i, (_l, _b, t) in enumerate(nodes):
        if "." in t:
            comp.setdefault(find(i), set()).add(t)
    port_comp: dict[str, set[int]] = {}
    for i, (l, _b, t) in enumerate(nodes):
        if l == "met3" and t in res.ports:
            port_comp.setdefault(t, set()).add(find(i))
    spec_sets = {n: {r for r in refs if "." in r and not r.startswith("port:")} for n, refs in res.nets.items()}
    ok = 0
    for net, want in spec_sets.items():
        if len(want) < 2 and not any(r.startswith("port:") for r in res.nets[net]):
            continue
        roots = {find(by_label[r]) for r in want if r in by_label}
        if len(roots) > 1:
            items.append(Item("connectivity", "error", f"net {net} is open: its pins sit in {len(roots)} separate metal groups"))
            continue
        ok += 1
        got = comp.get(next(iter(roots)), set()) if roots else set()
        extra = got - want
        if extra:
            items.append(Item("connectivity", "error", f"net {net} is shorted to pins of other nets: {sorted(extra)}"))
    for p, d in res.ports.items():
        net = next((n for n, refs in res.nets.items() if f"port:{p}" in refs), None)
        if net is None:
            continue
        rt = port_comp.get(p, set())
        pr = {find(by_label[r]) for r in spec_sets[net] if r in by_label}
        if not rt or not (rt & pr):
            items.append(Item("connectivity", "error", f"port {p} pin shape is not connected to net {net}"))
    res.stats["nets_connected_ok"] = ok


# --------------------------------------------------------------------------------------------------------------- writers
def _poly(r: Rect):
    lp = layers.to_gds(r.layer, r.purpose)
    if lp is None:
        raise ValueError(f"layer {r.layer}/{r.purpose} unknown")
    x0, y0, x1, y1 = (dbu(v) for v in r.box())
    return lp[0], lp[1], [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def write_gds_file(res: Result, lib: StdCellLib, path: str) -> None:
    assert lib.gds is not None
    structs: dict[str, dict] = {}
    for _n, master, _x in res.placed:
        if master not in structs:
            geo = lib.cell_geometry(master)
            structs[master] = {k: geo.get(k, []) for k in ("polys", "paths", "texts", "srefs")}
    polys = [_poly(r) for r in res.wires + res.pins]
    W, H = dbu(res.width), dbu(res.height)
    polys.append((MARK[0], MARK[1], [(0, 0), (W, 0), (W, H), (0, H)]))
    texts = []
    for p in res.pins:
        lp = layers.to_gds(p.layer, "label")
        if lp:
            texts.append((lp[0], lp[1], [dbu((p.x0 + p.x1) / 2), dbu((p.y0 + p.y1) / 2)], p.tag))
    srefs = [(master, [dbu(x), 0], False, 0, 1.0) for _n, master, x in res.placed]
    structs[res.name] = {"polys": polys, "paths": [], "texts": texts, "srefs": srefs}
    write_gds(path, res.name, structs)


def write_lef(res: Result, path: str) -> None:
    L = ["VERSION 5.7 ;", "BUSBITCHARS \"[]\" ;", "DIVIDERCHAR \"/\" ;", "", f"MACRO {res.name}", "  CLASS CORE ;", "  FOREIGN %s 0 0 ;" % res.name,
         "  ORIGIN 0 0 ;", f"  SIZE {res.width:.3f} BY {res.height:.3f} ;", "  SYMMETRY X Y ;", "  SITE unithd ;"]
    lefl = {"met1": "met1", "met2": "met2", "met3": "met3"}
    for p in res.pins:
        use = "POWER" if p.tag == "VPWR" else "GROUND" if p.tag == "VGND" else "SIGNAL"
        d = "INOUT" if use != "SIGNAL" else {"input": "INPUT", "output": "OUTPUT"}.get(res.ports.get(p.tag, "input").lower(), "INOUT")
        L += [f"  PIN {p.tag}", f"    DIRECTION {d} ;", f"    USE {use} ;", "    PORT", f"      LAYER {lefl[p.layer]} ;",
              f"        RECT {p.x0:.3f} {p.y0:.3f} {p.x1:.3f} {p.y1:.3f} ;", "    END", f"  END {p.tag}"]
    L += ["  OBS", "    LAYER li1 ;", f"      RECT 0 0 {res.width:.3f} {res.height:.3f} ;"]
    pin_boxes = {(p.layer, p.box()) for p in res.pins}
    for lay in ("met2", "met3"):
        rs = [r for r in res.wires if r.layer == lay and (lay, r.box()) not in pin_boxes]
        if rs:
            L.append(f"    LAYER {lay} ;")
            L += [f"      RECT {r.x0:.3f} {r.y0:.3f} {r.x1:.3f} {r.y1:.3f} ;" for r in rs]
    L += ["  END", f"END {res.name}", "", "END LIBRARY", ""]
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(L))


def write_verilog(res: Result, spec: dict, lib: StdCellLib, path: str) -> None:
    conn: dict[str, dict[str, str]] = {n: {} for n, _m, _x in res.placed}
    for net, refs in res.nets.items():
        for r in refs:
            if "." in r:
                i, _, p = r.partition(".")
                conn.setdefault(i, {})[p] = net
    port_net = {}
    for net, refs in res.nets.items():
        for r in refs:
            if r.startswith("port:"):
                port_net[r[5:]] = net
    L = [f"module {res.name} ({', '.join(res.ports)});"]
    for p, d in res.ports.items():
        L.append(f"  {'input' if d.lower() == 'input' else 'output' if d.lower() == 'output' else 'inout'} {p};")
    inner = [n for n in res.nets if n not in res.ports]
    for n in inner:
        L.append(f"  wire {n};")
    for p, n in port_net.items():
        if p != n:
            L.append(f"  assign {n} = {p};" if res.ports[p].lower() == "input" else f"  assign {p} = {n};")
    for n, m, _x in res.placed:
        c = ", ".join(f".{pin}({net})" for pin, net in sorted(conn[n].items()))
        L.append(f"  {m} {n} ({c});")
    L.append("endmodule")
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(L) + "\n")


# --------------------------------------------------------------------------------------------------------------- official DRC with locations
def official_drc_items(gds: str, top: str, res: Result, pdk_root: str | None, timeout: int = 600) -> list[Item]:
    from .rules import find_deck, find_klayout

    deck = find_deck(pdk_root)
    kl = find_klayout()
    if not deck or not kl:
        return [Item("drc", "info", "official DRC not run: KLayout or sky130A_mr.drc not found")]
    with tempfile.TemporaryDirectory(prefix="cmpdrc_") as td:
        rep = os.path.join(td, "drc.lyrdb")
        cmd = [kl, "-b", "-r", deck, "-rd", f"input={gds}", "-rd", f"top_cell={top}", "-rd", f"report={rep}", "-rd", "beol=true",
               "-rd", "feol=false", "-rd", "thr=2"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if not os.path.exists(rep):
            return [Item("drc", "info", "official DRC produced no report: " + (proc.stderr or proc.stdout)[-300:])]
        xml = open(rep, encoding="utf-8").read()
    mine = [r.box() for r in res.wires + res.pins]
    out: list[Item] = []
    for blk in re.findall(r"<item>(.*?)</item>", xml, flags=re.S):
        cat = re.search(r"<category>'?([^<']*)'?</category>", blk)
        nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", re.sub(r"<[^>]+>", " ", blk.split("<values>", 1)[-1]))] if "<values>" in blk else []
        bb = None
        if len(nums) >= 2:
            xs, ys = nums[0::2], nums[1::2]
            bb = (min(xs), min(ys), max(xs), max(ys))
        ours = bb is not None and any(_touch((bb[0] - 0.01, bb[1] - 0.01, bb[2] + 0.01, bb[3] + 0.01), m) for m in mine)
        out.append(Item("drc", "error" if ours else "check", f"{cat.group(1) if cat else '?'}" + ("" if ours else " (not on added metal)"), bb))
    return out


# --------------------------------------------------------------------------------------------------------------- review outputs
def write_review(res: Result, outdir: str) -> dict:
    items = sorted(res.items, key=lambda i: {"error": 0, "check": 1, "info": 2}[i.severity])
    data = {"cell": res.name, "size_um": [res.width, res.height], "instances": [list(p) for p in res.placed],
            "stats": res.stats, "items": [{"kind": i.kind, "severity": i.severity, "msg": i.msg,
                                           "bbox": None if i.bbox is None else [round(v, 3) for v in i.bbox]} for i in items]}
    with open(os.path.join(outdir, "review.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1)
    md = [f"# Review list: {res.name}", f"size {res.width:.2f} x {res.height:.2f} um, {len(res.placed)} library cells", ""]
    if not items:
        md.append("No review items.")
    for n, i in enumerate(items, 1):
        loc = "" if i.bbox is None else f"  @ ({i.bbox[0]:.2f}, {i.bbox[1]:.2f})-({i.bbox[2]:.2f}, {i.bbox[3]:.2f})"
        md.append(f"{n}. [{i.severity}] {i.kind}: {i.msg}{loc}")
    with open(os.path.join(outdir, "review.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(md) + "\n")
    s = 60.0
    pad = 10.0
    w, h = res.width * s + 2 * pad, res.height * s + 2 * pad
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" viewBox="0 0 {w:.0f} {h:.0f}">',
           f'<rect width="100%" height="100%" fill="#fff"/>']

    def X(v): return pad + v * s

    def Y(v): return pad + (res.height - v) * s

    for n, master, px in res.placed:
        nxt = [x for _n, _m, x in res.placed if x > px]
        right = min(nxt) if nxt else res.width
        svg.append(f'<rect x="{X(px):.1f}" y="{Y(res.height):.1f}" width="{(right - px) * s:.1f}" height="{res.height * s:.1f}" fill="#f3f1ea" stroke="#999" stroke-width="0.6"/>')
        svg.append(f'<text x="{X(px) + 3:.1f}" y="{Y(res.height) + 11:.1f}" font-size="9" fill="#555">{n}</text>')
    col = {"met2": "#c95fd1", "met3": "#3fbfa0", "met1": "#4a74d9"}
    for r in res.wires + res.pins:
        if r.layer in col:
            svg.append(f'<rect x="{X(r.x0):.1f}" y="{Y(r.y1):.1f}" width="{(r.x1 - r.x0) * s:.1f}" height="{(r.y1 - r.y0) * s:.1f}" fill="{col[r.layer]}" fill-opacity="0.55"/>')
    for p in res.pins:
        if p.layer == "met3":
            svg.append(f'<text x="{X(p.x0):.1f}" y="{Y(p.y1) - 2:.1f}" font-size="9" fill="#085041">{p.tag}</text>')
    for i in items:
        if i.bbox:
            b = i.bbox
            c = "#d00" if i.severity == "error" else "#e90"
            svg.append(f'<rect x="{X(b[0]) - 2:.1f}" y="{Y(b[3]) - 2:.1f}" width="{(b[2] - b[0]) * s + 4:.1f}" height="{(b[3] - b[1]) * s + 4:.1f}" fill="none" stroke="{c}" stroke-width="1.5" stroke-dasharray="3 2"/>')
    svg.append("</svg>")
    with open(os.path.join(outdir, "review.svg"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(svg))
    return data


def build(spec_path: str, outdir: str, drc: bool = True) -> Result:
    spec = load_spec(spec_path)
    lib = StdCellLib()
    os.makedirs(outdir, exist_ok=True)
    res = compose(spec, lib)
    gds = os.path.join(outdir, res.name + ".gds")
    write_gds_file(res, lib, gds)
    write_lef(res, os.path.join(outdir, res.name + ".lef"))
    write_verilog(res, spec, lib, os.path.join(outdir, res.name + ".v"))
    if drc:
        res.items += official_drc_items(gds, res.name, res, lib.root)
    write_review(res, outdir)
    return res
