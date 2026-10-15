"""GDS summary and structure-by-structure comparison, in the named-field style of records.py.

Scope, stated in every result: shapes are compared per structure (not flattened), polygons by their canonical vertex
loop, paths and text exactly, references by (target, position, orientation). Layer areas add every shape's area; shapes that
overlap are counted twice, so the area is a size indicator, not a merged-mask area. 'identical' therefore means the two
files hold the same shapes in the same structures, not that they are electrically or lithographically equivalent.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from . import records
from .gdsio import GdsFile

SCOPE = ["per structure, not flattened", "polygons by canonical vertex loop; paths, text, references exact",
         "layer area sums shapes (overlaps counted twice); path area = centreline length x width", "no electrical or DRC meaning"]


def _poly_area(pts: list[tuple[int, int]]) -> float:
    s = 0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        s += x0 * y1 - x1 * y0
    return s / 2.0


def _canon(pts: list[tuple[int, int]]) -> tuple:
    p = list(pts)
    if _poly_area(p) < 0:
        p.reverse()
    k = p.index(min(p)) if p else 0
    return tuple(p[k:] + p[:k])


def _bbox(boxes: list[tuple[int, int, int, int]]) -> tuple | None:
    if not boxes:
        return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _pts_box(pts) -> tuple[int, int, int, int]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


class _Cell:
    """One structure reduced to comparable sets and per-layer statistics (database units)."""

    def __init__(self, data: dict[str, list]) -> None:
        self.polys: dict[tuple[int, int], set] = defaultdict(set)
        self.paths: dict[tuple[int, int], set] = defaultdict(set)
        self.texts: set = set()
        self.refs: set = set()
        self.area: dict[tuple[int, int], float] = defaultdict(float)
        self.count: dict[tuple[int, int], int] = defaultdict(int)
        boxes = []
        for layer, dt, pts in data["polys"]:
            key = (layer, dt)
            self.polys[key].add(_canon(pts))
            self.area[key] += abs(_poly_area(pts))
            self.count[key] += 1
            boxes.append(_pts_box(pts))
        for layer, dt, width, xy, ptype in data["paths"]:
            key = (layer, dt)
            self.paths[key].add((width, ptype, tuple(xy)))
            length = sum(abs(xy[i + 1][0] - xy[i][0]) + abs(xy[i + 1][1] - xy[i][1]) for i in range(len(xy) - 1))
            self.area[key] += length * width
            self.count[key] += 1
            half = width // 2
            b = _pts_box(xy)
            horizontal = all(p[1] == xy[0][1] for p in xy)
            vertical = all(p[0] == xy[0][0] for p in xy)
            if ptype == 2 or not (horizontal or vertical):
                boxes.append((b[0] - half, b[1] - half, b[2] + half, b[3] + half))   # extended ends / non-Manhattan: all sides
            elif horizontal:
                boxes.append((b[0], b[1] - half, b[2], b[3] + half))
            else:
                boxes.append((b[0] - half, b[1], b[2] + half, b[3]))
        for layer, dt, xy, s in data["texts"]:
            self.texts.add((layer, dt, tuple(xy), s))
        for sname, xy, refl, ang, mag in data["srefs"]:
            self.refs.add((sname, tuple(xy), refl, round(ang, 6), round(mag, 6)))
        for sname, xy, refl, ang, mag, colrow in data["arefs"]:
            self.refs.add((sname, tuple(xy), refl, round(ang, 6), round(mag, 6), tuple(colrow) if colrow else None))
        self.bbox = _bbox(boxes)

    def layers(self) -> list[tuple[int, int]]:
        return sorted(set(self.count))


def _load(path: str) -> tuple[GdsFile, dict[str, _Cell]]:
    g = GdsFile(path)
    return g, {n: _Cell(g.read_cell(n)) for n in g.cells()}


def _tops(cells: dict[str, _Cell]) -> list[str]:
    used = {r[0] for c in cells.values() for r in c.refs}
    return [n for n in cells if n not in used]


def _um(v: float, dbu_um: float) -> float:
    return round(v * dbu_um, 4)


def summary(path: str, top: str | None = None) -> list:
    g, cells = _load(path)
    d = g.dbu_um
    if top is not None and top not in cells:
        raise KeyError(f"structure {top} not in {path}. Structures: " + " ".join(list(cells)[:20]))
    names = [top] if top else list(cells)
    out = []
    for n in names:
        c = cells[n]
        bb = c.bbox
        out.append(records.rec(
            ("name", n), ("shapes", sum(c.count.values())), ("texts", len(c.texts)), ("references", len(c.refs)),
            ("bboxUm", None if bb is None else [[_um(bb[0], d), _um(bb[1], d)], [_um(bb[2], d), _um(bb[3], d)]]),
            ("layers", [records.rec(("layer", l), ("datatype", dt), ("shapes", c.count[(l, dt)]), ("areaUm2", round(c.area[(l, dt)] * d * d, 4)))
                        for (l, dt) in c.layers()])))
    return records.rec(("file", path), ("dbuUm", d), ("structures", len(cells)), ("tops", _tops(cells)),
                       ("cells", out), ("scope", SCOPE))


def compare(path_a: str, path_b: str, top: str | None = None, limit: int = 20) -> list:
    ga, ca = _load(path_a)
    gb, cb = _load(path_b)
    d = ga.dbu_um
    unit_mismatch = abs(ga.dbu_um - gb.dbu_um) > 1e-12
    names_a, names_b = set(ca), set(cb)
    only_a, only_b = sorted(names_a - names_b), sorted(names_b - names_a)
    common = sorted(names_a & names_b)
    if top is not None:
        if top not in common:
            raise KeyError(f"structure {top} must be in both files")
        common = [top]
    changed = []
    total_added = total_removed = 0
    for n in common:
        a, b = ca[n], cb[n]
        layer_rows = []
        shapes_added = shapes_removed = 0
        examples = []
        for key in sorted(set(a.layers()) | set(b.layers())):
            pa, pb = a.polys.get(key, set()), b.polys.get(key, set())
            qa, qb = a.paths.get(key, set()), b.paths.get(key, set())
            add, rem = (pb - pa), (pa - pb)
            add_p, rem_p = (qb - qa), (qa - qb)
            n_add, n_rem = len(add) + len(add_p), len(rem) + len(rem_p)
            if n_add or n_rem:
                shapes_added += n_add
                shapes_removed += n_rem
                layer_rows.append(records.rec(("layer", key[0]), ("datatype", key[1]), ("added", n_add), ("removed", n_rem),
                                              ("areaDeltaUm2", round((b.area.get(key, 0.0) - a.area.get(key, 0.0)) * d * d, 4))))
                for tag, items in (("added", add), ("removed", rem)):
                    for poly in sorted(items)[:max(0, limit - len(examples))]:
                        bx = _pts_box(poly)
                        examples.append(records.rec(("change", tag), ("layer", key[0]), ("datatype", key[1]),
                                                    ("bboxUm", [[_um(bx[0], d), _um(bx[1], d)], [_um(bx[2], d), _um(bx[3], d)]])))
        tx_add, tx_rem = sorted(b.texts - a.texts), sorted(a.texts - b.texts)
        rf_add, rf_rem = sorted(b.refs - a.refs, key=repr), sorted(a.refs - b.refs, key=repr)
        if layer_rows or tx_add or tx_rem or rf_add or rf_rem:
            changed.append(records.rec(
                ("name", n), ("shapesAdded", shapes_added), ("shapesRemoved", shapes_removed),
                ("textAdded", [t[3] for t in tx_add[:limit]] or None), ("textRemoved", [t[3] for t in tx_rem[:limit]] or None),
                ("referencesAdded", len(rf_add)), ("referencesRemoved", len(rf_rem)),
                ("movedOrChangedReferences", sorted({r[0] for r in rf_add} & {r[0] for r in rf_rem}) or None),
                ("layers", layer_rows or None), ("examples", examples or None)))
        total_added += shapes_added + len(rf_add) + len(tx_add)
        total_removed += shapes_removed + len(rf_rem) + len(tx_rem)
    identical = not (only_a or only_b or changed) and not unit_mismatch
    return records.rec(
        ("a", path_a), ("b", path_b), ("identical", identical),
        ("unitMismatch", unit_mismatch or None),
        ("structuresOnlyInA", only_a or None), ("structuresOnlyInB", only_b or None),
        ("changedStructures", len(changed)), ("unchangedStructures", len(common) - len(changed)),
        ("elementsAdded", total_added), ("elementsRemoved", total_removed),
        ("changes", changed or None), ("scope", SCOPE))
