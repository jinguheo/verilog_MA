"""Routing pre-check against the PDK tech-LEF rules, run outside Virtuoso on the routed DEF.

Checks (all rule values come from the tech LEF through techlef.py / def_export.read_tlef_vias, nothing is typed in here):
  * short   - metal of two different nets overlaps on one layer
  * spacing - metal of two different nets closer than the layer SPACING (SPACINGTABLE entry for wide metal, chosen by the wider shape)
Only what the DEF contains is seen: wires and vias of signal nets. Cell pins / obstructions (LEF PIN / OBS geometry) and power stripes
are not included, so wire-to-pin shorts and area / enclosure / antenna rules still need the real DRC (Magic / KLayout).
"""
from __future__ import annotations

import math
from collections import defaultdict

from .pnr_est import Design

Rect = tuple[float, float, float, float]


def _shapes(d: Design, tlef_layers: dict, tlef_vias: dict, def_via_shapes) -> dict[str, list[tuple[Rect, str]]]:
    by_layer: dict[str, list[tuple[Rect, str]]] = defaultdict(list)
    for net in d.nets.values():
        if net.special:
            continue
        for layer, x0, y0, x1, y1 in net.segs:
            t = tlef_layers.get(layer)
            hw = (t.width or 0) / 2 if t is not None else 0
            if hw:
                by_layer[layer].append(((min(x0, x1) - hw, min(y0, y1) - hw, max(x0, x1) + hw, max(y0, y1) + hw), net.name))
        for name, x, y in net.via_at:
            for layer, a, b, e, f in tlef_vias.get(name) or (def_via_shapes(d.vias[name]) if name in d.vias else []):
                by_layer[layer].append(((x + a, y + b, x + e, y + f), net.name))
        for layer, x0, y0, x1, y1 in net.rects:
            by_layer[layer].append(((x0, y0, x1, y1), net.name))
    return by_layer


def _gap(a: Rect, b: Rect) -> tuple[float, bool]:
    dx = max(b[0] - a[2], a[0] - b[2])
    dy = max(b[1] - a[3], a[1] - b[3])
    if dx < 0 and dy < 0:
        return 0.0, True
    return math.hypot(max(dx, 0.0), max(dy, 0.0)), False


def check(d: Design, tlef_layers: dict, tlef_vias: dict, def_via_shapes, limit: int = 200) -> dict:
    by_layer = _shapes(d, tlef_layers, tlef_vias, def_via_shapes)
    findings: list[dict] = []
    counts = {"short": 0, "spacing": 0}
    layers_checked = {}
    for layer, items in by_layer.items():
        t = tlef_layers.get(layer)
        if t is None or t.type != "ROUTING" or not t.spacing:
            continue  # cut layers: spacing is a cut-array rule, not checked here
        layers_checked[layer] = len(items)
        reach = max(t.spacing, t.wide[1] if t.wide else 0)
        cell = max(reach * 4, 2.0)
        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (r, _n) in enumerate(items):
            for gx in range(int((r[0] - reach) // cell), int((r[2] + reach) // cell) + 1):
                for gy in range(int((r[1] - reach) // cell), int((r[3] + reach) // cell) + 1):
                    grid[(gx, gy)].append(i)
        seen: set[tuple[int, int]] = set()
        for ids in grid.values():
            for ai in range(len(ids)):
                i = ids[ai]
                ri, ni = items[i]
                for bj in range(ai + 1, len(ids)):
                    j = ids[bj]
                    rj, nj = items[j]
                    if ni == nj or (min(i, j), max(i, j)) in seen:
                        continue
                    seen.add((min(i, j), max(i, j)))
                    g, overlap = _gap(ri, rj)
                    need = t.spacing
                    if t.wide and max(min(ri[2] - ri[0], ri[3] - ri[1]), min(rj[2] - rj[0], rj[3] - rj[1])) >= t.wide[0]:
                        need = t.wide[1]
                    if overlap:
                        counts["short"] += 1
                        kind = "short"
                    elif g < need - 1e-4:
                        counts["spacing"] += 1
                        kind = "spacing"
                    else:
                        continue
                    if len(findings) < limit:
                        bb = [min(ri[0], rj[0]), min(ri[1], rj[1]), max(ri[2], rj[2]), max(ri[3], rj[3])]
                        findings.append({"kind": "route_" + kind, "severity": "error", "layer": layer, "bbox": bb,
                                         "msg": f"{layer}: {ni} and {nj} " + ("overlap" if overlap else f"are {g:.3f} um apart (rule {need:.3f} um)")})
    return {"counts": counts, "layers_checked": layers_checked, "findings": findings}
