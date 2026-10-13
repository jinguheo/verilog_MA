"""Pure-Python GDSII reader/writer (no third-party dependency).

Reader: scans a stream once to index structures by name and parses single structures on demand.
Writer: writes self-contained streams (the caller passes every structure it references).
Coordinates are integers in database units; helpers convert to micrometres.
"""
from __future__ import annotations

import math
import struct
import time
from typing import Any

HEADER, BGNLIB, LIBNAME, UNITS, ENDLIB, BGNSTR, STRNAME, ENDSTR = 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07
BOUNDARY, PATH, SREF, AREF, TEXT = 0x08, 0x09, 0x0A, 0x0B, 0x0C
LAYER, DATATYPE, WIDTH, XY, ENDEL, SNAME, COLROW = 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13
TEXTTYPE, PRESENTATION, STRING, STRANS, MAG, ANGLE, PATHTYPE, BOX, BOXTYPE = 0x16, 0x17, 0x19, 0x1A, 0x1B, 0x1C, 0x21, 0x2D, 0x2E

DT_NONE, DT_BITARRAY, DT_INT2, DT_INT4, DT_REAL4, DT_REAL8, DT_ASCII = 0, 1, 2, 3, 4, 5, 6


def real8_to_float(b: bytes) -> float:
    sign = -1.0 if b[0] & 0x80 else 1.0
    exp = (b[0] & 0x7F) - 64
    mant = int.from_bytes(b[1:8], "big") / float(1 << 56)
    return sign * mant * (16.0 ** exp)


def float_to_real8(x: float) -> bytes:
    if x == 0:
        return b"\x00" * 8
    sign = 0x80 if x < 0 else 0
    x = abs(x)
    exp = 0
    while x >= 1.0:
        x /= 16.0
        exp += 1
    while x < 1.0 / 16.0:
        x *= 16.0
        exp -= 1
    mant = int(round(x * (1 << 56)))
    if mant >= (1 << 56):
        mant >>= 4
        exp += 1
    return bytes([sign | (exp + 64)]) + mant.to_bytes(7, "big")


class GdsFile:
    """A GDSII stream held in memory with a structure index."""

    def __init__(self, path: str) -> None:
        self.path = path
        with open(path, "rb") as fh:
            self.data = fh.read()
        self.dbu_m = 1e-9  # metres per database unit
        self.user_per_dbu = 1e-3
        self.index: dict[str, tuple[int, int]] = {}
        self._scan()

    @property
    def dbu_um(self) -> float:
        return self.dbu_m * 1e6

    def _scan(self) -> None:
        d, pos, n = self.data, 0, len(self.data)
        start = 0
        while pos + 4 <= n:
            ln, rt = struct.unpack_from(">HB", d, pos)
            if ln < 4:
                break
            if rt == UNITS:
                self.user_per_dbu = real8_to_float(d[pos + 4:pos + 12])
                self.dbu_m = real8_to_float(d[pos + 12:pos + 20])
            elif rt == BGNSTR:
                start = pos
            elif rt == STRNAME:
                name = d[pos + 4:pos + ln].rstrip(b"\x00").decode("ascii", "replace")
                self._pending = name
            elif rt == ENDSTR:
                self.index[self._pending] = (start, pos + ln)
            elif rt == ENDLIB:
                break
            pos += ln

    def cells(self) -> list[str]:
        return list(self.index)

    def read_cell(self, name: str) -> dict[str, list]:
        """Parse one structure into polys/paths/texts/srefs (integer database units)."""
        if name not in self.index:
            raise KeyError(name)
        start, end = self.index[name]
        d, pos = self.data, start
        out: dict[str, list] = {"polys": [], "paths": [], "texts": [], "srefs": [], "arefs": []}
        el: dict[str, Any] | None = None
        while pos < end:
            ln, rt, dt = struct.unpack_from(">HBB", d, pos)
            body = d[pos + 4:pos + ln]
            if rt in (BOUNDARY, PATH, SREF, AREF, TEXT, BOX):
                el = {"type": rt, "layer": 0, "dt": 0, "width": 0, "xy": [], "sname": None, "angle": 0.0, "mag": 1.0, "reflect": False, "string": "", "colrow": None, "pathtype": 0}
            elif el is not None:
                if rt == LAYER:
                    el["layer"] = struct.unpack(">h", body)[0]
                elif rt in (DATATYPE, TEXTTYPE, BOXTYPE):
                    el["dt"] = struct.unpack(">h", body)[0]
                elif rt == WIDTH:
                    el["width"] = struct.unpack(">i", body)[0]
                elif rt == PATHTYPE:
                    el["pathtype"] = struct.unpack(">h", body)[0]
                elif rt == XY:
                    cnt = len(body) // 4
                    vals = struct.unpack(">%di" % cnt, body)
                    el["xy"] = [(vals[i], vals[i + 1]) for i in range(0, cnt, 2)]
                elif rt == SNAME:
                    el["sname"] = body.rstrip(b"\x00").decode("ascii", "replace")
                elif rt == STRING:
                    el["string"] = body.rstrip(b"\x00").decode("ascii", "replace")
                elif rt == STRANS:
                    el["reflect"] = bool(struct.unpack(">H", body)[0] & 0x8000)
                elif rt == MAG:
                    el["mag"] = real8_to_float(body)
                elif rt == ANGLE:
                    el["angle"] = real8_to_float(body)
                elif rt == COLROW:
                    el["colrow"] = struct.unpack(">hh", body)
                elif rt == ENDEL:
                    t = el["type"]
                    if t in (BOUNDARY, BOX):
                        pts = el["xy"][:-1] if len(el["xy"]) > 1 and el["xy"][0] == el["xy"][-1] else el["xy"]
                        out["polys"].append((el["layer"], el["dt"], pts))
                    elif t == PATH:
                        out["paths"].append((el["layer"], el["dt"], el["width"], el["xy"], el["pathtype"]))
                    elif t == TEXT:
                        out["texts"].append((el["layer"], el["dt"], el["xy"][0] if el["xy"] else (0, 0), el["string"]))
                    elif t == SREF:
                        out["srefs"].append((el["sname"], el["xy"][0], el["reflect"], el["angle"], el["mag"]))
                    elif t == AREF:
                        out["arefs"].append((el["sname"], el["xy"], el["reflect"], el["angle"], el["mag"], el["colrow"]))
                    el = None
            pos += ln
        return out


