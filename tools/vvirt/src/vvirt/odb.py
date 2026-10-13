"""In-memory design database: libraries, cellviews, shapes, vias and instances, with JSON persistence.

Coordinates are micrometres (floats), as in Virtuoso layout SKILL. Objects expose Virtuoso-style attributes
through skill_get(), so `shape~>bBox`, `cv~>instances`, `inst~>xy` ... work in the SKILL interpreter.
"""
from __future__ import annotations

import json
import math
import os
from typing import Any

from . import layers
from .gdsio import path_to_polygon
from .skill_lang import SkillError
from .stdcell import StdCellLib

ORIENTS = ("R0", "R90", "R180", "R270", "MX", "MY", "MXR90", "MYR90")


def r3(v: float) -> float:
    return round(float(v), 4)


def apply_orient(orient: str, x: float, y: float) -> tuple[float, float]:
    """Transform a point about the origin: mirror first (MX/MY), then rotate counter-clockwise."""
    o = orient or "R0"
    if o in ("MX", "MXR90"):
        y = -y
    elif o in ("MY", "MYR90"):
        x = -x
    if o in ("R90", "MXR90", "MYR90"):
        x, y = -y, x
    elif o == "R180":
        x, y = -x, -y
    elif o == "R270":
        x, y = y, -x
    return x, y


def transform_point(p: tuple[float, float], origin: tuple[float, float], orient: str, mag: float = 1.0) -> tuple[float, float]:
    x, y = apply_orient(orient, p[0] * mag, p[1] * mag)
    return x + origin[0], y + origin[1]


def bbox_of_points(pts: list[tuple[float, float]]) -> list[list[float]]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [[r3(min(xs)), r3(min(ys))], [r3(max(xs)), r3(max(ys))]]


def bbox_union(a: list[list[float]] | None, b: list[list[float]] | None) -> list[list[float]] | None:
    if a is None:
        return b
    if b is None:
        return a
    return [[min(a[0][0], b[0][0]), min(a[0][1], b[0][1])], [max(a[1][0], b[1][0]), max(a[1][1], b[1][1])]]


def _pt(p: Any) -> tuple[float, float]:
    if isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(c, (int, float)) for c in p):
        return float(p[0]), float(p[1])
    raise SkillError("*Error* expected a point (x y)", p)


def _pts(lst: Any) -> list[tuple[float, float]]:
    if not isinstance(lst, list):
        raise SkillError("*Error* expected a list of points", lst)
    return [_pt(p) for p in lst]


class SkillObj:
    """Base for database objects."""

    obj_type = "obj"

    def skill_get(self, name: str) -> Any:  # pragma: no cover - overridden
        return None

    def skill_set(self, name: str, value: Any) -> None:
        raise SkillError(f"*Error* ~>{name}: attribute is read-only")

    def skill_repr(self) -> str:
        return f"db:0x{id(self) & 0xFFFFFF:x}"


