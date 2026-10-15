"""Turn an externally placed-and-routed design (DEF) into SKILL that the virtuoso-bridge can execute.

The placement / routing is done outside (OpenROAD, using the PDK tech LEF rules); this module only transfers the RESULT into a
Virtuoso layout cellview so a person can review and edit it there:
  * every component -> dbCreateInstByMasterName(...) with the DEF orientation converted to the Virtuoso one
    (the DEF location is the lower-left of the ORIENTED bbox, the Virtuoso origin is the cell origin - converted per orientation)
  * every routed wire -> dbCreateRect on its metal (centre line widened by the PDK layer WIDTH, ends extended by half a width as DEF specifies)
  * every via -> its cut / enclosure rectangles (tech-LEF VIA shapes, or the DEF VIAS section for generated vias)
  * RECT patches -> dbCreateRect
Output is split into chunks (one .il file each + a loader) so a large design does not go through the bridge as one giant string.

Not transferred: nets / pins / connectivity (a DEF carries net names but a Virtuoso cellview needs schematic-driven pins), power stripes
(SPECIALNETS) unless include_special is set, and masters that do not exist in the target library (reported in the summary).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from .odb import apply_orient
from .pnr_est import Design, bbox

# DEF orientation -> Virtuoso orientation. N/S/FN/FS are the ones standard-cell rows use and are exact. The rotated pairs follow the
# LEF/DEF <-> OpenAccess table (W=R90, E=R270, FW=MYR90, FE=MXR90); the flipped-rotated ones are marked unverified in the summary.
ORIENT = {"N": "R0", "S": "R180", "W": "R90", "E": "R270", "FN": "MY", "FS": "MX", "FW": "MYR90", "FE": "MXR90"}
UNVERIFIED = {"FW", "FE"}


def read_tlef_vias(path: str) -> dict[str, list[tuple[str, float, float, float, float]]]:
    """VIA <name> ... LAYER l ; RECT x0 y0 x1 y1 ; ...  ->  name -> [(layer, x0, y0, x1, y1)] relative to the via centre."""
    vias: dict[str, list] = {}
    text = open(path, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r"^VIA\s+(\S+)[^\n]*\n(.*?)^END\s+\1\b", text, re.S | re.M):
        shapes, layer = [], None
        for line in m.group(2).splitlines():
            f = line.split("#", 1)[0].strip().rstrip(";").split()
            if len(f) >= 2 and f[0] == "LAYER":
                layer = f[1]
            elif len(f) == 5 and f[0] == "RECT" and layer:
                shapes.append((layer, *[float(v) for v in f[1:]]))
        vias[m.group(1)] = shapes
    return vias


def def_via_shapes(v: dict) -> list[tuple[str, float, float, float, float]]:
    """A VIAS-section entry -> shapes relative to the via centre (explicit RECTs, or cut array + enclosure from the VIARULE values)."""
    if v.get("rects"):
        return [tuple(r) for r in v["rects"]]  # type: ignore[misc]
    if not (v.get("layers") and v.get("cut")):
        return []
    bot, cut, top = v["layers"]
    cw, ch = v["cut"]
    sx, sy = v.get("space") or (cw, ch)
    rows, cols = v.get("rowcol") or (1, 1)
    px, py = cw + sx, ch + sy
    cuts = [(-(cols - 1) * px / 2 + c * px, -(rows - 1) * py / 2 + r * py) for r in range(rows) for c in range(cols)]
    out = [(cut, cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2) for cx, cy in cuts]
    x0 = min(c[0] for c in cuts) - cw / 2
    x1 = max(c[0] for c in cuts) + cw / 2
    y0 = min(c[1] for c in cuts) - ch / 2
    y1 = max(c[1] for c in cuts) + ch / 2
    bx, by, tx, ty = v.get("enc") or (0, 0, 0, 0)
    out.append((bot, x0 - bx, y0 - by, x1 + bx, y1 + by))
    out.append((top, x0 - tx, y0 - ty, x1 + tx, y1 + ty))
    return out


def origin_for(x: float, y: float, w: float, h: float, orient: str) -> tuple[float, float]:
    """DEF gives the lower-left of the oriented bbox; Virtuoso wants the cell origin."""
    cds = ORIENT[orient]
    pts = [apply_orient(cds, px, py) for px, py in ((0, 0), (w, 0), (0, h), (w, h))]
    return x - min(p[0] for p in pts), y - min(p[1] for p in pts)


@dataclass
class Export:
    chunks: list[str] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def _num(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".") or "0"


def to_skill(d: Design, sizes: dict[str, tuple[float, float]], tlef_layers: dict, tlef_vias: dict, lib: str, cell: str, std_lib: str = "sky130_fd_sc_hd",
             macro_lib: str | None = None, window: tuple[float, float, float, float] | None = None, include_routes: bool = True,
             chunk_stmts: int = 2000, skip_masters: set[str] | None = None) -> Export:
    """tlef_layers: techlef.TechLef.layers (for WIDTH); tlef_vias: read_tlef_vias(); window = (x0,y0,x1,y1) um restricts to what touches it."""
    def inside(bb: tuple[float, float, float, float]) -> bool:
        return window is None or not (bb[2] < window[0] or bb[0] > window[2] or bb[3] < window[1] or bb[1] > window[3])

    stmts: list[str] = []
    cnt = {"instances": 0, "wires": 0, "vias": 0, "patches": 0}
    missing: dict[str, int] = {}
    unver: set[str] = set()
    macro_lib = macro_lib or std_lib
    for c in d.comps.values():
        bb = bbox(c, sizes)
        if bb is None or c.master in (skip_masters or set()):
            missing[c.master] = missing.get(c.master, 0) + 1
            continue
        if not inside(bb):
            continue
        if c.orient not in ORIENT:
            missing["orient:" + c.orient] = missing.get("orient:" + c.orient, 0) + 1
            continue
        if c.orient in UNVERIFIED:
            unver.add(c.orient)
        w, h = sizes[c.master]
        ox, oy = origin_for(c.x, c.y, w, h, c.orient)
        lb = std_lib if c.master.startswith(("sky130_fd_sc_", "sky130_ef_sc_")) else macro_lib
        nm = c.name.replace("\\", "").replace('"', "")
        stmts.append(f'dbCreateInstByMasterName(cv "{lb}" "{c.master}" "layout" "{nm}" list({_num(ox)} {_num(oy)}) "{ORIENT[c.orient]}")')
        cnt["instances"] += 1
    unknown_via: dict[str, int] = {}
    if include_routes:
        def width(layer: str) -> float:
            t = tlef_layers.get(layer)
            return t.width if t is not None and t.width else 0.0

        def rect(layer: str, x0: float, y0: float, x1: float, y1: float) -> None:
            if x1 - x0 > 1e-6 and y1 - y0 > 1e-6 and inside((x0, y0, x1, y1)):
                stmts.append(f'dbCreateRect(cv list("{layer}" "drawing") list(list({_num(x0)} {_num(y0)}) list({_num(x1)} {_num(y1)})))')

        for net in d.nets.values():
            if net.special:
                continue
            for layer, x0, y0, x1, y1 in net.segs:
                hw = width(layer) / 2
                if hw <= 0:
                    unknown_via["layer:" + layer] = unknown_via.get("layer:" + layer, 0) + 1
                    continue
                before = len(stmts)
                rect(layer, min(x0, x1) - hw, min(y0, y1) - hw, max(x0, x1) + hw, max(y0, y1) + hw)
                cnt["wires"] += len(stmts) - before
            for name, x, y in net.via_at:
                shp = tlef_vias.get(name) or (def_via_shapes(d.vias[name]) if name in d.vias else None)
                if not shp:
                    unknown_via[name] = unknown_via.get(name, 0) + 1
                    continue
                before = len(stmts)
                for layer, a, b, e, f in shp:
                    rect(layer, x + a, y + b, x + e, y + f)
                cnt["vias"] += 1 if len(stmts) > before else 0
            for layer, x0, y0, x1, y1 in net.rects:
                before = len(stmts)
                rect(layer, x0, y0, x1, y1)
                cnt["patches"] += len(stmts) - before
    chunks = []
    head = f'; vvirt def_export: {cell} <- DEF {d.name}  ({{n}} statements)\nlet((cv) cv = dbOpenCellViewByType("{lib}" "{cell}" "layout" "maskLayout" "a")\n'
    for i in range(0, len(stmts), chunk_stmts):
        part = stmts[i:i + chunk_stmts]
        chunks.append(head.format(n=len(part)) + "  " + "\n  ".join(part) + "\n  dbSave(cv))\n")
    return Export(chunks, {**cnt, "statements": len(stmts), "chunks": len(chunks), "masters_without_size": missing, "unknown_vias_or_layers": unknown_via,
                           "unverified_orientations": sorted(unver), "window": window})


def write(ex: Export, out_dir: str, base: str) -> list[str]:
    """base_000.il ... + base_load.il (load() of every chunk in order, paths relative to the loader)."""
    os.makedirs(out_dir, exist_ok=True)
    names = []
    for i, ch in enumerate(ex.chunks):
        n = f"{base}_{i:03d}.il"
        open(os.path.join(out_dir, n), "w", encoding="utf-8").write(ch)
        names.append(n)
    loader = os.path.join(out_dir, f"{base}_load.il")
    base_dir = out_dir.replace(os.sep, "/")
    open(loader, "w", encoding="utf-8").write("; load every chunk in order (edit the directory if you copied the files)\n" + "\n".join(f'load("{base_dir}/{n}")' for n in names) + "\n")
    return names + [os.path.basename(loader)]
