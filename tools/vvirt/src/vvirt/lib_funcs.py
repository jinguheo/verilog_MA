"""SKILL functions for library management: open/list/create/delete libraries, technology binding, loading PDK libraries
and GDS files, and copying a (read-only) PDK cell into an editable user library."""
from __future__ import annotations

import os
from typing import Any

from . import api_registry, gdsimport, records
from .odb import CellView, Database, DdObj, TechFile
from .skill_lang import Interp, SkillError


def install(interp: Interp, db: Database, out_dir: str) -> None:
    F = interp.funcs

    def libname(x: Any) -> str:
        if isinstance(x, DdObj):
            return x.lib
        if isinstance(x, CellView):
            return x.lib
        return str(x)

    def allowed(path: str) -> bool:
        p = os.path.realpath(path)
        roots = [os.path.realpath(r) for r in ("/tmp", db.workspace, out_dir, db.stdlib.root or "/nonexistent") if r]
        return any(p == r or p.startswith(r + os.sep) for r in roots)

    # ------------------------------------------------------------------ dd* (data manager)
    def dd_get(lib, cell=None, view=None, *rest):
        lib = libname(lib) if cell is None else str(lib)
        if not db.lib_exists(lib):
            return None
        if cell is None:
            return DdObj(lib, None, None, db)
        if str(cell) not in db.cells(lib):
            return None
        if view is None:
            return DdObj(lib, str(cell), None, db)
        return DdObj(lib, str(cell), str(view), db) if str(view) in db.views(lib, str(cell)) else None

    def dd_create_lib(name, path=None, *rest):
        name = str(name)
        if db.lib_exists(name):
            return None  # real ddCreateLib fails for an existing name
        db.create_lib(name, str(path) if path else None)
        return DdObj(name, None, None, db)

    def dd_delete(obj):
        if not isinstance(obj, DdObj):
            return None
        if db.is_std(obj.lib) or obj.lib == db.TECH_LIB:
            raise SkillError(f"*Error* ddDeleteObj: {obj.lib} is a read-only PDK library")
        if obj.cell is None:
            return True if db.delete_lib(obj.lib) else None
        return True if db.delete_cell(obj.lib, obj.cell) else None

    F["ddGetObj"] = dd_get
    F["ddCreateLib"] = dd_create_lib
    F["ddDeleteObj"] = dd_delete
    F["ddGetLibList"] = lambda *a: [DdObj(n, None, None, db) for n in db.libraries()] or None
    F["ddUpdateLibList"] = lambda *a: True
    F["ddIsObjWritable"] = lambda o: None if (not isinstance(o, DdObj) or db.is_std(o.lib) or o.lib == db.TECH_LIB) else True
    F["ddGetObjReadPath"] = lambda o: ((os.path.join(db.lib_path(o.lib), o.cell or "", o.view or "layout", "layout.oa")).replace(os.sep, "/")
                                         if isinstance(o, DdObj) and o.cell else (db.lib_path(o.lib) if isinstance(o, DdObj) else None))

    # ------------------------------------------------------------------ tech binding
    def tech_bind(lib, tech):
        n, t = libname(lib), str(tech)
        if db.is_std(n) or not db.lib_exists(n):
            return None
        if t != db.TECH_LIB:
            raise SkillError(f"*Error* techBindTechFile: technology library {t} does not exist. Available: {db.TECH_LIB}")
        db.tech[n] = t
        db._save_registry()
        return True

    F["techBindTechFile"] = tech_bind
    F["techSetTechLibName"] = tech_bind
    F["techGetTechLibName"] = lambda lib: (db.TECH_LIB if db.is_std(libname(lib)) else (db.tech.get(libname(lib)) or None))

    def tech_file(x):
        n = libname(x) if not isinstance(x, str) else x
        if not db.lib_exists(n):
            return None
        return TechFile(n) if (db.is_std(n) or n == db.TECH_LIB or db.tech.get(n)) else None  # unbound library -> no techfile

    F["techGetTechFile"] = tech_file

    # ------------------------------------------------------------------ restricted file predicates
    F["isDir"] = lambda p: True if allowed(str(p)) and os.path.isdir(str(p)) else None
    F["isFile"] = lambda p: True if allowed(str(p)) and os.path.isfile(str(p)) else None
    F["isWritable"] = lambda p: True if allowed(str(p)) and os.access(str(p), os.W_OK) else None

    # ------------------------------------------------------------------ real PDK libraries / GDS / copy
    def attach(name, **kw):
        lib = db.attach_pdk_lib(str(name))
        if kw.get("positional"):
            return [lib.libname, len(lib.masters), lib.gds is not None]
        return records.rec(("library", lib.libname), ("cells", len(lib.masters)), ("hasGds", lib.gds is not None))

    def v_import(lib, path, top=None, **kw):
        p = str(path)
        if not allowed(p) or not os.path.isfile(p):
            raise SkillError(f"*Error* vvImportGds: cannot read {p} (allowed: workspace, /tmp, the PDK)")
        st = gdsimport.import_gds(db, str(lib), p, str(top) if top else None)
        if kw.get("positional"):
            return st.as_list()
        return records.rec(("cells", st.cells), ("shapes", st.shapes), ("instances", st.instances), ("skippedShapes", st.skipped_shapes),
                           ("skippedRefs", st.skipped_refs),
                           ("skippedLayers", [records.rec(("layer", a), ("datatype", b), ("count", n)) for (a, b), n in sorted(st.skipped_layers.items())] or None))

    def v_copy(src_lib, src_cell, dst_lib, dst_cell=None):
        cv = gdsimport.copy_cell(db, libname(src_lib), str(src_cell), str(dst_lib), str(dst_cell or src_cell))
        return cv

    def cp_view(src, dst_lib, dst_cell, dst_view="layout"):
        if not isinstance(src, CellView):
            raise SkillError("*Error* dbCopyCellView: argument #1 should be a cellview", src)
        return gdsimport.copy_cell(db, src.lib, src.cell, str(dst_lib), str(dst_cell))

    F["vvAttachPdkLib"] = attach
    F["vvImportGds"] = v_import
    F["vvCopyCell"] = v_copy
    F["dbCopyCellView"] = cp_view
    F["vvPdkLibs"] = lambda: sorted(os.listdir(os.path.join(db.stdlib.root, "libs.ref"))) if db.stdlib.root else None

    # cell info across every attached PDK library: vvCellInfo(cell [lib])
    def cell_info(cell, lib=None, **kw):
        c = str(cell)
        for ln, sl in db.std.items():
            if lib is not None and str(lib) != ln:
                continue
            m = sl.masters.get(c)
            if m is None:
                continue
            if kw.get("positional"):
                pins = []
                for p in m.pins.values():
                    r0 = p.rects[0] if p.rects else None
                    pins.append([p.name, p.direction, p.use, r0[0] if r0 else None, [[r0[1], r0[2]], [r0[3], r0[4]]] if r0 else None])
                return [m.name, m.width, m.height, pins]
            pins = []
            for p in m.pins.values():
                r0 = p.rects[0] if p.rects else None
                pins.append(records.rec(("name", p.name), ("direction", p.direction), ("use", p.use), ("layer", r0[0] if r0 else None),
                                        ("bbox", [[r0[1], r0[2]], [r0[3], r0[4]]] if r0 else None),
                                        ("center", [round((r0[1] + r0[3]) / 2, 4), round((r0[2] + r0[4]) / 2, 4)] if r0 else None)))
            return records.rec(("name", m.name), ("library", ln), ("width", m.width), ("height", m.height), ("pins", pins or None))
        return None

    F["vvCellInfo"] = cell_info

    def v_pin(cell, pin, lib=None):
        info = cell_info(cell, lib)
        if info is None:
            raise SkillError(f"*Error* vvPin: no PDK cell {cell}. Search with vvCells(lib \"part-of-name\")")
        for p in records.get(info, "pins") or []:
            if records.get(p, "name") == str(pin):
                return p
        raise SkillError(f"*Error* vvPin: cell {cell} has no pin {pin}. Pins: " + " ".join(records.get(q, "name") for q in records.get(info, "pins") or []))

    F["vvPin"] = v_pin

    # discovery: what exists, how to call it, how to read results
    def v_help(name):
        r = api_registry.help_record(str(name))
        if r is None:
            near = [n for n in api_registry.names() if str(name).lower() in n.lower()][:8]
            raise SkillError(f"*Error* vvHelp: no vv* function named {name}." + (f" Similar: {' '.join(near)}" if near else " Call vvApi() for the list."))
        return r

    F["vvApi"] = lambda *a: api_registry.summary_rows()
    F["vvHelp"] = v_help
    F["vvGet"] = lambda rec_, *path: records.get(rec_, *path)