class Shape(SkillObj):
    def __init__(self, cv: "CellView", kind: str, layer: str, purpose: str, points: list[tuple[float, float]], width: float = 0.0,
                 text: str = "", justify: str = "lowerLeft", rotation: str = "R0", font: str = "stick", height: float = 0.1,
                 style: str = "truncateExtend") -> None:
        self.cv, self.kind, self.layer, self.purpose = cv, kind, layer, purpose
        self.points, self.width, self.text = points, width, text
        self.justify, self.rotation, self.font, self.height, self.style = justify, rotation, font, height, style

    def bbox(self) -> list[list[float]]:
        if self.kind == "path":
            poly = path_to_polygon(self.points, self.width)
            return bbox_of_points(poly or self.points)
        return bbox_of_points(self.points)

    def polygons(self) -> list[list[tuple[float, float]]]:
        """Mask geometry of this shape. Manhattan paths become one rectangle per segment (ends extended by w/2 for
        truncateExtend, like the GDS path); diagonal paths fall back to the outline polygon."""
        if self.kind == "path":
            pts = self.points
            if all(abs(a[0] - b[0]) < 1e-9 or abs(a[1] - b[1]) < 1e-9 for a, b in zip(pts, pts[1:])):
                h = self.width / 2.0
                ext = h if self.style in ("truncateExtend", "extend") else 0.0
                out = []
                n = len(pts) - 1
                for k, ((x0, y0), (x1, y1)) in enumerate(zip(pts, pts[1:])):
                    e0 = ext if k == 0 else h
                    e1 = ext if k == n - 1 else h
                    if abs(y0 - y1) < 1e-9:
                        a, b = (x0 - e0, x1 + e1) if x1 >= x0 else (x1 - e1, x0 + e0)
                        out.append([(a, y0 - h), (b, y0 - h), (b, y0 + h), (a, y0 + h)])
                    else:
                        a, b = (y0 - e0, y1 + e1) if y1 >= y0 else (y1 - e1, y0 + e0)
                        out.append([(x0 - h, a), (x0 + h, a), (x0 + h, b), (x0 - h, b)])
                return out
        return [self.polygon()]

    def polygon(self) -> list[tuple[float, float]]:
        if self.kind == "rect":
            (x0, y0), (x1, y1) = self.bbox()
            return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        if self.kind == "path":
            return path_to_polygon(self.points, self.width)
        return list(self.points)

    @property
    def obj_type(self) -> str:  # type: ignore[override]
        return {"rect": "rect", "polygon": "polygon", "path": "path", "label": "label"}[self.kind]

    def skill_get(self, name: str) -> Any:
        if name == "objType":
            return self.obj_type
        if name == "lpp":
            return [self.layer, self.purpose]
        if name == "layerName":
            return self.layer
        if name == "purpose":
            return self.purpose
        if name == "bBox":
            return self.bbox()
        if name == "points":
            return [[p[0], p[1]] for p in self.points]
        if name == "xy":
            return [self.points[0][0], self.points[0][1]] if self.kind == "label" else [[p[0], p[1]] for p in self.points]
        if name == "width":
            return self.width
        if name == "theLabel":
            return self.text if self.kind == "label" else None
        if name == "justify":
            return self.justify
        if name == "orient":
            return self.rotation if self.kind == "label" else None
        if name == "height":
            return self.height
        if name == "net":
            return None
        if name == "cellView":
            return self.cv
        if name == "figType":
            return "shape"
        return None

    def to_json(self) -> dict:
        d: dict[str, Any] = {"t": self.kind, "layer": self.layer, "purpose": self.purpose, "pts": [list(p) for p in self.points]}
        if self.kind == "path":
            d["w"], d["style"] = self.width, self.style
        if self.kind == "label":
            d.update(text=self.text, justify=self.justify, rot=self.rotation, font=self.font, h=self.height)
        return d


class ViaDef(SkillObj):
    obj_type = "techViaDef"

    def __init__(self, name: str, spec: dict) -> None:
        self.name, self.spec = name, spec

    def skill_get(self, name: str) -> Any:
        if name == "name":
            return self.name
        if name == "layer1":
            return self.spec["bot"]
        if name == "layer2":
            return self.spec["top"]
        if name == "objType":
            return "techViaDef"
        return None

    def skill_repr(self) -> str:
        return f"db:0x{id(self) & 0xFFFFFF:x}"


class ViaHeader(SkillObj):
    def __init__(self, via_def: ViaDef) -> None:
        self.via_def = via_def

    def skill_get(self, name: str) -> Any:
        if name == "viaDefName":
            return self.via_def.name
        if name == "viaDef":
            return self.via_def
        return None


