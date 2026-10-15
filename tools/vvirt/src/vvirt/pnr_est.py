"""Fast place-and-route estimation on an EXISTING placement (OpenLane / OpenROAD DEF) - no new layout is created.

Reads a DEF (components, rows, nets, optional routing) and the LEF sizes of the masters, then, in seconds:
  * legality   - overlaps, components outside the die, off-site / off-row placement
  * density    - utilisation and a bin density map
  * wirelength - half-perimeter wirelength (HPWL) per net; if the DEF is routed: routed length / vias and routed-vs-HPWL
  * congestion - RUDY estimate (Rectangular Uniform wire DensitY) per bin, hot bins listed
  * tap cover  - row points farther than the latch-up distance from any tap cell (the failure that cost PPA3 1,861 DRC errors)
  * ECO        - minimal edit suggestions (nudge an overlapping component to the nearest free site, insert a tap)
Findings carry a bbox in um so they can be drawn as an overlay (see overlay_skill / overlay_svg).

These are ESTIMATES: pin positions are approximated by the cell centre, RUDY is a proxy for routed congestion, and none of this is a
signoff check (DRC / LVS / extraction stay with Magic, KLayout and Netgen).
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field

SWAP = {"E", "W", "FE", "FW"}  # orientations that swap width and height


@dataclass
class Comp:
    name: str
    master: str
    x: float
    y: float
    orient: str
    fixed: bool = False


@dataclass
class Net:
    name: str
    terms: list[tuple[str, str]] = field(default_factory=list)
    routed_len: float = 0.0
    vias: int = 0
    layers: dict[str, float] = field(default_factory=dict)
    special: bool = False
    segs: list[tuple[str, float, float, float, float]] = field(default_factory=list)  # routed wire centre lines: layer, x0, y0, x1, y1 (um)
    via_at: list[tuple[str, float, float]] = field(default_factory=list)  # via name, x, y (um)
    rects: list[tuple[str, float, float, float, float]] = field(default_factory=list)  # RECT patches (absolute um)


@dataclass
class Design:
    name: str = ""
    dbu: float = 1000.0
    die: tuple[float, float, float, float] = (0, 0, 0, 0)
    rows: list[tuple[float, float, int, float, str]] = field(default_factory=list)  # x0, y0, count, step, orient (um)
    comps: dict[str, Comp] = field(default_factory=dict)
    nets: dict[str, Net] = field(default_factory=dict)
    routed: bool = False
    vias: dict[str, dict] = field(default_factory=dict)  # DEF VIAS section: generated (VIARULE) vias


# --------------------------------------------------------------------------------------------------------------- readers
def read_def(path: str) -> Design:
    d = Design()
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    m = re.search(r"UNITS DISTANCE MICRONS (\d+)", text)
    d.dbu = float(m.group(1)) if m else 1000.0
    u = d.dbu
    m = re.search(r"^DESIGN (\S+)", text, re.M)
    d.name = m.group(1) if m else ""
    m = re.search(r"DIEAREA \(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)", text)
    if m:
        d.die = tuple(int(v) / u for v in m.groups())  # type: ignore[assignment]
    for r in re.finditer(r"^ROW \S+ \S+ (-?\d+) (-?\d+) (\w+) DO (\d+) BY \d+ STEP (\d+) \d+", text, re.M):
        d.rows.append((int(r.group(1)) / u, int(r.group(2)) / u, int(r.group(4)), int(r.group(5)) / u, r.group(3)))
    cs = text.find("\nCOMPONENTS")
    ce = text.find("END COMPONENTS")
    if cs >= 0 and ce > cs:
        for blk in re.split(r"\n\s*-\s+", text[cs:ce])[1:]:
            c = re.match(r"(\S+)\s+(\S+)", blk)
            pl = re.search(r"\+\s+(PLACED|FIXED|COVER)\s+\(\s*(-?\d+)\s+(-?\d+)\s*\)\s+(\w+)", blk)
            if c and pl:  # a component may carry "+ SOURCE DIST", "+ WEIGHT" ... before its placement
                d.comps[c.group(1)] = Comp(c.group(1), c.group(2), int(pl.group(2)) / u, int(pl.group(3)) / u, pl.group(4), pl.group(1) != "PLACED")
    vs = re.search(r"^VIAS \d+ ;", text, re.M)
    if vs:
        ve = text.find("END VIAS", vs.end())
        for vb in re.split(r"\n\s*-\s+", text[vs.end():ve])[1:]:
            nm = vb.split(None, 1)[0]
            def grab(key, n):
                m = re.search(key + r"\s+" + r"\s+".join([r"(-?\d+)"] * n), vb)
                return [int(v) / u for v in m.groups()] if m else None
            ly = re.search(r"\+\s*LAYERS\s+(\S+)\s+(\S+)\s+(\S+)", vb)
            rc = re.search(r"\+\s*ROWCOL\s+(\d+)\s+(\d+)", vb)
            rects = [(m.group(1), *[int(m.group(k)) / u for k in range(2, 6)]) for m in re.finditer(r"\+\s*RECT\s+(\S+)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)", vb)]
            d.vias[nm] = {"layers": list(ly.groups()) if ly else None, "cut": grab(r"\+\s*CUTSIZE", 2), "space": grab(r"\+\s*CUTSPACING", 2), "enc": grab(r"\+\s*ENCLOSURE", 4),
                          "rowcol": [int(rc.group(1)), int(rc.group(2))] if rc else [1, 1], "rects": rects}
    for sect, special in (("NETS", False), ("SPECIALNETS", True)):
        s = re.search(r"^%s \d+ ;" % sect, text, re.M)
        e = text.find("END " + sect, s.end()) if s else -1
        if not s or e < 0:
            continue
        for nb in re.split(r"\n\s*-\s+", text[s.end():e])[1:]:
            name = nb.split(None, 1)[0]
            net = Net(name, special=special)
            head = nb.split("+", 1)[0]
            net.terms = [(a, b) for a, b in re.findall(r"\(\s*(\S+)\s+(\S+)\s*\)", head) if a != "PIN"]
            if "ROUTED" in nb and not special:
                d.routed = True
                _parse_route(nb[nb.index("ROUTED"):], u, net)
            d.nets[name] = net
    return d


_PT = re.compile(r"\(\s*(\*|-?\d+)\s+(\*|-?\d+)(?:\s+\d+)?\s*\)")


_RTOK = re.compile(r"\(\s*(\*|-?\d+)\s+(\*|-?\d+)(?:\s+-?\d+)?\s*\)|RECT\s*\(\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*\)|([A-Za-z][A-Za-z0-9_]*)")


def _parse_route(txt: str, u: float, net: Net) -> None:
    for stmt in re.split(r"\bNEW\b|\bROUTED\b", txt):
        stmt = stmt.strip().rstrip(";").strip()
        if not stmt:
            continue
        toks = stmt.split(None, 1)
        layer = toks[0]
        rest = toks[1] if len(toks) > 1 else ""
        px = py = None
        length = 0.0
        for tk in _RTOK.finditer(rest):
            if tk.group(3) is not None:  # RECT ( dx0 dy0 dx1 dy1 ) patch relative to the last point
                if px is not None:
                    net.rects.append((layer, (px + int(tk.group(3))) / u, (py + int(tk.group(4))) / u, (px + int(tk.group(5))) / u, (py + int(tk.group(6))) / u))
                continue
            if tk.group(7):
                if tk.group(7) not in ("SHAPE", "STYLE", "TAPER", "TAPERRULE", "STRIPE", "FOLLOWPIN", "IOWIRE", "COREWIRE", "BLOCKWIRE", "PADWIRE", "FILLWIRE", "DRCFILL", "USE", "SIGNAL", "POWER", "GROUND", "CLOCK", "ANALOG", "RESET", "SCAN", "TIEOFF", "SOURCE", "DIST", "NETLIST", "TEST", "FIXEDBUMP", "ORIGINAL", "ROUTED", "FIXED", "COVER", "NOSHIELD", "SHIELD", "NONDEFAULTRULE", "WEIGHT", "XTALK"):
                    net.vias += 1
                    if px is not None:
                        net.via_at.append((tk.group(7), px / u, py / u))
                continue
            xs, ys = tk.group(1), tk.group(2)
            x = px if xs == "*" else int(xs)
            y = py if ys == "*" else int(ys)
            if px is not None and x is not None and y is not None:
                length += abs(x - px) + abs(y - py)
                if (x, y) != (px, py):
                    net.segs.append((layer, px / u, py / u, x / u, y / u))
            px, py = x, y
        if length:
            net.routed_len += length / u
            net.layers[layer] = net.layers.get(layer, 0.0) + length / u


def read_lef_sizes(paths: list[str]) -> dict[str, tuple[float, float]]:
    sizes: dict[str, tuple[float, float]] = {}
    for p in paths:
        try:
            t = open(p, encoding="utf-8", errors="replace").read()
        except OSError:
            continue
        for m in re.finditer(r"MACRO\s+(\S+)(.*?)END\s+\1", t, re.S):
            s = re.search(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)", m.group(2))
            if s:
                sizes[m.group(1)] = (float(s.group(1)), float(s.group(2)))
    return sizes


# --------------------------------------------------------------------------------------------------------------- geometry
def bbox(c: Comp, sizes: dict[str, tuple[float, float]]) -> tuple[float, float, float, float] | None:
    s = sizes.get(c.master)
    if not s:
        return None
    w, h = (s[1], s[0]) if c.orient in SWAP else s
    return (c.x, c.y, c.x + w, c.y + h)


def _grid(items: list[tuple[str, tuple[float, float, float, float]]], cell: float):
    g: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, (_n, b) in enumerate(items):
        for gx in range(int(b[0] // cell), int(b[2] // cell) + 1):
            for gy in range(int(b[1] // cell), int(b[3] // cell) + 1):
                g[(gx, gy)].append(i)
    return g


# --------------------------------------------------------------------------------------------------------------- estimates
def estimate(d: Design, sizes: dict[str, tuple[float, float]], bin_um: float = 10.0, lu_um: float = 17.0,
             site_um: float = 0.46, row_um: float = 2.72) -> dict:
    out: dict = {"design": d.name, "die": list(d.die), "findings": [], "stats": {}}
    F = out["findings"]
    boxes = []
    unknown = defaultdict(int)
    for c in d.comps.values():
        b = bbox(c, sizes)
        if b is None:
            unknown[c.master] += 1
            continue
        boxes.append((c.name, b))
    out["stats"]["components"] = len(d.comps)
    out["stats"]["unknown_masters"] = dict(unknown)
    # ---- legality
    die = d.die
    for n, b in boxes:
        if b[0] < die[0] - 1e-6 or b[1] < die[1] - 1e-6 or b[2] > die[2] + 1e-6 or b[3] > die[3] + 1e-6:
            F.append({"kind": "outside_die", "severity": "error", "bbox": list(b), "msg": f"{n} outside the die"})
    # standard cells sit in rows: compare neighbours inside one row (sorted by x); macros are checked against everything near them
    macro_idx = [i for i, (n, _b) in enumerate(boxes) if not d.comps[n].master.startswith("sky130_fd_sc_") and not d.comps[n].master.startswith("sky130_ef_sc_")]
    macro_set = set(macro_idx)
    overl = 0

    def add_overlap(i: int, j: int) -> None:
        nonlocal overl
        a, b = boxes[i][1], boxes[j][1]
        ox, oy = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
        if ox > 1e-4 and oy > 1e-4:
            overl += 1
            if overl <= 200:
                F.append({"kind": "overlap", "severity": "error", "bbox": [max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])],
                          "msg": f"{boxes[i][0]} overlaps {boxes[j][0]} ({ox:.2f} x {oy:.2f} um)", "a": boxes[i][0], "b": boxes[j][0]})

    rows_: dict[float, list[int]] = defaultdict(list)
    for i, (_n, b) in enumerate(boxes):
        if i not in macro_set:
            rows_[round(b[1], 2)].append(i)
    for ids in rows_.values():
        ids.sort(key=lambda k: boxes[k][1][0])
        for a_, b_ in zip(ids, ids[1:]):
            add_overlap(a_, b_)
    if macro_idx:
        grid = _grid(boxes, 20.0)
        for mi in macro_idx:
            mb = boxes[mi][1]
            near: set[int] = set()
            for gx in range(int(mb[0] // 20.0), int(mb[2] // 20.0) + 1):
                for gy in range(int(mb[1] // 20.0), int(mb[3] // 20.0) + 1):
                    near.update(grid.get((gx, gy), ()))
            for j in near:
                if j != mi and (j not in macro_set or j > mi):
                    add_overlap(mi, j)
    out["stats"]["overlaps"] = overl
    off = 0
    row_y = {round(r[1], 3) for r in d.rows}
    for c in d.comps.values():
        if c.fixed or c.master not in sizes:
            continue
        sx = (c.x - (d.rows[0][0] if d.rows else 0)) / site_um
        if abs(sx - round(sx)) > 0.02 or (row_y and round(c.y, 3) not in row_y):
            off += 1
            if off <= 100:
                F.append({"kind": "off_grid", "severity": "warn", "bbox": list(bbox(c, sizes)), "msg": f"{c.name} is not on a site/row"})
    out["stats"]["off_grid"] = off
    # ---- density
    nx, ny = max(1, int(math.ceil((die[2] - die[0]) / bin_um))), max(1, int(math.ceil((die[3] - die[1]) / bin_um)))
    dens = [[0.0] * nx for _ in range(ny)]
    std_area = macro_area = 0.0
    for n, b in boxes:
        a = (b[2] - b[0]) * (b[3] - b[1])
        is_macro = not d.comps[n].master.startswith("sky130_fd_sc_")
        if is_macro:
            macro_area += a
        else:
            std_area += a
        for gx in range(int((b[0] - die[0]) // bin_um), min(nx, int((b[2] - die[0]) // bin_um) + 1)):
            for gy in range(int((b[1] - die[1]) // bin_um), min(ny, int((b[3] - die[1]) // bin_um) + 1)):
                x0, y0 = die[0] + gx * bin_um, die[1] + gy * bin_um
                ox = max(0.0, min(b[2], x0 + bin_um) - max(b[0], x0))
                oy = max(0.0, min(b[3], y0 + bin_um) - max(b[1], y0))
                dens[gy][gx] += ox * oy / (bin_um * bin_um)
    core = (die[2] - die[0]) * (die[3] - die[1])
    out["stats"].update(die_area=core, std_cell_area=std_area, macro_area=macro_area,
                        utilization=std_area / max(1.0, core - macro_area), max_bin_density=max(max(r) for r in dens))
    # ---- HPWL + RUDY
    ctr = {n: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for n, b in boxes}
    rudy = [[0.0] * nx for _ in range(ny)]
    hp_total = 0.0
    routed_total = 0.0
    per_net = []
    for net in d.nets.values():
        if net.special:
            continue
        pts = [ctr[i] for i, _p in net.terms if i in ctr]
        if len(pts) < 2:
            continue
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        hp = (x1 - x0) + (y1 - y0)
        hp_total += hp
        routed_total += net.routed_len
        per_net.append((hp, net.name, net.routed_len))
        w, h = max(x1 - x0, 1.0), max(y1 - y0, 1.0)
        dd = (w + h) / (w * h)
        for gx in range(max(0, int((x0 - die[0]) // bin_um)), min(nx, int((x1 - die[0]) // bin_um) + 1)):
            for gy in range(max(0, int((y0 - die[1]) // bin_um)), min(ny, int((y1 - die[1]) // bin_um) + 1)):
                rudy[gy][gx] += dd
    per_net.sort(reverse=True)
    out["stats"].update(hpwl_um=hp_total, nets=len(per_net), longest_nets=[{"net": n, "hpwl": round(h, 1), "routed": round(r, 1)} for h, n, r in per_net[:5]])
    if d.routed:
        out["stats"].update(routed_um=routed_total, routed_over_hpwl=routed_total / hp_total if hp_total else None,
                            vias=sum(n.vias for n in d.nets.values() if not n.special))
    flat = sorted((v, gx, gy) for gy, row in enumerate(rudy) for gx, v in enumerate(row) if v > 0)
    if flat:
        vals = [v for v, _a, _b in flat]
        mean = sum(vals) / len(vals)
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / len(vals))
        thr = mean + 2.5 * sd
        hot = [(v, gx, gy) for v, gx, gy in flat if v > thr][-12:]
        out["stats"]["rudy_mean"], out["stats"]["rudy_max"], out["stats"]["rudy_hot_bins"] = mean, vals[-1], len(hot)
        for v, gx, gy in reversed(hot):
            x0, y0 = die[0] + gx * bin_um, die[1] + gy * bin_um
            F.append({"kind": "congestion", "severity": "info", "bbox": [x0, y0, x0 + bin_um, y0 + bin_um],
                      "msg": f"RUDY {v:.3f} (mean {mean:.3f}, +{(v - mean) / sd:.1f} sigma)"})
    # ---- tap coverage
    taps = [ctr[n] for n, _b in boxes if "tapvpwrvgnd" in d.comps[n].master]
    out["stats"]["taps"] = len(taps)
    macro_boxes = [b for n, b in boxes if not d.comps[n].master.startswith(("sky130_fd_sc_", "sky130_ef_sc_"))]
    tg: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for t in taps:
        tg[(int(t[0] // 20), int(t[1] // 20))].append(t)
    flagged_rows = 0
    far_boxes = []
    import bisect

    spans: dict[float, list[tuple[float, float]]] = defaultdict(list)  # row y -> covered x intervals (merged below)
    for n, bb in boxes:
        if d.comps[n].master.startswith("sky130_"):
            spans[round(bb[1], 3)].append((bb[0], bb[2]))
    starts: dict[float, list[float]] = {}
    merged: dict[float, list[tuple[float, float]]] = {}
    for ry_, iv in spans.items():
        iv.sort()
        cur = [iv[0][0], iv[0][1]]
        out_iv = []
        for a0, a1 in iv[1:]:
            if a0 <= cur[1] + 1e-6:
                cur[1] = max(cur[1], a1)
            else:
                out_iv.append((cur[0], cur[1]))
                cur = [a0, a1]
        out_iv.append((cur[0], cur[1]))
        merged[ry_] = out_iv
        starts[ry_] = [v[0] for v in out_iv]

    def covered(px: float, ry: float) -> bool:
        key = round(ry, 3)
        iv = merged.get(key)
        if not iv:
            return False
        i = bisect.bisect_right(starts[key], px) - 1
        return i >= 0 and iv[i][0] <= px <= iv[i][1]

    if True:  # no taps at all is the worst case: every covered row point is then flagged
        for (rx, ry, cnt, step, _o) in d.rows:
            y = ry + row_um / 2
            x_end = rx + cnt * step
            bad_x0 = bad_x1 = None
            xs = rx
            while xs <= x_end:
                if covered(xs, ry) and not any(mb[0] <= xs <= mb[2] and mb[1] <= y <= mb[3] for mb in macro_boxes):
                    best = 1e9
                    gx, gy = int(xs // 20), int(y // 20)
                    for ax in (gx - 1, gx, gx + 1):
                        for ay in (gy - 1, gy, gy + 1):
                            for t in tg.get((ax, ay), ()):
                                dd = math.hypot(t[0] - xs, t[1] - y)
                                if dd < best:
                                    best = dd
                    if best > lu_um:
                        bad_x0 = xs if bad_x0 is None else bad_x0
                        bad_x1 = xs
                xs += 2.0
            if bad_x0 is not None:
                flagged_rows += 1
                far_boxes.append((bad_x0, ry, bad_x1, ry + row_um))
    out["stats"]["tap_far_rows"] = flagged_rows
    if far_boxes:
        # merge neighbouring rows with the same x extent into one finding per band
        far_boxes.sort(key=lambda b: (round(b[0]), round(b[2]), b[1]))
        band = list(far_boxes[0])
        n_rows = 1
        for b in far_boxes[1:]:
            if round(b[0]) == round(band[0]) and round(b[2]) == round(band[2]) and b[1] - band[3] < row_um * 1.5:
                band[3] = b[3]
                n_rows += 1
            else:
                F.append({"kind": "tap_far", "severity": "error", "bbox": band, "msg": f"{n_rows} row(s) with points > {lu_um:.0f} um from any tap (latch-up / floating nwell risk)"})
                band, n_rows = list(b), 1
        F.append({"kind": "tap_far", "severity": "error", "bbox": band, "msg": f"{n_rows} row(s) with points > {lu_um:.0f} um from any tap (latch-up / floating nwell risk)"})
    out["density"] = {"bin_um": bin_um, "nx": nx, "ny": ny, "max": out["stats"]["max_bin_density"]}
    return out


def diff(a: Design, b: Design, sizes: dict[str, tuple[float, float]]) -> dict:
    """What a minimal ECO from placement a to placement b looks like."""
    moved = []
    for n, ca in a.comps.items():
        cb = b.comps.get(n)
        if cb is None or ca.fixed and cb.fixed and (ca.x, ca.y) == (cb.x, cb.y):
            continue
        if (ca.x, ca.y, ca.orient) != (cb.x, cb.y, cb.orient):
            moved.append({"name": n, "master": ca.master, "from": [ca.x, ca.y, ca.orient], "to": [cb.x, cb.y, cb.orient],
                          "dist": round(abs(ca.x - cb.x) + abs(ca.y - cb.y), 3)})
    moved.sort(key=lambda m: -m["dist"])
    return {"moved": len(moved), "added": sorted(set(b.comps) - set(a.comps))[:50], "removed": sorted(set(a.comps) - set(b.comps))[:50],
            "total_displacement_um": round(sum(m["dist"] for m in moved), 2), "max_displacement_um": moved[0]["dist"] if moved else 0.0,
            "top_moves": moved[:20]}


# --------------------------------------------------------------------------------------------------------------- minimal ECO
def suggest_eco(d: Design, sizes: dict[str, tuple[float, float]], est: dict, max_items: int = 50, halo_um: float = 10.0) -> list[dict]:
    """Smallest edits that fix what the estimate found. Only suggestions - nothing is applied.
    A tap-less row sliver between the core edge and a macro is best removed by moving that one macro left (keeping halo_um from the
    core edge); isolated slivers elsewhere get a single tap cell."""
    eco: list[dict] = []
    macros = [(n, bbox(c, sizes)) for n, c in d.comps.items() if not c.master.startswith(("sky130_fd_sc_", "sky130_ef_sc_")) and bbox(c, sizes)]
    moved: dict[str, dict] = {}
    covered_by_move: list[tuple[float, float, float, float]] = []
    far = [f for f in est["findings"] if f["kind"] == "tap_far"]
    for f in sorted(far, key=lambda f: -(f["bbox"][3] - f["bbox"][1])):  # biggest bands first
        x0, y0, x1, y1 = f["bbox"]
        ym = (y0 + y1) / 2
        for n, mb in macros:
            if n in moved or not (mb[1] <= ym <= mb[3]) or not (x1 <= mb[0] <= x1 + 25):
                continue
            dx = round((x0 + halo_um) - mb[0], 3)
            if dx < 0 and not d.comps[n].fixed or dx < 0:
                moved[n] = {"op": "move_macro", "name": n, "master": d.comps[n].master, "dx": dx, "dy": 0.0, "from": [mb[0], mb[1]], "to": [round(mb[0] + dx, 3), mb[1]],
                            "why": f"removes the tap-less row sliver left of it ({f['msg']}); keeps a {halo_um:g} um halo from the core edge",
                            "alt": "or insert tap cells along the sliver (many cells)"}
                covered_by_move.append((x0 - 1, mb[1] - 6, mb[0] + 1, mb[3] + 6))
                break
    eco.extend(moved.values())
    for f in est["findings"]:
        if f["kind"] == "overlap":
            mv = d.comps.get(f["b"])
            if mv and not mv.fixed:
                dx = f["bbox"][2] - f["bbox"][0]
                eco.append({"op": "move", "name": mv.name, "dx": round(dx, 3), "dy": 0.0, "why": f["msg"]})
        elif f["kind"] == "tap_far":
            x0, y0, x1, y1 = f["bbox"]
            if any(c[0] <= x0 and x1 <= c[2] and c[1] <= y0 and y1 <= c[3] for c in covered_by_move):
                continue
            eco.append({"op": "insert_tap", "master": "sky130_fd_sc_hd__tapvpwrvgnd_1", "near": [round((x0 + x1) / 2, 2), round((y0 + y1) / 2, 2)],
                        "alt": "or move the neighbouring macro so the row fragment disappears", "why": f["msg"]})
        if len(eco) >= max_items:
            break
    return eco


# --------------------------------------------------------------------------------------------------------------- outputs
def overlay_skill(findings: list[dict], cell: str = "overlay", lib: str = "testlib", layer: str = "marker", purpose: str = "drawing") -> str:
    """SKILL that draws the findings as marker rectangles + labels. Send it through the virtuoso-bridge client (or load it in a
    Virtuoso CIW); the markers live on their own layer/purpose so the person can overlay, review and delete them."""
    lines = [f'; overlay generated by vvirt.pnr_est - {len(findings)} markers on ("{layer}" "{purpose}")',
             f'let((cv) cv = dbOpenCellViewByType("{lib}" "{cell}" "layout" "maskLayout" "a")']
    for i, f in enumerate(findings):
        x0, y0, x1, y1 = f["bbox"]
        w, h = max(x1 - x0, 0.5), max(y1 - y0, 0.5)
        lines.append(f'  dbCreateRect(cv list("{layer}" "{purpose}") list(list({x0:.3f} {y0:.3f}) list({x0 + w:.3f} {y0 + h:.3f})))')
        txt = f"{f['kind']}:{f['msg']}"[:60].replace('"', "'")
        lines.append(f'  dbCreateLabel(cv list("{layer}" "{purpose}") list({x0:.3f} {y0 + h:.3f}) "{txt}" "lowerLeft" "R0" "roman" 1.0)')
    lines.append("  dbSave(cv))")
    return "\n".join(lines) + "\n"


def overlay_svg(d: Design, sizes: dict[str, tuple[float, float]], est: dict, path: str, width_px: int = 1100) -> None:
    die = d.die
    sx = width_px / max(1e-6, die[2] - die[0])
    hpx = int((die[3] - die[1]) * sx)
    col = {"error": "#e5484d", "warn": "#f5a524", "info": "#3b82f6"}
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width_px} {hpx}" width="{width_px}" height="{hpx}">',
         f'<rect width="{width_px}" height="{hpx}" fill="#0f1726"/>']

    def X(x):
        return (x - die[0]) * sx

    def Y(y):
        return hpx - (y - die[1]) * sx

    macro = [(n, bbox(c, sizes)) for n, c in d.comps.items() if not c.master.startswith("sky130_fd_sc_") and bbox(c, sizes)]
    for n, b in macro:
        o.append(f'<rect x="{X(b[0]):.1f}" y="{Y(b[3]):.1f}" width="{(b[2] - b[0]) * sx:.1f}" height="{(b[3] - b[1]) * sx:.1f}" fill="#243b55" stroke="#5b7aa6"/>'
                 f'<text x="{X(b[0]) + 6:.1f}" y="{Y(b[3]) + 16:.1f}" fill="#9fb4d6" font-size="12">{n}</text>')
    for c in d.comps.values():
        if c.master.startswith("sky130_fd_sc_") and "tapvpwrvgnd" in c.master:
            o.append(f'<rect x="{X(c.x):.1f}" y="{Y(c.y + 2.72):.1f}" width="1.2" height="1.2" fill="#6ee7b7"/>')
    for f in est["findings"]:
        x0, y0, x1, y1 = f["bbox"]
        o.append(f'<rect x="{X(x0):.1f}" y="{Y(max(y1, y0 + 0.5)):.1f}" width="{max((x1 - x0) * sx, 3):.1f}" height="{max((y1 - y0) * sx, 3):.1f}" fill="{col[f["severity"]]}" fill-opacity="0.45" stroke="{col[f["severity"]]}"><title>{f["kind"]}: {f["msg"]}</title></rect>')
    o.append("</svg>")
    open(path, "w", encoding="utf-8").write("\n".join(o))
