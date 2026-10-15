"""Virtuoso SKILL function set backed by the virtual design database."""
from __future__ import annotations

import os
from typing import Any

from . import layers
from .export import export_gds, render_svg
from .odb import (CellView, Database, DdObj, Instance, ORIENTS, Shape, TechFile, Via, Window, _pt, _pts, bbox_of_points,
                  transform_bbox)
from .skill_lang import Interp, Keyword, SkillError, Sym, skill_repr

# GUI / forms / Maestro / CDF functions that exist in Virtuoso but have no meaning here: accept anything, return nil.
STUBS = [
    "hiCreateButton", "hiCreateLabel", "hiCreateMenuItem", "hiCreateBooleanButton", "hiCreateIntField", "hiCreateAppForm",
    "hiDisplayForm", "hiInsertBannerMenu", "hiCreatePulldownMenu", "hiRaiseWindow", "hiRedraw", "hiZoomAbsoluteScale", "hiZoomIn",
    "hiZoomOut", "hiSetCurrentWindow", "hiSetWindowName", "hiSetBindKey", "hiRegTimer", "hiCloseForm",
    "leMarkNet", "leHiUnmarkNet", "leHiFit", "leSetEntryLayer", "pteSetActiveLpp", "pteSetNoneVisible", "pteSetVisible",
    "pteSetAllVisible", "leSetAllLayerVisible", "leSetLayerVisible", "geSetDisplayLayers", "geDeselectAll",
    "dbSetConnCurrent", "envSetVal", "envGetVal", "cdfUpdateInstParam", "CCSsetPAdlg", "ciwGetOutput",
    "axlSetDefaultLibrary", "dbUpdateAllCellViews",
]

READONLY_STD = "*Error* the standard-cell library %s is read-only; create your own library/cell instead"