class Via(SkillObj):
    obj_type = "stdVia"

    def __init__(self, cv: "CellView", via_def: ViaDef, origin: tuple[float, float], orient: str, rows: int = 1, cols: int = 1,
                 pitch: float | None = None) -> None:
        self.cv, self.via_def, self.origin, self.orient = cv, via_def, origin, orient
        self.rows, self.cols = rows, cols
        cut = via_def.spec["cut_size"]
        self.pitch = pitch if pitch is not None else cut * 2

    def cuts(self) -> list[tuple[float, float]]:
        out = []
        for r in range(self.rows):
            for c in range(self.cols):
                dx = (c - (self.cols - 1) / 2.0) * self.pitch
                dy = (r - (self.rows - 1) / 2.0) * self.pitch
                out.append((self.origin[0] + dx, self.origin[1] + dy))
        return out

    def rects(self) -> list[tuple[str, list[list[float]]]]:
        """(layer, bbox) of the cut layer and both enclosures."""
        s = self.via_def.spec
        h = s["cut_size"] / 2.0
        cuts = self.cuts()
        out = []
        for cx, cy in cuts:
            out.append((s["cut"], [[r3(cx - h), r3(cy - h)], [r3(cx + h), r3(cy + h)]]))
        xs = [c[0] for c in cuts]
        ys = [c[1] for c in cuts]
        for lay, enc in ((s["bot"], s["enc_bot"]), (s["top"], s["enc_top"])):
            e = h + enc
            out.append((lay, [[r3(min(xs) - e), r3(min(ys) - e)], [r3(max(xs) + e), r3(max(ys) + e)]]))
        return out

    def bbox(self) -> list[list[float]]:
        bb = None
        for _l, b in self.rects():
            bb = bbox_union(bb, b)
        return bb  # type: ignore[return-value]

    def skill_get(self, name: str) -> Any:
        if name == "objType":
            return "stdVia"
        if name == "viaHeader":
            return ViaHeader(self.via_def)
        if name in ("origin", "xy"):
            return [self.origin[0], self.origin[1]]
        if name == "orient":
            return self.orient
        if name == "bBox":
            return self.bbox()
        if name == "cellView":
            return self.cv
        if name == "figType":
            return "via"
        if name == "cutColumns":
            return self.cols
        if name == "cutRows":
            return self.rows
        return None

    def to_json(self) -> dict:
        return {"via": self.via_def.name, "xy": list(self.origin), "orient": self.orient, "rows": self.rows, "cols": self.cols, "pitch": self.pitch}


class Instance(SkillObj):
    def __init__(self, cv: "CellView", master: "CellView", name: str, origin: tuple[float, float], orient: str,
                 rows: int = 1, cols: int = 1, row_pitch: float = 0.0, col_pitch: float = 0.0, mosaic: bool = False) -> None:
        self.cv, self.master, self.name, self.origin, self.orient = cv, master, name, origin, orient
        self.rows, self.cols, self.row_pitch, self.col_pitch, self.mosaic = rows, cols, row_pitch, col_pitch, mosaic

    def origins(self) -> list[tuple[float, float]]:
        out = []
        for r in range(self.rows):
            for c in range(self.cols):
                out.append((self.origin[0] + c * self.col_pitch, self.origin[1] + r * self.row_pitch))
        return out

    def bbox(self) -> list[list[float]]:
        mb = self.master.bbox()
        bb = None
        if mb is None:
            return [list(self.origin), list(self.origin)]
        corners = [(mb[0][0], mb[0][1]), (mb[1][0], mb[0][1]), (mb[1][0], mb[1][1]), (mb[0][0], mb[1][1])]
        for o in self.origins():
            bb = bbox_union(bb, bbox_of_points([transform_point(c, o, self.orient) for c in corners]))
        return bb  # type: ignore[return-value]

    def skill_get(self, name: str) -> Any:
        if name == "objType":
            return "mosaic" if self.mosaic else "inst"
        if name == "name":
            return self.name
        if name == "libName":
            return self.master.lib
        if name == "cellName":
            return self.master.cell
        if name == "viewName":
            return self.master.view
        if name in ("xy", "origin"):
            return [self.origin[0], self.origin[1]]
        if name == "orient":
            return self.orient
        if name == "transform":
            return [[self.origin[0], self.origin[1]], self.orient, 1.0]
        if name == "master":
            return self.master
        if name == "bBox":
            return self.bbox()
        if name == "cellView":
            return self.cv
        if name == "figType":
            return "inst"
        if name == "rows":
            return self.rows
        if name == "columns":
            return self.cols
        if name == "rowSpacing":
            return self.row_pitch
        if name == "columnSpacing":
            return self.col_pitch
        return None

    def to_json(self) -> dict:
        return {"lib": self.master.lib, "cell": self.master.cell, "view": self.master.view, "name": self.name, "xy": list(self.origin),
                "orient": self.orient, "rows": self.rows, "cols": self.cols, "rp": self.row_pitch, "cp": self.col_pitch, "mosaic": self.mosaic}


