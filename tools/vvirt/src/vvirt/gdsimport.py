"""Import GDS structures into editable cellviews (also used to copy a read-only PDK cell into a user library)."""
from __future__ import annotations

from . import layers
from .gdsio import GdsFile
from .odb import CellView, Database, Instance, Shape
from .skill_lang import SkillError

# (reflect, angle) -> Virtuoso orientation
ORIENT = {(False, 0): "R0", (False, 90): "R90", (False, 180): "R180", (False, 270): "R270",
          (True, 0): "MX", (True, 90): "MXR90", (True, 180): "MY", (True, 270): "MYR90"}


class Stats:
    def __init__(self) -> None:
        self.cells = 0
        self.shapes = 0
        self.instances = 0
        self.skipped_shapes = 0
        self.skipped_refs = 0
        self.skipped_layers: dict[tuple[int, int], int] = {}

    def as_list(self) -> list:
        return [self.cells, self.shapes, self.instances, self.skipped_shapes, self.skipped_refs,
                [[a, b, n] for (a, b), n in sorted(self.skipped_layers.items())] or None]


def import_structure(db: Database, gds: GdsFile, src_name: str, lib: str, dst_name: str | None = None,
                     done: dict[str, CellView] | None = None, stats: Stats | None = None, depth: int = 0) -> CellView:
    """Create lib/dst_name/layout from structure src_name (children are imported first, same names)."""
    done = {} if done is None else done
    stats = stats or Stats()
    if src_name in done and dst_name is None:
        return done[src_name]
    if depth > 32:
        raise SkillError("*Error* GDS import: hierarchy too deep (recursive references?)")
    u = gds.dbu_um
    geo = gds.read_cell(src_name)
    name = dst_name or src_name
    # children first so their masters exist when the SREFs are created
    children = {r[0] for r in geo["srefs"]} | {r[0] for r in geo["arefs"]}
    for c in sorted(children):
        if c in gds.index and c not in done:
            import_structure(db, gds, c, lib, None, done, stats, depth + 1)
    cv = db.open_cv(lib, name, "layout", "maskLayout", "w")
    assert cv is not None

    def pt(p):
        return (round(p[0] * u, 4), round(p[1] * u, 4))

    for ly, dt, pts in geo["polys"]:
        lp = layers.from_gds(ly, dt)
        if lp is None:
            stats.skipped_shapes += 1
            stats.skipped_layers[(ly, dt)] = stats.skipped_layers.get((ly, dt), 0) + 1
            continue
        xy = [pt(p) for p in pts]
        xs, ys = {p[0] for p in xy}, {p[1] for p in xy}
        if len(xy) == 4 and len(xs) == 2 and len(ys) == 2:
            cv.shapes.append(Shape(cv, "rect", lp[0], lp[1], [(min(xs), min(ys)), (max(xs), max(ys))]))
        else:
            cv.shapes.append(Shape(cv, "polygon", lp[0], lp[1], xy))
        stats.shapes += 1
    for ly, dt, w, pts, ptype in geo["paths"]:
        lp = layers.from_gds(ly, dt)
        if lp is None:
            stats.skipped_shapes += 1
            stats.skipped_layers[(ly, dt)] = stats.skipped_layers.get((ly, dt), 0) + 1
            continue
        cv.shapes.append(Shape(cv, "path", lp[0], lp[1], [pt(p) for p in pts], round(w * u, 4),
                               style="truncateExtend" if ptype == 2 else "truncate"))
        stats.shapes += 1
    for ly, dt, xy, text in geo["texts"]:
        lp = layers.from_gds(ly, dt)
        if lp is None:
            stats.skipped_shapes += 1
            stats.skipped_layers[(ly, dt)] = stats.skipped_layers.get((ly, dt), 0) + 1
            continue
        cv.shapes.append(Shape(cv, "label", lp[0], lp[1], [pt(xy)], text=text, height=0.1))
        stats.shapes += 1
    for sname, xy, reflect, angle, mag in geo["srefs"]:
        o = ORIENT.get((bool(reflect), int(round(angle)) % 360)) if abs(mag - 1.0) < 1e-9 else None
        master = done.get(sname) or db.open_cv(lib, sname, "layout", None, "r")
        if o is None or master is None:
            stats.skipped_refs += 1
            continue
        cv.instances.append(Instance(cv, master, cv.new_inst_name(), pt(xy), o))
        stats.instances += 1
    stats.skipped_refs += len(geo["arefs"])  # array references are not converted
    cv.dirty = True
    db.save(cv)
    stats.cells += 1
    done[src_name] = cv
    return cv


def import_gds(db: Database, lib: str, path: str, top: str | None = None) -> Stats:
    if not db.lib_exists(lib) or db.is_std(lib) or lib == db.TECH_LIB:
        raise SkillError(f"*Error* vvImportGds: library {lib} must be an existing user library (create it with ddCreateLib)")
    gds = GdsFile(path)
    names = [top] if top else gds.cells()
    if top and top not in gds.index:
        raise SkillError(f"*Error* vvImportGds: structure {top} not in {path}. Structures: " + " ".join(gds.cells()[:20]))
    stats, done = Stats(), {}
    for n in names:
        if n not in done:
            import_structure(db, gds, n, lib, None, done, stats)
    for cv in done.values():
        db.close(cv)
    return stats


def copy_cell(db: Database, src_lib: str, src_cell: str, dst_lib: str, dst_cell: str) -> CellView:
    """Copy a cell (any library, including read-only PDK libraries) into an editable user library; returns it open for edit."""
    if not db.lib_exists(dst_lib) or db.is_std(dst_lib) or dst_lib == db.TECH_LIB:
        raise SkillError(f"*Error* copy: destination library {dst_lib} must be an existing user library")
    if db.exists(dst_lib, dst_cell, "layout"):
        raise SkillError(f"*Error* copy: {dst_lib}/{dst_cell}/layout already exists")
    if db.is_std(src_lib):
        sl = db.std[src_lib]
        if sl.gds is None or src_cell not in sl.gds.index:
            raise SkillError(f"*Error* copy: no layout for {src_lib}/{src_cell}")
        stats = Stats()
        cv = import_structure(db, sl.gds, src_cell, dst_lib, dst_cell, {}, stats)
        db.close(cv)
        return db.open_cv(dst_lib, dst_cell, "layout", "maskLayout", "a")  # type: ignore[return-value]
    src = db.open_cv(src_lib, src_cell, "layout", None, "r")
    if src is None:
        raise SkillError(f"*Error* copy: cannot find {src_lib}/{src_cell}/layout")
    dst = db.open_cv(dst_lib, dst_cell, "layout", "maskLayout", "w")
    assert dst is not None
    for s in src.shapes:
        dst.shapes.append(Shape(dst, s.kind, s.layer, s.purpose, list(s.points), s.width, s.text, s.justify, s.rotation, s.font, s.height, s.style))
    from .odb import Via

    for v in src.vias:
        dst.vias.append(Via(dst, v.via_def, v.origin, v.orient, v.rows, v.cols, v.pitch))
    for i in src.instances:
        dst.instances.append(Instance(dst, i.master, i.name, i.origin, i.orient, i.rows, i.cols, i.row_pitch, i.col_pitch, i.mosaic))
    dst.dirty = True
    db.save(dst)
    return dst
