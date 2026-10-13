"""Emulation of Virtuoso XStream Out: xstGetField / xstSetField / xstOutDoTranslate.

The real command is asynchronous and writes a log the client polls; here the translation runs synchronously inside
xstOutDoTranslate() and produces the same artifacts: the GDS file, and a log in XStream Out's format
(Product / Started at / 'Translating cellview L/C/V as STRUCTURE S.' / 'Translation completed. N error(s) and M warning(s)').
The stream map file (layerName purpose streamLayer dataType) is read and honoured; layer/purpose pairs without a
mapping are skipped with a warning, as XStream does.
"""
from __future__ import annotations

import os
import time

from . import export
from .odb import Database
from .skill_lang import Interp, SkillError

FIELDS = ("library", "topCell", "view", "strmFile", "layerMap", "logFile", "runDir", "showCompletionMsgBox")


def parse_stream_map(path: str) -> dict[tuple[str, str], tuple[int, int]]:
    out: dict[tuple[str, str], tuple[int, int]] = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.split("#", 1)[0].strip()
            f = line.split()
            if len(f) >= 4 and f[2].isdigit() and f[3].isdigit():
                out[(f[0], f[1])] = (int(f[2]), int(f[3]))
    return out


def install(interp: Interp, db: Database, out_dir: str) -> None:
    F = interp.funcs
    fields: dict[str, str | None] = {k: None for k in FIELDS}
    fields["view"] = "layout"

    def get(name):
        return fields.get(str(name))

    def set_(name, value):
        if str(name) not in fields:
            raise SkillError(f"*Error* xstSetField: unknown field {name}")
        fields[str(name)] = None if value is None else str(value)
        return True

    def allowed(path: str) -> bool:
        p = os.path.realpath(path)
        roots = [os.path.realpath(r) for r in ("/tmp", db.workspace, out_dir, "/mnt/d/MyWork") if r]
        return any(p == r or p.startswith(r + os.sep) for r in roots)

    def translate(*_a, **_k):
        need = ("library", "topCell", "view", "strmFile", "layerMap", "logFile")
        if any(not fields[k] for k in need):
            raise SkillError("*Error* xstOutDoTranslate: library, topCell, view, strmFile, layerMap and logFile must be set")
        lib, cell, view = fields["library"], fields["topCell"], fields["view"]
        gds, logf, lmap = fields["strmFile"], fields["logFile"], fields["layerMap"]
        for p in (gds, logf):
            if not allowed(os.path.dirname(os.path.abspath(p))):
                raise SkillError(f"*Error* xstOutDoTranslate: output path {p} is outside the allowed directories")
        t0 = time.strftime("%a %b %d %H:%M:%S %Y")
        head = ["Product  : Virtuoso(R) XStream Out", "Program  : vvirt XStream Out emulation", f"Started at: {t0}", ""]
        lines = list(head)
        errors = warnings = 0

        def finish(status_lines: list[str]) -> None:
            os.makedirs(os.path.dirname(os.path.abspath(logf)), exist_ok=True)
            with open(logf, "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines + status_lines) + "\n")

        try:
            mapping = parse_stream_map(lmap)
        except OSError as exc:
            finish([f"ERROR (XSTRM-1): cannot read stream map {lmap}: {exc.strerror}", "ERROR (XSTRM-273): Translation failed."])
            return None
        if not mapping:
            finish(["ERROR (XSTRM-2): stream map has no usable lines (layerName purpose streamLayer dataType).", "ERROR (XSTRM-273): Translation failed."])
            return None
        cv = db.open_cv(lib, cell, view, None, "r")
        if cv is None:
            finish([f"ERROR (XSTRM-8): cannot open cellview {lib}/{cell}/{view}.", "ERROR (XSTRM-273): Translation failed."])
            return None
        lines.append(f"INFO (XSTRM-223): Stream map: {lmap} ({len(mapping)} entries)")
        info = export.export_gds(db, cv, gds, mapper=lambda l, p: mapping.get((export.canon_name(l), p)) or mapping.get((l, p)))
        for l, c, v, s in info["translated"]:
            lines.append(f"INFO (XSTRM-223): Translating cellview {l}/{c}/{v} as STRUCTURE {s}.")
        for l, p in info["unmapped"]:
            lines.append(f"WARNING (XSTRM-33): No stream mapping for layer-purpose pair {l} {p}; shapes on it are not translated.")
            warnings += 1
        finish([f"INFO (XSTRM-234): Translation completed. '{errors}' error(s) and '{warnings}' warning(s) found."])
        return None

    F["xstGetField"] = get
    F["xstSetField"] = set_
    F["xstOutDoTranslate"] = translate