class CellView(SkillObj):
    obj_type = "cellView"

    def __init__(self, db: "Database", lib: str, cell: str, view: str, view_type: str = "maskLayout", mode: str = "a") -> None:
        self.db, self.lib, self.cell, self.view, self.view_type, self.mode = db, lib, cell, view, view_type, mode
        self.shapes: list[Shape] = []
        self.vias: list[Via] = []
        self.instances: list[Instance] = []
        self.dirty = False
        self.readonly = False
        self.std = False  # generated lazily from the standard-cell GDS
        self.std_bbox: list[list[float]] | None = None
        self._inst_counter = 0
        self.opened = True

    # --- geometry
    def bbox(self) -> list[list[float]] | None:
        if self.std:
            return self.std_bbox
        bb = None
        for s in self.shapes:
            if s.kind != "label":
                bb = bbox_union(bb, s.bbox())
        for v in self.vias:
            bb = bbox_union(bb, v.bbox())
        for i in self.instances:
            bb = bbox_union(bb, i.bbox())
        return bb

    def new_inst_name(self) -> str:
        used = {i.name for i in self.instances}
        while True:
            n = f"I{self._inst_counter}"
            self._inst_counter += 1
            if n not in used:
                return n

    # --- attributes
    def skill_get(self, name: str) -> Any:
        if name == "libName":
            return self.lib
        if name == "cellName":
            return self.cell
        if name == "viewName":
            return self.view
        if name == "cellViewType":
            return self.view_type
        if name == "mode":
            return self.mode
        if name in ("shapes",):
            return list(self.shapes) or None
        if name == "vias":
            return list(self.vias) or None
        if name == "instances":
            return list(self.instances) or None
        if name == "bBox":
            return self.bbox()
        if name == "objType":
            return "cellView"
        if name == "modifiedP":
            return True if self.dirty else None
        if name == "lib":
            return DdLib(self.lib)
        if name == "terminals":
            return None
        if name == "nets":
            return None
        if name == "fileName":
            return self.db.cv_path(self.lib, self.cell, self.view)
        return None

    def skill_set(self, name: str, value: Any) -> None:
        raise SkillError(f"*Error* ~>{name}: attribute cannot be set")

    def skill_repr(self) -> str:
        return f"db:0x{id(self) & 0xFFFFFF:x}"

    # --- persistence
    def to_json(self) -> dict:
        return {"lib": self.lib, "cell": self.cell, "view": self.view, "viewType": self.view_type,
                "shapes": [s.to_json() for s in self.shapes], "vias": [v.to_json() for v in self.vias],
                "instances": [i.to_json() for i in self.instances]}


class DdLib(SkillObj):
    def __init__(self, name: str) -> None:
        self.name = name

    def skill_get(self, name: str) -> Any:
        if name in ("name", "libName"):
            return self.name
        return None