def install(interp: Interp, db: Database, out_dir: str) -> None:
    F = interp.funcs
    # extra core language builtins (setq, comparison, lists, properties, strings, regexp, workspace-confined file I/O)
    from . import skill_core_ext

    skill_core_ext.install(interp, os.path.dirname(os.path.abspath(out_dir)))
    state = {"cwin": None}

    def need_cv(cv: Any, fn: str) -> CellView:
        if not isinstance(cv, CellView):
            raise SkillError(f"*Error* {fn}: argument #1 should be a cellview (db object)", cv)
        if cv.readonly or cv.std:
            raise SkillError(f"*Error* {fn}: cellview {cv.lib}/{cv.cell}/{cv.view} is not open for edit")
        if not cv.opened:
            raise SkillError(f"*Error* {fn}: cellview is closed")
        return cv

    def lpp(fn: str, v: Any) -> tuple[str, str]:
        if not (isinstance(v, list) and len(v) == 2 and all(isinstance(x, str) for x in v)):
            raise SkillError(f"*Error* {fn}: layer-purpose pair should be list(\"layer\" \"purpose\")", v)
        layer, purpose = v
        c = layers.canonical(layer)
        if c is None:
            raise SkillError(f"*Error* {fn}: layer {layer} is not defined in the technology (sky130A). Valid layers: " + " ".join(sorted(layers.LPP)))
        ps = layers.LPP[c]
        if purpose not in ps:
            raise SkillError(f"*Error* {fn}: purpose {purpose} is not defined for layer {layer}. Valid purposes: " + " ".join(sorted(ps)))
        return layer, purpose

    def orient(fn: str, o: Any) -> str:
        o = "R0" if o is None else str(o)
        if o not in ORIENTS:
            raise SkillError(f"*Error* {fn}: bad orientation {o}. Valid: " + " ".join(ORIENTS))
        return o

    def touch(cv: CellView, obj: Any) -> Any:
        cv.dirty = True
        return obj

    # ------------------------------------------------------------------ cellview open/save/close
    def db_open(lib, cell, view, view_type=None, mode="r"):
        lib, cell, view = str(lib), str(cell), str(view)
        if mode not in ("r", "w", "a", "rw", "appendInPlace", "read", "write", None):
            raise SkillError(f"*Error* dbOpenCellViewByType: bad mode {mode}")
        m = {"read": "r", "write": "w", "appendInPlace": "a", "rw": "a"}.get(mode, mode or "r")
        cv = db.open_cv(lib, cell, view, view_type if isinstance(view_type, str) else None, m)
        return cv

    def db_save(cv):
        if not isinstance(cv, CellView):
            raise SkillError("*Error* dbSave: argument #1 should be a cellview", cv)
        if cv.std:
            return None
        return True if db.save(cv) else None

    def db_close(cv):
        if isinstance(cv, CellView):
            db.close(cv)
        return True

    def db_valid(obj):
        if isinstance(obj, CellView):
            return True if obj.opened else None
        return True if obj is not None and getattr(obj, "cv", None) is not None and getattr(obj.cv, "opened", True) else None

    F["dbOpenCellViewByType"] = db_open
    F["dbOpenCellView"] = lambda lib, cell, view, *a: db_open(lib, cell, view, None, "r")
    F["dbSave"] = db_save
    F["dbClose"] = db_close
    F["dbPurge"] = db_close
    F["dbValidP"] = db_valid
    F["dbGetCellViewDdId"] = lambda cv: DdObj(cv.lib, cv.cell, cv.view) if isinstance(cv, CellView) else None
    F["dbFindOpenCellView"] = lambda lib, cell, view: db.open.get((str(lib), str(cell), str(view)))
    F["dbGetOpenCellViews"] = lambda: list(db.open.values()) or None

    # ------------------------------------------------------------------ shapes
    def create_rect(cv, lp, bbox):
        cv = need_cv(cv, "dbCreateRect")
        layer, purpose = lpp("dbCreateRect", lp)
        if not (isinstance(bbox, list) and len(bbox) == 2):
            raise SkillError("*Error* dbCreateRect: bbox should be list(list(x0 y0) list(x1 y1))", bbox)
        a, b = _pt(bbox[0]), _pt(bbox[1])
        if a[0] == b[0] or a[1] == b[1]:
            raise SkillError("*Error* dbCreateRect: degenerate rectangle (zero width or height)")
        pts = [(min(a[0], b[0]), min(a[1], b[1])), (max(a[0], b[0]), max(a[1], b[1]))]
        s = Shape(cv, "rect", layer, purpose, pts)
        cv.shapes.append(s)
        return touch(cv, s)

    def create_polygon(cv, lp, points):
        cv = need_cv(cv, "dbCreatePolygon")
        layer, purpose = lpp("dbCreatePolygon", lp)
        pts = _pts(points)
        if len(pts) < 3:
            raise SkillError("*Error* dbCreatePolygon: at least 3 points are required")
        s = Shape(cv, "polygon", layer, purpose, pts)
        cv.shapes.append(s)
        return touch(cv, s)

    def create_path(cv, lp, points, width, style="truncateExtend", *rest):
        cv = need_cv(cv, "dbCreatePath")
        layer, purpose = lpp("dbCreatePath", lp)
        pts = _pts(points)
        if len(pts) < 2:
            raise SkillError("*Error* dbCreatePath: at least 2 points are required")
        if not isinstance(width, (int, float)) or width <= 0:
            raise SkillError("*Error* dbCreatePath: width should be a positive number", width)
        s = Shape(cv, "path", layer, purpose, pts, float(width), style=str(style or "truncateExtend"))
        cv.shapes.append(s)
        return touch(cv, s)

    def create_label(cv, lp, xy, text, justify="lowerLeft", rotation="R0", font="stick", height=0.1):
        cv = need_cv(cv, "dbCreateLabel")
        layer, purpose = lpp("dbCreateLabel", lp)
        s = Shape(cv, "label", layer, purpose, [_pt(xy)], text=str(text), justify=str(justify), rotation=str(rotation), font=str(font),
                  height=float(height))
        cv.shapes.append(s)
        return touch(cv, s)

    F["dbCreateRect"] = create_rect
    F["dbCreatePolygon"] = create_polygon
    F["dbCreatePath"] = create_path
    F["dbCreateLabel"] = create_label

    # ------------------------------------------------------------------ instances
    def master_of(lib, cell, view, fn):
        m = db.open_cv(str(lib), str(cell), str(view), None, "r")
        if m is None:
            raise SkillError(f"*Error* {fn}: cannot find master {lib}/{cell}/{view}")
        return m

    def create_param_inst(cv, lib, cell, view, name, xy, o="R0", *rest):
        cv = need_cv(cv, "dbCreateParamInstByMasterName")
        m = master_of(lib, cell, view, "dbCreateParamInstByMasterName")
        if m is cv:
            raise SkillError("*Error* dbCreateParamInstByMasterName: a cellview cannot instantiate itself")
        o = orient("dbCreateParamInstByMasterName", o)
        nm = str(name) if isinstance(name, str) and name else cv.new_inst_name()
        if any(i.name == nm for i in cv.instances):
            raise SkillError(f"*Error* dbCreateParamInstByMasterName: instance name {nm} already exists")
        inst = Instance(cv, m, nm, _pt(xy), o)
        cv.instances.append(inst)
        return touch(cv, inst)

    def create_mosaic(cv, master, name, origin, o, rows, cols, row_pitch, col_pitch):
        cv = need_cv(cv, "dbCreateSimpleMosaic")
        if not isinstance(master, CellView):
            raise SkillError("*Error* dbCreateSimpleMosaic: argument #2 should be a master cellview", master)
        o = orient("dbCreateSimpleMosaic", o)
        nm = str(name) if isinstance(name, str) and name else cv.new_inst_name()
        inst = Instance(cv, master, nm, _pt(origin), o, int(rows), int(cols), float(row_pitch), float(col_pitch), True)
        cv.instances.append(inst)
        return touch(cv, inst)

    F["dbCreateParamInstByMasterName"] = create_param_inst
    F["dbCreateInstByMasterName"] = create_param_inst
    F["dbCreateSimpleMosaic"] = create_mosaic
    F["dbCreateInst"] = lambda cv, master, name, xy, o="R0", *r: create_param_inst(cv, master.lib, master.cell, master.view, name, xy, o)

    # ------------------------------------------------------------------ vias / tech
    F["techGetTechFile"] = lambda x: TechFile(x.lib) if hasattr(x, "lib") else (TechFile(str(x)) if isinstance(x, str) else None)
    F["techFindViaDefByName"] = lambda tf, name: db.viadefs.get(str(name))
    F["techGetLayerPurposePair"] = lambda *a: None
    F["techGetTechLibName"] = lambda *a: "sky130_tech"

    def create_via(cv, via_def, xy, o="R0", params=None):
        cv = need_cv(cv, "dbCreateVia")
        if via_def is None:
            raise SkillError("*Error* dbCreateVia: via definition is nil (use techFindViaDefByName; valid names: " + " ".join(sorted(db.viadefs)) + ")")
        o = orient("dbCreateVia", o)
        rows = cols = 1
        pitch = None
        if isinstance(params, list):
            for p in params:
                if isinstance(p, list) and len(p) == 2:
                    k, v = p
                    if k == "cutRows":
                        rows = int(v)
                    elif k == "cutColumns":
                        cols = int(v)
                    elif k == "cutSpacing":
                        pitch = float(via_def.spec["cut_size"]) + float(v if not isinstance(v, list) else v[0])
        v = Via(cv, via_def, _pt(xy), o, rows, cols, pitch)
        cv.vias.append(v)
        return touch(cv, v)

    F["dbCreateVia"] = create_via

    # ------------------------------------------------------------------ modify
    def delete_obj(obj):
        cv = getattr(obj, "cv", None)
        if cv is None or cv.readonly:
            raise SkillError("*Error* dbDeleteObject: object cannot be deleted")
        for lst in (cv.shapes, cv.vias, cv.instances):
            if obj in lst:
                lst.remove(obj)
                cv.dirty = True
                db.selection = [s for s in db.selection if s is not obj]
                return True
        return None

    def move_fig(fig, dest, xform):
        # xform = list(list(x y) orient [mag])
        if not isinstance(xform, list) or len(xform) < 2:
            raise SkillError("*Error* dbMoveFig: transform should be list(list(x y) \"R0\")")
        off = _pt(xform[0])
        o = orient("dbMoveFig", xform[1])
        if o != "R0" and not isinstance(fig, Instance):
            raise SkillError("*Error* dbMoveFig: only instances can be rotated/mirrored here; use R0 for shapes")
        tcv = dest if isinstance(dest, CellView) else fig.cv
        need_cv(tcv, "dbMoveFig")
        if isinstance(fig, Shape):
            fig.points = [(p[0] + off[0], p[1] + off[1]) for p in fig.points]
            fig.cv = tcv
        elif isinstance(fig, Via):
            fig.origin = (fig.origin[0] + off[0], fig.origin[1] + off[1])
        elif isinstance(fig, Instance):
            fig.origin = (fig.origin[0] + off[0], fig.origin[1] + off[1])
            if o != "R0":
                fig.orient = o
        else:
            raise SkillError("*Error* dbMoveFig: not a figure", fig)
        tcv.dirty = True
        return fig

    F["dbDeleteObject"] = delete_obj
    F["dbMoveFig"] = move_fig
    F["dbTransformBBox"] = lambda bb, xf: transform_bbox(bb, xf)

    def copy_fig(fig, dest, xform):
        tcv = need_cv(dest if isinstance(dest, CellView) else fig.cv, "dbCopyFig")
        off = _pt(xform[0]) if isinstance(xform, list) and xform else (0.0, 0.0)
        o = orient("dbCopyFig", xform[1]) if isinstance(xform, list) and len(xform) > 1 else "R0"
        if isinstance(fig, Shape):
            n = Shape(tcv, fig.kind, fig.layer, fig.purpose, [(p[0] + off[0], p[1] + off[1]) for p in fig.points], fig.width, fig.text,
                      fig.justify, fig.rotation, fig.font, fig.height, fig.style)
            tcv.shapes.append(n)
        elif isinstance(fig, Via):
            n = Via(tcv, fig.via_def, (fig.origin[0] + off[0], fig.origin[1] + off[1]), fig.orient, fig.rows, fig.cols, fig.pitch)
            tcv.vias.append(n)
        elif isinstance(fig, Instance):
            n = Instance(tcv, fig.master, tcv.new_inst_name(), (fig.origin[0] + off[0], fig.origin[1] + off[1]), o if o != "R0" else fig.orient,
                         fig.rows, fig.cols, fig.row_pitch, fig.col_pitch, fig.mosaic)
            tcv.instances.append(n)
        else:
            raise SkillError("*Error* dbCopyFig: not a figure", fig)
        tcv.dirty = True
        return n

    F["dbCopyFig"] = copy_fig

    # ------------------------------------------------------------------ windows / selection
    def ge_open(lib=None, cell=None, view=None, viewType=None, mode="a", **kw):
        if lib is None:
            raise SkillError("*Error* geOpen: ?lib is required")
        cv = db_open(lib, cell, view or "layout", viewType, mode)
        if cv is None:
            raise SkillError(f"*Error* geOpen: cannot open {lib}/{cell}/{view or 'layout'}")
        for w in db.windows:
            if w.cv is cv:
                state["cwin"] = w
                db.edit_cv = cv
                return w
        w = Window(cv)
        db.windows.append(w)
        state["cwin"] = w
        db.edit_cv = cv
        return w

    def ge_edit_cv():
        return db.edit_cv if db.edit_cv is not None and db.edit_cv.opened else None

    def window_cv(w):
        if isinstance(w, Window):
            return w.cv
        raise SkillError("*Error* geGetWindowCellView: argument #1 should be a window", w)

    def figs_in(cv: CellView, bb):
        (ax, ay), (bx, by) = _pt(bb[0]), _pt(bb[1])
        x0, x1, y0, y1 = min(ax, bx), max(ax, bx), min(ay, by), max(ay, by)
        res = []
        for f in list(cv.shapes) + list(cv.vias) + list(cv.instances):
            fb = f.bbox() if not isinstance(f, Shape) or f.kind != "label" else bbox_of_points([f.points[0]])
            if fb[0][0] >= x0 - 1e-9 and fb[0][1] >= y0 - 1e-9 and fb[1][0] <= x1 + 1e-9 and fb[1][1] <= y1 + 1e-9:
                res.append(f)
        return res

    def select_area(win, bb, *r):
        cv = window_cv(win)
        for f in figs_in(cv, bb):
            if f not in db.selection:
                db.selection.append(f)
        return True

    def deselect_area(win, bb, *r):
        cv = window_cv(win)
        gone = figs_in(cv, bb)
        db.selection = [s for s in db.selection if s not in gone]
        return True

    def select_all(cv=None, *r):
        cv = cv if isinstance(cv, CellView) else ge_edit_cv()
        if cv is not None:
            db.selection = list(cv.shapes) + list(cv.vias) + list(cv.instances)
        return True

    def deselect_all(cv=None, *r):
        db.selection = []
        return True

    def sel_set(cv=None, *r):
        cv = cv if isinstance(cv, CellView) else ge_edit_cv()
        return [s for s in db.selection if getattr(s, "cv", None) is cv] or None

    def le_delete(*a, **k):
        n = 0
        for s in list(db.selection):
            if delete_obj(s):
                n += 1
        db.selection = []
        return True if n else None

    def save_image(win=None, path=None, *a, **k):
        cv = win.cv if isinstance(win, Window) else ge_edit_cv()
        if cv is None or path is None:
            return None
        svg_path = str(path)
        if svg_path.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp")):
            svg_path = os.path.splitext(svg_path)[0] + ".svg"
        render_svg(db, cv, svg_path)
        return True

    F["geOpen"] = ge_open
    F["geGetEditCellView"] = ge_edit_cv
    F["hiGetWindowList"] = lambda *a: list(db.windows) or None
    F["hiGetCurrentWindow"] = lambda *a: state["cwin"] if state["cwin"] in db.windows else (db.windows[-1] if db.windows else None)
    F["hiGetWindowName"] = lambda w: w.skill_get("name") if isinstance(w, Window) else None
    F["geGetWindowCellView"] = window_cv
    F["hiCloseWindow"] = lambda w: (db.windows.remove(w) if w in db.windows else None, True)[1]
    F["hiGetCIWindow"] = lambda *a: Window(CellView(db, "ciw", "ciw", "ciw"))
    F["geSelectArea"] = select_area
    F["geDeselectArea"] = deselect_area
    F["geSelectAllFig"] = select_all
    F["geDeselectAllFig"] = deselect_all
    F["geGetSelSet"] = sel_set
    F["geGetSelSetCount"] = lambda *a: len(db.selection)
    F["leHiDelete"] = le_delete
    F["hiWindowSaveImage"] = save_image
    F["cdsGetInstPath"] = lambda *a: "/opt/vvirt"
    for name in STUBS:
        F[name] = lambda *a, **k: None

    # ------------------------------------------------------------------ data manager
    def dd_get(lib, cell=None, view=None, *r):
        lib = str(lib)
        if lib not in db.libraries() and lib not in {k[0] for k in db.open}:
            return None
        if cell is None:
            return DdObj(lib)
        if str(cell) not in db.cells(lib):
            return None
        if view is None:
            return DdObj(lib, str(cell))
        return DdObj(lib, str(cell), str(view)) if str(view) in db.views(lib, str(cell)) else None

    def dd_delete(obj):
        if not isinstance(obj, DdObj):
            return None
        if obj.lib == db.std_name:
            raise SkillError(READONLY_STD % obj.lib)
        if obj.cell is None:
            return None  # deleting whole libraries is not allowed
        return True if db.delete_cell(obj.lib, obj.cell) else None

    F["ddGetObj"] = dd_get
    F["ddDeleteObj"] = dd_delete
    F["ddGetObjReadPath"] = lambda o: os.path.join(db.workspace, o.lib, o.cell or "", o.view or "layout", "layout.oa").replace(os.sep, "/") if isinstance(o, DdObj) else None
    F["ddCreateLib"] = lambda name, *a: (db.create_lib(str(name)), DdObj(str(name)))[1]

    # ------------------------------------------------------------------ vvirt extras (discovery + export, not in real Virtuoso)
    def vv_libs():
        return db.libraries() or None

    def vv_cells(lib, pattern=""):
        pat = str(pattern or "").lower()
        return [c for c in db.cells(str(lib)) if pat in c.lower()] or None

    def vv_cell_info(cell):
        c = str(cell)
        m = db.stdlib.masters.get(c)
        if m is None:
            return None
        pins = []
        for p in m.pins.values():
            r0 = p.rects[0] if p.rects else None
            pins.append([p.name, p.direction, p.use, r0[0] if r0 else None, [[r0[1], r0[2]], [r0[3], r0[4]]] if r0 else None])
        return [m.name, m.width, m.height, pins]

    def vv_export_gds(lib, cell, path, view="layout"):
        cv = db.open_cv(str(lib), str(cell), str(view), None, "r")
        if cv is None:
            raise SkillError(f"*Error* vvExportGds: cannot find {lib}/{cell}/{view}")
        info = export_gds(db, cv, str(path))
        return info["path"]

    def vv_export_svg(lib, cell, path=None, view="layout"):
        cv = db.open_cv(str(lib), str(cell), str(view), None, "r")
        if cv is None:
            raise SkillError(f"*Error* vvExportSvg: cannot find {lib}/{cell}/{view}")
        p = str(path) if path else os.path.join(out_dir, f"{lib}__{cell}__{view}.svg")
        render_svg(db, cv, p)
        return p

    def vv_layers(**kw):
        if kw.get("positional"):
            return [[n, sorted(ps)] for n, ps in layers.LPP.items()]
        from .records import rec

        return [rec(("layer", n), ("purposes", sorted(ps))) for n, ps in layers.LPP.items()]

    def vv_viadefs(**kw):
        if kw.get("positional"):
            return [[n, v.spec["bot"], v.spec["cut"], v.spec["top"], v.spec["cut_size"]] for n, v in sorted(db.viadefs.items())]
        from .records import rec

        return [rec(("name", n), ("bottom", v.spec["bot"]), ("cut", v.spec["cut"]), ("top", v.spec["top"]), ("cutSize", v.spec["cut_size"]))
                for n, v in sorted(db.viadefs.items())]

    F["vvLibraries"] = vv_libs
    F["vvCells"] = vv_cells
    F["vvCellInfo"] = vv_cell_info
    F["vvExportGds"] = vv_export_gds
    F["vvExportSvg"] = vv_export_svg
    F["vvLayers"] = vv_layers
    F["vvViaDefs"] = vv_viadefs
    F["vvBBox"] = lambda cv: cv.bbox() if isinstance(cv, CellView) else None

    # ------------------------------------------------------------------ safety: remove anything that reaches the host
    F.pop("setShellEnvVar", None)
    visible_env = {"USER", "LOGNAME", "HOME", "HOSTNAME", "SHELL"}
    # read-only whitelist; the client's daemon guard asks for USER/LOGNAME, everything else reads as unset
    F["getShellEnvVar"] = lambda n: os.environ.get(str(n)) if str(n) in visible_env else None
    F["getWorkingDir"] = lambda: out_dir

    def safe_load(path, *rest):
        p = os.path.realpath(str(path))
        roots = [os.path.realpath(r) for r in ("/tmp", db.workspace, out_dir) if r]
        if not any(p == r or p.startswith(r + os.sep) for r in roots):
            raise SkillError(f"*Error* load: path {path} is outside the allowed directories")
        try:
            with open(p, encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            raise SkillError(f"*Error* load: can't open file {path} ({exc.strerror})")
        interp.eval_text(text)
        return True

    F["load"] = safe_load

    from . import xstream_emu

    xstream_emu.install(interp, db, out_dir)

    # library management, PDK library loading, GDS import, copy PDK cell for editing
    from . import lib_funcs

    lib_funcs.install(interp, db, out_dir)

    # design rules (from the PDK tech LEF), designer-habit profiles, rule checking, rule-aware routing/placement
    from . import rule_funcs

    rule_funcs.install(interp, db)

    # Maestro emulation (ngspice backend): mae* / asi* / axl* subset, vvSch* designs, vvMae* results
    from .maestro import funcs as maestro_funcs

    maestro_funcs.install(interp, db, out_dir)