# ----------------------------------------------------------------------------- writer


def _rec(rtype: int, dtype: int, payload: bytes = b"") -> bytes:
    if len(payload) % 2:
        payload += b"\x00"
    return struct.pack(">HBB", 4 + len(payload), rtype, dtype) + payload


def _i2(*v: int) -> bytes:
    return struct.pack(">%dh" % len(v), *v)


def _i4(*v: int) -> bytes:
    return struct.pack(">%di" % len(v), *v)


def _ascii(s: str) -> bytes:
    b = s.encode("ascii", "replace")
    return b + (b"\x00" if len(b) % 2 else b"")


def _date() -> bytes:
    t = time.localtime()
    return _i2(t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec) * 2


def write_gds(path: str, libname: str, structures: dict[str, dict[str, list]], dbu_m: float = 1e-9, user_per_dbu: float = 1e-3) -> None:
    """Write a stream. structures: name -> {"polys","paths","texts","srefs"} in integer database units."""
    out = bytearray()
    out += _rec(HEADER, DT_INT2, _i2(600))
    out += _rec(BGNLIB, DT_INT2, _date())
    out += _rec(LIBNAME, DT_ASCII, _ascii(libname))
    out += _rec(UNITS, DT_REAL8, float_to_real8(user_per_dbu) + float_to_real8(dbu_m))
    for name, st in structures.items():
        out += _rec(BGNSTR, DT_INT2, _date())
        out += _rec(STRNAME, DT_ASCII, _ascii(name))
        for layer, dt, pts in st.get("polys", []):
            ring = list(pts) + [pts[0]]
            out += _rec(BOUNDARY, DT_NONE) + _rec(LAYER, DT_INT2, _i2(layer)) + _rec(DATATYPE, DT_INT2, _i2(dt))
            out += _rec(XY, DT_INT4, _i4(*[c for p in ring for c in p])) + _rec(ENDEL, DT_NONE)
        for layer, dt, width, pts, ptype in st.get("paths", []):
            out += _rec(PATH, DT_NONE) + _rec(LAYER, DT_INT2, _i2(layer)) + _rec(DATATYPE, DT_INT2, _i2(dt))
            out += _rec(PATHTYPE, DT_INT2, _i2(ptype)) + _rec(WIDTH, DT_INT4, _i4(width))
            out += _rec(XY, DT_INT4, _i4(*[c for p in pts for c in p])) + _rec(ENDEL, DT_NONE)
        for layer, tt, xy, text in st.get("texts", []):
            out += _rec(TEXT, DT_NONE) + _rec(LAYER, DT_INT2, _i2(layer)) + _rec(TEXTTYPE, DT_INT2, _i2(tt))
            out += _rec(XY, DT_INT4, _i4(*xy)) + _rec(STRING, DT_ASCII, _ascii(text)) + _rec(ENDEL, DT_NONE)
        for sname, xy, reflect, angle, mag in st.get("srefs", []):
            out += _rec(SREF, DT_NONE) + _rec(SNAME, DT_ASCII, _ascii(sname))
            if reflect or angle or mag != 1.0:
                out += _rec(STRANS, DT_BITARRAY, struct.pack(">H", 0x8000 if reflect else 0))
                if mag != 1.0:
                    out += _rec(MAG, DT_REAL8, float_to_real8(mag))
                if angle:
                    out += _rec(ANGLE, DT_REAL8, float_to_real8(angle))
            out += _rec(XY, DT_INT4, _i4(*xy)) + _rec(ENDEL, DT_NONE)
        out += _rec(ENDSTR, DT_NONE)
    out += _rec(ENDLIB, DT_NONE)
    with open(path, "wb") as fh:
        fh.write(bytes(out))


def bbox_of(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def path_to_polygon(pts: list[tuple[float, float]], width: float) -> list[tuple[float, float]]:
    """Outline of a Manhattan or general centre-line path (flush ends)."""
    if len(pts) < 2:
        return []
    h = width / 2.0
    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    for i, (x, y) in enumerate(pts):
        if i == 0:
            dx, dy = pts[1][0] - x, pts[1][1] - y
        elif i == len(pts) - 1:
            dx, dy = x - pts[i - 1][0], y - pts[i - 1][1]
        else:
            dx, dy = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln * h, dx / ln * h
        left.append((x + nx, y + ny))
        right.append((x - nx, y - ny))
    return left + list(reversed(right))