class DdObj(SkillObj):
    """ddGetObj result: a library, cell or view handle."""

    def __init__(self, lib: str, cell: str | None = None, view: str | None = None, db: "Database | None" = None) -> None:
        self.lib, self.cell, self.view, self.db = lib, cell, view, db

    def skill_get(self, name: str) -> Any:
        db = self.db
        if name == "name":
            return self.view or self.cell or self.lib
        if name == "libName":
            return self.lib
        if name == "cellName":
            return self.cell
        if name == "objType":
            return "view" if self.view else ("cell" if self.cell else "lib")
        if db is None:
            return None
        if name in ("readPath", "writePath"):
            if self.cell is None:
                return db.lib_path(self.lib)
            return os.path.join(db.lib_path(self.lib), self.cell, self.view or "").replace(os.sep, "/").rstrip("/")
        if name == "writable":
            return None if db.is_std(self.lib) or self.lib == db.TECH_LIB else True
        if name == "cells" and self.cell is None:
            return [DdObj(self.lib, c, None, db) for c in db.cells(self.lib)] or None
        if name == "views" and self.cell is not None and self.view is None:
            return [DdObj(self.lib, self.cell, v, db) for v in db.views(self.lib, self.cell)] or None
        if name == "technology":
            return db.tech.get(self.lib)
        return None


class Window(SkillObj):
    _n = 0

    def __init__(self, cv: CellView) -> None:
        Window._n += 1
        self.num = Window._n
        self.cv = cv

    def skill_get(self, name: str) -> Any:
        if name == "cellView":
            return self.cv
        if name == "windowNum":
            return self.num
        if name in ("name", "title"):
            return f"Virtuoso Layout Editing: {self.cv.lib} {self.cv.cell} {self.cv.view}"
        if name == "objType":
            return "window"
        return None


class LPObj(SkillObj):
    def __init__(self, name: str, purpose: str) -> None:
        self.name, self.purpose = name, purpose

    def skill_get(self, name: str) -> Any:
        if name == "name" or name == "layerName":
            return self.name
        if name == "purpose":
            return self.purpose
        if name == "valid":
            return True
        return None


class TechFile(SkillObj):
    def __init__(self, lib: str) -> None:
        self.lib = lib

    def skill_get(self, name: str) -> Any:
        if name == "libName":
            return self.lib
        if name == "lps":
            return [LPObj(n, p) for n, ps in layers.LPP.items() for p in ps]
        if name == "viaDefs":
            return None
        return None


