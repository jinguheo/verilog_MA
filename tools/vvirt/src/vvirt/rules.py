"""User-editable design rules, a rule checker (KLayout region ops) and a rule-aware Manhattan router.

Rules are per layer: minWidth, minSpace, minArea (um / um^2) and via enclosures. The defaults below are the usual
sky130A metal/via numbers written from the design manual; they are only defaults — the user overrides them with
vvSetRule(), and the official sky130A_mr.drc deck can be run separately as an independent check (vvOfficialDrc).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from typing import Any

from .gdsio import write_gds

DEFAULTS: dict[str, dict[str, float]] = {
    "li1": {"minWidth": 0.17, "minSpace": 0.17, "minArea": 0.0561},
    "met1": {"minWidth": 0.14, "minSpace": 0.14, "minArea": 0.083},
    "met2": {"minWidth": 0.14, "minSpace": 0.14, "minArea": 0.0676},
    "met3": {"minWidth": 0.30, "minSpace": 0.30, "minArea": 0.24},
    "met4": {"minWidth": 0.30, "minSpace": 0.30, "minArea": 0.24},
    "met5": {"minWidth": 1.60, "minSpace": 1.60, "minArea": 4.0},
    "poly": {"minWidth": 0.15, "minSpace": 0.21},
    "diff": {"minWidth": 0.15, "minSpace": 0.27},
    "mcon": {"minSpace": 0.19},
    "via": {"minSpace": 0.17},
    "via2": {"minSpace": 0.20},
    "via3": {"minSpace": 0.20},
    "via4": {"minSpace": 0.80},
}
# (cut layer, metal layer, min enclosure um)
ENCLOSURES = [("via", "met1", 0.055), ("via", "met2", 0.055), ("via2", "met2", 0.04), ("via2", "met3", 0.065),
              ("via3", "met3", 0.06), ("via3", "met4", 0.065)]
KLAYOUT_SCRIPT = os.path.join(os.path.dirname(__file__), "kl_rules_check.py")


class RuleSet:
    """Rules per layer. Loaded from the PDK technology LEF when available; DEFAULTS only if the PDK is missing."""

    def __init__(self, tlef_path: str | None = None) -> None:
        from . import techlef

        self.rules: dict[str, dict[str, float]] = {k: dict(v) for k, v in DEFAULTS.items()}
        self.enclosures = list(ENCLOSURES)
        self.wide: dict[str, tuple[float, float]] = {}
        self.directions: dict[str, str] = {}
        self.pitches: dict[str, float] = {}
        self.cut_enc: dict[str, tuple[float, float, float, float]] = {}  # cut -> (below max, above max, cutWidth, cutSpace)
        self.source = "built-in defaults (PDK tech LEF not found)"
        p = tlef_path or techlef.find_tlef()
        if p and os.path.isfile(p):
            try:
                self._load_tlef(techlef.parse(p), p)
            except Exception as exc:  # keep working with the defaults, but say so
                self.source = f"built-in defaults (tech LEF {p} unreadable: {exc})"

    def _load_tlef(self, tl, path: str) -> None:
        from . import layers as L

        self.rules, self.enclosures = {}, []
        for n, ly in tl.layers.items():
            if n not in L.LPP:
                continue
            if ly.type == "ROUTING":
                d: dict[str, float] = {}
                if ly.width is not None:
                    d["minWidth"] = ly.width
                if ly.spacing is not None:
                    d["minSpace"] = ly.spacing
                if ly.area is not None:
                    d["minArea"] = ly.area
                self.rules[n] = d
                if ly.wide:
                    self.wide[n] = ly.wide
                if ly.direction:
                    self.directions[n] = ly.direction
                if ly.pitch:
                    self.pitches[n] = ly.pitch
            elif ly.type == "CUT":
                self.rules[n] = {"minSpace": ly.spacing} if ly.spacing is not None else {}
                below = max(ly.enc_below) if ly.enc_below else 0.0
                above = max(ly.enc_above) if ly.enc_above else 0.0
                self.cut_enc[n] = (below, above, ly.width or 0.0, ly.spacing or 0.0)
        for lo, cut, up in tl.cut_between():
            ly = tl.layers[cut]
            for metal, enc in ((lo, ly.enc_below), (up, ly.enc_above)):
                if metal in L.LPP and enc and min(enc) > 0:
                    # the check uses the smaller side; vias are drawn with the larger side, so they satisfy both
                    self.enclosures.append((cut, metal, min(enc)))
        self.source = f"PDK tech LEF: {path}"

    def set(self, layer: str, kind: str, value: float) -> None:
        if kind not in ("minWidth", "minSpace", "minArea"):
            raise ValueError(f"unknown rule kind {kind} (minWidth|minSpace|minArea)")
        self.rules.setdefault(layer, {})[kind] = float(value)

    def get(self, layer: str, kind: str) -> float | None:
        return self.rules.get(layer, {}).get(kind)

    def space_for(self, layer: str, width: float) -> float | None:
        """Spacing rule for a wire of this width (wide wires need more room: the tech LEF SPACINGTABLE)."""
        s = self.get(layer, "minSpace")
        w = self.wide.get(layer)
        if s is not None and w is not None and width > w[0]:
            return max(s, w[1])
        return s

    def pitch(self, layer: str) -> float | None:
        w, s = self.get(layer, "minWidth"), self.get(layer, "minSpace")
        return None if w is None or s is None else round(w + s, 4)

    def as_list(self) -> list:
        return [[l, k, v] for l, d in sorted(self.rules.items()) for k, v in sorted(d.items())]


def find_klayout() -> str | None:
    return shutil.which("klayout")


def check(polys: list[tuple[str, list[tuple[float, float]]]], rs: RuleSet, layers_to_check: set[str] | None = None) -> list[dict]:
    """polys: (layer, polygon um) flat geometry. Returns violations [{layer, rule, required, actual?, bbox}]."""
    kl = find_klayout()
    if kl is None:
        raise RuntimeError("klayout is not installed; rule checking needs `klayout -b`")
    by_layer: dict[str, list] = {}
    for lay, pts in polys:
        if layers_to_check and lay not in layers_to_check:
            continue
        by_layer.setdefault(lay, []).append([[x, y] for x, y in pts])
    job = {"layers": by_layer, "rules": rs.rules, "enclosures": rs.enclosures}
    with tempfile.TemporaryDirectory(prefix="vvrules_") as td:
        jin, jout = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        with open(jin, "w", encoding="utf-8") as fh:
            json.dump(job, fh)
        proc = subprocess.run([kl, "-b", "-r", KLAYOUT_SCRIPT, "-rd", f"jin={jin}", "-rd", f"jout={jout}"],
                              capture_output=True, text=True, timeout=120)
        if not os.path.exists(jout):
            raise RuntimeError("klayout rule check failed: " + (proc.stderr or proc.stdout)[-400:])
        with open(jout, encoding="utf-8") as fh:
            return json.load(fh)


# ---------------------------------------------------------------------------------------------------------------- router
def _rect(x0: float, y0: float, x1: float, y1: float) -> tuple[float, float, float, float]:
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _gap(a: tuple, b: tuple) -> float:
    """Euclidean distance between two axis-aligned rectangles (0 if they touch/overlap)."""
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return (dx * dx + dy * dy) ** 0.5


def wire_rects(pts: list[tuple[float, float]], w: float) -> list[tuple]:
    """Manhattan centre-line -> rectangles (ends extended by w/2, like truncateExtend)."""
    h = w / 2.0
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if abs(y0 - y1) < 1e-9:
            out.append(_rect(min(x0, x1) - h, y0 - h, max(x0, x1) + h, y0 + h))
        else:
            out.append(_rect(x0 - h, min(y0, y1) - h, x0 + h, max(y0, y1) + h))
    return out


def route(p0: tuple[float, float], p1: tuple[float, float], width: float, space: float,
          obstacles: list[tuple], grid: float | None = None, margin_tracks: int = 12,
          prefer: str | None = None, snap: float = 0.0) -> tuple[list[tuple[float, float]], str] | None:
    """Shortest legal Manhattan route between two points on one layer.

    Candidates: straight, the two L shapes, then Z shapes through intermediate vertical/horizontal tracks on a
    (width+space) grid. A candidate is legal when every wire rectangle keeps >= `space` from every obstacle that does
    not contain p0 or p1 (those are the net's own pads). Obstacle rectangles are polygon bounding boxes — conservative
    for non-rectangular shapes.
    """
    pitch = grid or (width + space)
    if snap:
        import math
        pitch = math.ceil(pitch / snap - 1e-9) * snap
    own = [o for o in obstacles if (o[0] <= p0[0] <= o[2] and o[1] <= p0[1] <= o[3]) or (o[0] <= p1[0] <= o[2] and o[1] <= p1[1] <= o[3])]
    others = [o for o in obstacles if o not in own]

    def legal(pts: list[tuple[float, float]]) -> bool:
        for r in wire_rects(pts, width):
            for o in others:
                if _gap(r, o) < space - 1e-9:
                    return False
        return True

    def length(pts: list[tuple[float, float]]) -> float:
        """Wire length; a segment against the layer's preferred direction costs 3x (the 'H on met1, V on met2' habit)."""
        wrong = 3.0 if prefer in ("H", "V") else 1.0
        tot = 0.0
        for a, b in zip(pts, pts[1:]):
            dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
            tot += dx * (wrong if prefer == "V" else 1.0) + dy * (wrong if prefer == "H" else 1.0)
        return round(tot, 6) + 0.05 * max(0, len(pts) - 2)  # small penalty per bend: fewer bends win ties

    cands: list[tuple[str, list[tuple[float, float]]]] = []
    (x0, y0), (x1, y1) = p0, p1
    if abs(x0 - x1) < 1e-9 or abs(y0 - y1) < 1e-9:
        cands.append(("straight", [p0, p1]))
    cands.append(("L horizontal-first", [p0, (x1, y0), p1]))
    cands.append(("L vertical-first", [p0, (x0, y1), p1]))
    def sn(v: float) -> float:
        return round(round(v / snap) * snap, 4) if snap else v

    lo_x, hi_x = sn(min(x0, x1) - margin_tracks * pitch), max(x0, x1) + margin_tracks * pitch
    lo_y, hi_y = sn(min(y0, y1) - margin_tracks * pitch), max(y0, y1) + margin_tracks * pitch
    nx = int((hi_x - lo_x) / pitch) + 1
    ny = int((hi_y - lo_y) / pitch) + 1
    for i in range(nx):
        xm = round(lo_x + i * pitch, 4)
        cands.append((f"Z via x={xm:g}", [p0, (xm, y0), (xm, y1), p1]))
    for j in range(ny):
        ym = round(lo_y + j * pitch, 4)
        cands.append((f"Z via y={ym:g}", [p0, (x0, ym), (x1, ym), p1]))
    # U/dog-leg shapes: go to a track, cross, return (3 bends) when both Z families are blocked
    for i in range(nx):
        for j in range(ny):
            xm, ym = round(lo_x + i * pitch, 4), round(lo_y + j * pitch, 4)
            cands.append((f"S x={xm:g},y={ym:g}", [p0, (xm, y0), (xm, ym), (x1, ym), p1]))
    best: tuple[float, str, list] | None = None
    for name, pts in cands:
        clean = [pts[0]] + [p for a, p in zip(pts, pts[1:]) if abs(a[0] - p[0]) > 1e-9 or abs(a[1] - p[1]) > 1e-9]
        if len(clean) < 2:
            continue
        L = length(clean)
        if best is not None and L >= best[0]:
            continue
        if legal(clean):
            best = (L, name, clean)
    return (best[2], best[1]) if best else None


# ---------------------------------------------------------------------------------------------------------------- official deck
def find_deck(pdk_root: str | None) -> str | None:
    cands = [os.path.join(pdk_root, "libs.tech", "klayout", "drc", "sky130A_mr.drc")] if pdk_root else []
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


def official_drc(gds_path: str, top: str, deck: str, beol: bool = True, feol: bool = False, timeout: int = 600) -> dict[str, int]:
    """Run the official sky130A KLayout DRC deck; returns {rule name: violation count}."""
    import re

    kl = find_klayout()
    if kl is None:
        raise RuntimeError("klayout is not installed")
    with tempfile.TemporaryDirectory(prefix="vvdrc_") as td:
        rep = os.path.join(td, "drc.lyrdb")
        cmd = [kl, "-b", "-r", deck, "-rd", f"input={gds_path}", "-rd", f"top_cell={top}", "-rd", f"report={rep}",
               "-rd", f"beol={'true' if beol else 'false'}", "-rd", f"feol={'true' if feol else 'false'}", "-rd", "thr=2"]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if not os.path.exists(rep):
            raise RuntimeError("official DRC did not produce a report: " + (proc.stderr or proc.stdout)[-400:])
        xml = open(rep, encoding="utf-8").read()
    counts: dict[str, int] = {}
    items = xml.split("<items>", 1)[1] if "<items>" in xml else ""
    for m in re.finditer(r"<category>'?([^<']*)'?</category>", items):
        counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return counts
