"""GDS stream-out and SVG rendering of a cellview hierarchy."""
from __future__ import annotations

import html
import os

from . import layers
from .gdsio import write_gds
from .odb import CellView, Database, Instance, bbox_union, bbox_of_points

DBU_UM = 0.001  # 1 nm database unit


def _strans(orient: str) -> tuple[bool, float]:
    return {"R0": (False, 0.0), "R90": (False, 90.0), "R180": (False, 180.0), "R270": (False, 270.0),
            "MX": (True, 0.0), "MY": (True, 180.0), "MXR90": (True, 90.0), "MYR90": (True, 270.0)}.get(orient, (False, 0.0))


def _i(v: float) -> int:
    return int(round(v / DBU_UM))


def _collect(db: Database, cv: CellView, structs: dict, seen: set, ctx: dict | None = None) -> None:
    ctx = ctx if ctx is not None else {"map": layers.to_gds, "warn": set(), "translated": []}
    name = cv.cell if not cv.std else cv.cell
    if (cv.lib, cv.cell) in seen:
        return
    seen.add((cv.lib, cv.cell))
    if cv.std:
        _std_struct(db, cv.lib, cv.cell, structs)
        return
    st: dict[str, list] = {"polys": [], "paths": [], "texts": [], "srefs": []}
    ctx["translated"].append((cv.lib, cv.cell, cv.view, _sname(cv)))
    for s in cv.shapes:
        lp = ctx["map"](s.layer, s.purpose)
        if lp is None:
            ctx["warn"].add((canon_name(s.layer), s.purpose))
            continue
        if s.kind == "label":
            st["texts"].append((lp[0], lp[1], (_i(s.points[0][0]), _i(s.points[0][1])), s.text))
        elif s.kind == "path":
            st["paths"].append((lp[0], lp[1], _i(s.width), [(_i(x), _i(y)) for x, y in s.points], 0 if s.style in ("truncate", "flush") else 2))
        else:
            st["polys"].append((lp[0], lp[1], [(_i(x), _i(y)) for x, y in s.polygon()]))
    for v in cv.vias:
        for lay, bb in v.rects():
            lp = ctx["map"](lay, "drawing")
            if lp is None:
                ctx["warn"].add((lay, "drawing"))
                continue
            (x0, y0), (x1, y1) = bb
            st["polys"].append((lp[0], lp[1], [(_i(x0), _i(y0)), (_i(x1), _i(y0)), (_i(x1), _i(y1)), (_i(x0), _i(y1))]))
    for inst in cv.instances:
        _collect(db, inst.master, structs, seen, ctx)
        refl, ang = _strans(inst.orient)
        for ox, oy in inst.origins():
            st["srefs"].append((_sname(inst.master), (_i(ox), _i(oy)), refl, ang, 1.0))
    structs[_sname(cv)] = st


def _sname(cv: CellView) -> str:
    return cv.cell


def _std_struct(db: Database, lib: str, cell: str, structs: dict) -> None:
    sl = db.std[lib]
    if cell in structs or sl.gds is None or cell not in sl.gds.index:
        return
    geo = sl.cell_geometry(cell)
    structs[cell] = {"polys": geo["polys"], "paths": geo["paths"], "texts": geo["texts"],
                     "srefs": [(n, xy, r, a, m) for n, xy, r, a, m in geo["srefs"]]}
    for n, *_ in geo["srefs"]:
        _std_struct(db, lib, n, structs)


def canon_name(layer: str) -> str:
    return layers.canonical(layer) or layer


def export_gds(db: Database, cv: CellView, path: str, mapper=None) -> dict:
    """Write cv (and its hierarchy) to GDS. mapper(layer, purpose) -> (gds layer, datatype) | None overrides the built-in sky130 map."""
    structs: dict = {}
    ctx = {"map": mapper or layers.to_gds, "warn": set(), "translated": []}
    _collect(db, cv, structs, set(), ctx)
    # parents after children
    order = {}
    for n in structs:
        order[n] = structs[n]
    top = cv.cell
    ordered = {k: v for k, v in order.items() if k != top}
    ordered[top] = order[top]
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    write_gds(path, cv.lib, ordered, dbu_m=1e-9, user_per_dbu=DBU_UM)
    return {"path": path, "structures": len(ordered), "bytes": os.path.getsize(path), "unmapped": sorted(ctx["warn"]),
            "translated": ctx["translated"]}


from .render import render_svg  # noqa: E402,F401  (kept here so existing imports keep working)