class Database:
    TECH_LIB = "sky130_tech"

    def __init__(self, workspace: str, stdlib: StdCellLib | None = None, tech_lib: str | None = None) -> None:
        self.workspace = workspace  # default location for user libraries (a library lives in <workspace>/<name>)
        os.makedirs(workspace, exist_ok=True)
        base = stdlib or StdCellLib()
        self.stdlib = base
        self.std_name = base.libname
        self.std: dict[str, StdCellLib] = {base.libname: base} if base.masters else {}
        self.libpaths: dict[str, str] = {}
        self.tech: dict[str, str] = {}
        self.open: dict[tuple[str, str, str], CellView] = {}
        self.windows: list[Window] = []
        self.edit_cv: CellView | None = None
        self.selection: list[SkillObj] = []
        self.viadefs = {k: ViaDef(k, v) for k, v in layers.VIADEFS.items()}
        self.autolib = os.environ.get("VVIRT_AUTOLIB") == "1"
        self._load_registry()

    # --- library registry (the cds.lib of this virtual Virtuoso)
    def _registry_file(self) -> str:
        return os.path.join(self.workspace, "_libs.json")

    def _load_registry(self) -> None:
        try:
            with open(self._registry_file(), encoding="utf-8") as fh:
                d = json.load(fh)
            for n, e in d.get("libs", {}).items():
                if os.path.isdir(e["path"]):
                    self.libpaths[n] = e["path"]
                    self.tech[n] = e.get("tech", self.TECH_LIB)
            for n in d.get("attached", []):
                try:
                    self.attach_pdk_lib(n)
                except SkillError:
                    pass
        except (OSError, ValueError, KeyError):
            pass
        for d in self.lib_dirs():  # directories created before the registry existed
            if d not in self.libpaths and d not in self.std:
                self.libpaths[d] = os.path.join(self.workspace, d)
                self.tech.setdefault(d, self.TECH_LIB)

    def _save_registry(self) -> None:
        d = {"libs": {n: {"path": p, "tech": self.tech.get(n)} for n, p in self.libpaths.items()},
             "attached": [n for n in self.std if n != self.std_name]}
        with open(self._registry_file(), "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=1)

    def is_std(self, lib: str) -> bool:
        return lib in self.std

    def lib_exists(self, lib: str) -> bool:
        return lib in self.std or lib in self.libpaths or lib == self.TECH_LIB

    def lib_path(self, lib: str) -> str:
        if lib in self.std:
            sl = self.std[lib]
            return os.path.dirname(os.path.dirname(sl.gds.path)) if sl.gds else (sl.root or "")
        return self.libpaths.get(lib) or os.path.join(self.workspace, lib)

    def create_lib(self, name: str, path: str | None = None, tech: str | None = TECH_LIB) -> str:
        if not name or not all(c.isalnum() or c in "_-" for c in name):
            raise SkillError(f"*Error* ddCreateLib: bad library name {name!r} (letters, digits, _ and - only)")
        if self.lib_exists(name):
            return self.lib_path(name)
        target = os.path.abspath(path) if path else os.path.join(self.workspace, name)
        root = os.path.realpath(self.workspace)
        if not (os.path.realpath(target) + os.sep).startswith(root + os.sep):
            raise SkillError(f"*Error* ddCreateLib: path {path} is outside the virtual workspace {self.workspace}")
        if os.path.basename(target.rstrip("/")) != name:
            raise SkillError(f"*Error* ddCreateLib: the library directory name must equal the library name; use {os.path.join(os.path.dirname(target), name)}")
        os.makedirs(target, exist_ok=True)
        self.libpaths[name] = target
        self.tech[name] = tech or ""
        self._save_registry()
        return target

    def delete_lib(self, name: str) -> bool:
        if name not in self.libpaths:
            return False
        for k in [k for k in self.open if k[0] == name]:
            self.close(self.open[k])
        import shutil

        shutil.rmtree(self.libpaths[name], ignore_errors=True)
        del self.libpaths[name]
        self.tech.pop(name, None)
        self._save_registry()
        return True

    def attach_pdk_lib(self, name: str) -> StdCellLib:
        """Load another PDK cell library (LEF + GDS) read-only, e.g. sky130_fd_sc_hvl."""
        if name in self.std:
            return self.std[name]
        lib = StdCellLib(self.stdlib.root, name)
        if not lib.masters:
            raise SkillError(f"*Error* vvAttachPdkLib: no LEF macros found for {name} under {self.stdlib.root}/libs.ref")
        self.std[name] = lib
        self._save_registry()
        return lib

    # --- paths
    def cv_path(self, lib: str, cell: str, view: str) -> str:
        return os.path.join(self.lib_path(lib), cell, view + ".json")

    def lib_dirs(self) -> list[str]:
        try:
            return sorted(d for d in os.listdir(self.workspace) if os.path.isdir(os.path.join(self.workspace, d)))
        except OSError:
            return []

    def libraries(self) -> list[str]:
        return list(self.std) + [self.TECH_LIB] + sorted(self.libpaths)

    def cells(self, lib: str) -> list[str]:
        if lib in self.std:
            return sorted(self.std[lib].masters)
        if lib not in self.libpaths:
            return []
        base = self.lib_path(lib)
        try:
            return sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d)))
        except OSError:
            return []

    def views(self, lib: str, cell: str) -> list[str]:
        if lib in self.std:
            return ["layout"] if cell in self.std[lib].masters else []
        if lib not in self.libpaths:
            return []
        base = os.path.join(self.lib_path(lib), cell)
        try:
            return sorted(f[:-5] for f in os.listdir(base) if f.endswith(".json"))
        except OSError:
            return []

    def exists(self, lib: str, cell: str, view: str) -> bool:
        if lib in self.std:
            return cell in self.std[lib].masters and view == "layout"
        return lib in self.libpaths and os.path.isfile(self.cv_path(lib, cell, view))

    # --- open / create
    def open_cv(self, lib: str, cell: str, view: str, view_type: str | None, mode: str) -> CellView | None:
        key = (lib, cell, view)
        vt = view_type or ("maskLayout" if view == "layout" else "schematic" if view == "schematic" else view)
        if lib in self.std:
            if mode not in ("r", "read") and mode is not None and mode != "r":
                if cell not in self.std[lib].masters:
                    raise SkillError(f"*Error* dbOpenCellViewByType: library {lib} is read-only")
            return self._std_master(lib, cell) if cell in self.std[lib].masters else None
        cv = self.open.get(key)
        if cv is not None:
            if cv.readonly and not cv.std and mode in ("a", "w"):
                cv.readonly = False  # re-open for edit, as Virtuoso allows when nobody else holds it
                cv.mode = mode
            if mode == "w":
                # explicit create over an open cellview: reset it
                cv.shapes.clear()
                cv.vias.clear()
                cv.instances.clear()
                cv.dirty = True
            return cv
        if mode == "r" or mode is None:
            if not self.exists(lib, cell, view):
                return None
            cv = self._load(lib, cell, view)
            cv.mode = "r"
            cv.readonly = True
            self.open[key] = cv
            return cv
        if mode == "w" or not self.exists(lib, cell, view):
            if not self.lib_exists(lib):
                if not self.autolib:
                    raise SkillError(f"*Error* dbOpenCellViewByType: library {lib} does not exist. Libraries: " + " ".join(self.libraries())
                                     + '. Create one with ddCreateLib("name" "<path>/name")')
                self.create_lib(lib)
            elif lib == self.TECH_LIB:
                raise SkillError(f"*Error* dbOpenCellViewByType: {lib} is a technology library and cannot hold layouts")
            cv = CellView(self, lib, cell, view, vt, mode)
            cv.dirty = True
        else:
            cv = self._load(lib, cell, view)
            cv.mode = mode
        self.open[key] = cv
        return cv

    def _std_master(self, lib: str, cell: str) -> CellView:
        key = (lib, cell, "layout")
        cv = self.open.get(key)
        if cv is not None:
            return cv
        cv = CellView(self, lib, cell, "layout", "maskLayout", "r")
        cv.std = True
        cv.readonly = True
        m = self.std[lib].masters[cell]
        cv.std_bbox = [[0.0, 0.0], [m.width, m.height]]
        self.open[key] = cv
        return cv

    def _load(self, lib: str, cell: str, view: str) -> CellView:
        with open(self.cv_path(lib, cell, view), encoding="utf-8") as fh:
            d = json.load(fh)
        cv = CellView(self, lib, cell, view, d.get("viewType", "maskLayout"), "a")
        for s in d.get("shapes", []):
            pts = [(p[0], p[1]) for p in s["pts"]]
            cv.shapes.append(Shape(cv, s["t"], s["layer"], s["purpose"], pts, s.get("w", 0.0), s.get("text", ""),
                                   s.get("justify", "lowerLeft"), s.get("rot", "R0"), s.get("font", "stick"), s.get("h", 0.1),
                                   s.get("style", "truncateExtend")))
        for v in d.get("vias", []):
            vd = self.viadefs.get(v["via"])
            if vd:
                cv.vias.append(Via(cv, vd, tuple(v["xy"]), v["orient"], v.get("rows", 1), v.get("cols", 1), v.get("pitch")))
        for i in d.get("instances", []):
            master = self.open_cv(i["lib"], i["cell"], i["view"], None, "r")
            if master is None:
                continue
            cv.instances.append(Instance(cv, master, i["name"], tuple(i["xy"]), i["orient"], i.get("rows", 1), i.get("cols", 1),
                                         i.get("rp", 0.0), i.get("cp", 0.0), i.get("mosaic", False)))
        return cv

    def save(self, cv: CellView) -> bool:
        if cv.std or cv.readonly:
            return False
        path = self.cv_path(cv.lib, cv.cell, cv.view)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cv.to_json(), fh)
        os.replace(tmp, path)
        cv.dirty = False
        return True

    def close(self, cv: CellView) -> None:
        self.open.pop((cv.lib, cv.cell, cv.view), None)
        cv.opened = False
        self.windows = [w for w in self.windows if w.cv is not cv]
        if self.edit_cv is cv:
            self.edit_cv = self.windows[-1].cv if self.windows else None

    def delete_cell(self, lib: str, cell: str) -> bool:
        if lib in self.std or lib not in self.libpaths:
            return False
        base = os.path.join(self.lib_path(lib), cell)
        if not os.path.isdir(base):
            return False
        for k in [k for k in self.open if k[0] == lib and k[1] == cell]:
            self.close(self.open[k])
        import shutil

        shutil.rmtree(base)
        return True

    # --- flattened geometry (for GDS/SVG export)
    def flatten(self, cv: CellView, origin: tuple[float, float] = (0.0, 0.0), orient: str = "R0", depth: int = 0,
                layer_filter: Any = None) -> list[tuple[str, str, list[tuple[float, float]]]]:
        """Return (layer, purpose, polygon) for every shape in the hierarchy, in the parent coordinate system."""
        out: list[tuple[str, str, list[tuple[float, float]]]] = []
        if depth > 16:
            return out
        T = lambda p: transform_point(p, origin, orient)  # noqa: E731
        if cv.std:
            sl = self.std[cv.lib]
            geo = sl.cell_geometry(cv.cell)
            u = sl.gds_dbu_um
            for ly, dt, pts in geo["polys"]:
                lp = layers.from_gds(ly, dt)
                if lp:
                    out.append((lp[0], lp[1], [T((x * u, y * u)) for x, y in pts]))
            for ly, dt, w, pts, _pt in geo["paths"]:
                lp = layers.from_gds(ly, dt)
                if lp:
                    poly = path_to_polygon([(x * u, y * u) for x, y in pts], w * u)
                    out.append((lp[0], lp[1], [T(p) for p in poly]))
            return out
        for s in cv.shapes:
            if s.kind == "label":
                continue
            for poly in s.polygons():
                out.append((layers.canonical(s.layer) or s.layer, s.purpose, [T(p) for p in poly]))
        for v in cv.vias:
            for lay, bb in v.rects():
                (x0, y0), (x1, y1) = bb
                out.append((lay, "drawing", [T(p) for p in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]))
        for inst in cv.instances:
            for o in inst.origins():
                # compose: child orientation applied first, then the parent's
                po = T(o)
                out.extend(self.flatten(inst.master, po, compose_orient(orient, inst.orient), depth + 1))
        return out


def compose_orient(outer: str, inner: str) -> str:
    """Orientation equivalent to applying `inner` then `outer` (both about the origin)."""
    tests = [(1.0, 0.0), (0.0, 1.0)]
    want = [apply_orient(outer, *apply_orient(inner, *t)) for t in tests]
    for o in ORIENTS:
        if all(abs(apply_orient(o, *t)[0] - w[0]) < 1e-9 and abs(apply_orient(o, *t)[1] - w[1]) < 1e-9 for t, w in zip(tests, want)):
            return o
    return "R0"


def transform_bbox(bb: list[list[float]], xform: list) -> list[list[float]]:
    origin, orient = tuple(xform[0]), xform[1]
    corners = [(bb[0][0], bb[0][1]), (bb[1][0], bb[0][1]), (bb[1][0], bb[1][1]), (bb[0][0], bb[1][1])]
    return bbox_of_points([transform_point(c, origin, orient) for c in corners])
