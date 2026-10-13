"""Self-explaining SVG rendering of a cellview.

With annotate=True the picture explains itself: a layer legend (colour -> meaning), the cell title and size, instance
outlines with name and cell kind, pin names (input/output), VPWR/VGND rails, well regions and layer tags on drawn shapes.
"""
from __future__ import annotations

import html
import os

from . import layers
from .gdsio import path_to_polygon  # noqa: F401  (kept for callers importing from here)
from .odb import CellView, Database, bbox_of_points, bbox_union, transform_point

LAYER_INFO: dict[str, tuple[str, str]] = {
    "nwell": ("N-well", "PMOS가 들어가는 N형 웰 영역"),
    "pwell": ("P-well", "NMOS 쪽 P형 웰/기판"),
    "dnwell": ("Deep N-well", "깊은 N웰(격리용)"),
    "diff": ("diff", "활성영역: 소스/드레인이 되는 곳"),
    "tap": ("tap", "웰·기판 전위를 잡는 접점 영역"),
    "psdm": ("P+ implant", "P형 도핑(PMOS S/D, 기판 탭)"),
    "nsdm": ("N+ implant", "N형 도핑(NMOS S/D, 웰 탭)"),
    "poly": ("poly", "폴리실리콘: 트랜지스터 게이트(붉은 세로선)"),
    "licon1": ("licon (접점)", "diff/poly → li1 접점(검은 점)"),
    "li1": ("li1", "셀 안쪽 배선, 셀 입출력 핀 모양"),
    "mcon": ("mcon (비아)", "li1 → met1 연결 비아"),
    "met1": ("met1", "금속1: 전원 레일(VPWR/VGND)·배선"),
    "via": ("via (met1-met2)", "met1 ↔ met2 연결 비아"),
    "met2": ("met2", "금속2 배선"),
    "via2": ("via2 (met2-met3)", "met2 ↔ met3 연결 비아"),
    "met3": ("met3", "금속3 배선"),
    "via3": ("via3 (met3-met4)", "met3 ↔ met4 연결 비아"),
    "met4": ("met4", "금속4 배선"),
    "via4": ("via4 (met4-met5)", "met4 ↔ met5 연결 비아"),
    "met5": ("met5", "금속5 배선(최상위, 가장 굵음)"),
    "npc": ("npc", "공정용 마스크(nitride poly cut)"),
    "lvtn": ("lvt implant", "저문턱전압 implant"),
    "hvtp": ("hvt implant", "고문턱전압 implant"),
    "hvi": ("hvi", "고전압 영역"),
    "pad": ("pad", "본딩 패드"),
    "areaid": ("표준셀 영역", "표준셀 영역 표시(areaid)"),
    "prBoundary": ("셀 경계", "배치·배선용 셀 경계(점선 박스)"),
}
CUTS = ("licon1", "mcon", "via", "via2", "via3", "via4")
SKIP_PIN_LABELS = {"VPWR", "VGND", "VPB", "VNB"}
FONT = "Segoe UI, Malgun Gothic, Apple SD Gothic Neo, sans-serif"


def _tx(text: str, x: float, y: float, size: float = 11, fill: str = "#111", anchor: str = "start", weight: str = "normal") -> str:
    """Text with a white halo so it stays readable on top of the layout."""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size:g}" font-weight="{weight}" fill="{fill}" '
            f'text-anchor="{anchor}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">{html.escape(text)}</text>')


def render_svg(db: Database, cv: CellView, path: str | None = None, width_px: int = 1200, show_layers: set[str] | None = None,
               margin: float = 0.4, annotate: bool = True) -> str:
    polys = db.flatten(cv)
    if show_layers:
        polys = [p for p in polys if p[0] in show_layers]
    bb = None
    for _l, _p, pts in polys:
        bb = bbox_union(bb, bbox_of_points(pts))
    for s in cv.shapes:
        if s.kind == "label":
            bb = bbox_union(bb, [[s.points[0][0], s.points[0][1]], [s.points[0][0], s.points[0][1]]])
    if bb is None:
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="35" font-size="14">empty cellview</text></svg>'
        if path:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(svg)
        return svg
    x0, y0 = bb[0][0] - margin, bb[0][1] - margin
    x1, y1 = bb[1][0] + margin, bb[1][1] + margin
    w, h = x1 - x0, y1 - y0
    sc = width_px / w
    top_pad = 34 if annotate else 0
    height_px = max(60, int(h * sc)) + top_pad

    def X(x: float) -> float:
        return (x - x0) * sc

    def Y(y: float) -> float:
        return (y1 - y) * sc + top_pad

    rank = {n: i for i, n in enumerate(layers.DRAW_ORDER)}
    present: list[str] = []
    for lay, purpose, _ in polys:
        if lay not in present and purpose not in ("label", "net", "blockage") and not (lay == "areaid" and purpose != "standardc"):
            present.append(lay)
    present.sort(key=lambda n: rank.get(n, 99))

    legend_w = 280 if annotate else 0
    legend_h = 54 + 28 * len(present) + 120
    total_w = width_px + legend_w
    total_h = max(height_px, legend_h if annotate else 0)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{total_h}" viewBox="0 0 {total_w} {total_h}">',
           '<rect width="100%" height="100%" fill="#fbfbfb"/>',
           f'<title>{html.escape(cv.lib)}/{html.escape(cv.cell)}/{html.escape(cv.view)}</title>']
    if annotate:
        out.append(f'<text x="8" y="22" font-family="{FONT}" font-size="15" font-weight="bold" fill="#111">'
                   f'{html.escape(cv.lib)} / {html.escape(cv.cell)} — 크기 {bb[1][0] - bb[0][0]:.2f} × {bb[1][1] - bb[0][1]:.2f} µm (위에서 본 모습)</text>')
    for lay, purpose, pts in sorted(polys, key=lambda t: rank.get(t[0], 99)):
        if purpose in ("label", "net", "blockage") or (lay == "areaid" and purpose != "standardc"):
            continue
        col = layers.COLORS.get(lay, "#888888")
        op = 0.95 if lay in CUTS else (0.35 if lay in ("nwell", "pwell", "nsdm", "psdm", "npc", "areaid", "hvi") else 0.55)
        ptxt = " ".join(f"{X(x):.1f},{Y(y):.1f}" for x, y in pts)
        if lay == "prBoundary":
            out.append(f'<polygon fill="none" stroke="#000" stroke-width="1" stroke-dasharray="6 3" points="{ptxt}"/>')
        else:
            out.append(f'<polygon fill="{col}" fill-opacity="{op:.2f}" stroke="{col}" stroke-width="0.6" points="{ptxt}"/>')
    if annotate:
        _annotate(db, cv, polys, out, X, Y, sc)
        _legend(out, present, width_px + 14, 8, legend_w - 22)
    else:
        _plain_labels(cv, out, X, Y, sc)
    out.append("</svg>")
    svg = "\n".join(out)
    if path:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(svg)
    return svg


def _legend(out: list, present: list[str], x: float, y: float, w: float) -> None:
    out.append(f'<rect x="{x - 8:.0f}" y="{y:.0f}" width="{w + 16:.0f}" height="{54 + 28 * len(present) + 112}" rx="6" fill="#fff" stroke="#c8c8c8"/>')
    out.append(f'<text x="{x:.0f}" y="{y + 22:.0f}" font-family="{FONT}" font-size="14" font-weight="bold" fill="#111">범례 — 색이 뜻하는 것</text>')
    yy = y + 40
    for lay in present:
        col = layers.COLORS.get(lay, "#888")
        name, desc = LAYER_INFO.get(lay, (lay, ""))
        if lay == "prBoundary":
            out.append(f'<rect x="{x:.0f}" y="{yy:.0f}" width="22" height="14" fill="none" stroke="#000" stroke-dasharray="4 2"/>')
        else:
            out.append(f'<rect x="{x:.0f}" y="{yy:.0f}" width="22" height="14" fill="{col}" fill-opacity="{0.95 if lay in CUTS else 0.6}" stroke="{col}"/>')
        out.append(f'<text x="{x + 30:.0f}" y="{yy + 11:.0f}" font-family="{FONT}" font-size="12" font-weight="bold" fill="#111">{html.escape(name)}</text>')
        out.append(f'<text x="{x + 30:.0f}" y="{yy + 24:.0f}" font-family="{FONT}" font-size="9.5" fill="#555">{html.escape(desc)}</text>')
        yy += 28
    yy += 6
    notes = ["그림 안의 표시", "점선 상자 = 배치된 셀(이름 + 셀 종류)", "빨간 원 + 이름 = 핀(입력/출력)",
             "VPWR(위)·VGND(아래) = 전원 레일", "'met2 배선' 같은 글자 = 직접 그린 도형의 층"]
    for k, t in enumerate(notes):
        out.append(f'<text x="{x:.0f}" y="{yy + 14 + k * 17:.0f}" font-family="{FONT}" font-size="{12 if k == 0 else 10.5}" '
                   f'font-weight="{"bold" if k == 0 else "normal"}" fill="#111">{html.escape(t)}</text>')


def _annotate(db: Database, cv: CellView, polys: list, out: list, X, Y, sc: float) -> None:
    def short(c: str) -> str:
        return c.replace("sky130_fd_sc_hd__", "").replace("sky130_fd_sc_hvl__", "")

    for lay, purpose, pts in polys:  # well regions
        if lay in ("nwell", "pwell") and purpose == "drawing":
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            if (max(xs) - min(xs)) * sc > 70 and (max(ys) - min(ys)) * sc > 40:
                out.append(_tx("N-well (PMOS 영역)" if lay == "nwell" else "P-well", X((min(xs) + max(xs)) / 2),
                               Y((min(ys) + max(ys)) / 2) + 4, 10.5, "#2f6b2f" if lay == "nwell" else "#7a5a2a", "middle"))
    for inst in cv.instances:  # placed cells
        master = inst.master
        mb = master.bbox()
        if mb is None:
            continue
        corners = [(mb[0][0], mb[0][1]), (mb[1][0], mb[0][1]), (mb[1][0], mb[1][1]), (mb[0][0], mb[1][1])]
        sl = db.std.get(master.lib)
        mc = sl.masters.get(master.cell) if sl else None
        for k, o in enumerate(inst.origins()):
            pts = [transform_point(c, o, inst.orient) for c in corners]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)
            wpx = (bx1 - bx0) * sc
            out.append(f'<rect x="{X(bx0):.1f}" y="{Y(by1):.1f}" width="{wpx:.1f}" height="{(by1 - by0) * sc:.1f}" fill="none" '
                       'stroke="#222" stroke-width="1.4" stroke-dasharray="7 4"/>')
            nm = inst.name if (not inst.mosaic or inst.rows * inst.cols == 1) else f"{inst.name}[{k}]"
            if wpx >= 34:
                kind = short(master.cell) + (f" ({inst.orient} 반전)" if inst.orient != "R0" else "")
                bw = min(max(len(nm) * 7.4, len(kind) * 6.2) + 10, wpx - 4)
                out.append(f'<rect x="{X(bx0) + 2:.1f}" y="{Y(by1) + 2:.1f}" width="{bw:.1f}" height="29" rx="3" fill="#fff" fill-opacity="0.9" stroke="#222" stroke-width="0.7"/>')
                out.append(f'<text x="{X(bx0) + 6:.1f}" y="{Y(by1) + 15:.1f}" font-family="{FONT}" font-size="12" font-weight="bold" fill="#111">{html.escape(nm)}</text>')
                out.append(f'<text x="{X(bx0) + 6:.1f}" y="{Y(by1) + 27:.1f}" font-family="{FONT}" font-size="10" fill="#444">{html.escape(kind[:max(6, int((bw - 8) / 6))])}</text>')
            if mc is not None and wpx >= 60:
                for pn, pin in mc.pins.items():
                    if not pin.rects:
                        continue
                    _ly, a, b, c2, d = pin.rects[0]
                    px, py = transform_point(((a + c2) / 2.0, (b + d) / 2.0), o, inst.orient)
                    if pn in SKIP_PIN_LABELS:
                        if pn in ("VPWR", "VGND") and k == 0:
                            out.append(_tx(pn + (" 전원+" if pn == "VPWR" else " 접지"), X(bx1) - 4, Y(py) + (12 if pn == "VGND" else -4), 9.5,
                                           "#a33" if pn == "VPWR" else "#235", "end", "bold"))
                        continue
                    out.append(f'<circle cx="{X(px):.1f}" cy="{Y(py):.1f}" r="3.4" fill="#fff" stroke="#c00" stroke-width="1.5"/>')
                    kind_ko = "출력" if pin.direction == "OUTPUT" else "입력" if pin.direction == "INPUT" else ""
                    out.append(_tx(f"{pn} {kind_ko}".strip(), X(px) + 6, Y(py) + 4, 10, "#a00", "start", "bold"))
    for s in cv.shapes:  # shapes drawn by the user
        if s.kind == "label":
            out.append(f'<circle cx="{X(s.points[0][0]):.1f}" cy="{Y(s.points[0][1]):.1f}" r="3.5" fill="#fff" stroke="#00a" stroke-width="1.4"/>')
            out.append(_tx("라벨 " + s.text, X(s.points[0][0]) + 7, Y(s.points[0][1]) + 4, 11, "#00a", "start", "bold"))
            continue
        bb = s.bbox()
        kind = {"rect": "사각형", "polygon": "다각형", "path": "배선"}.get(s.kind, s.kind)
        cx, cy = (bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2
        tag = f"{s.layer} {kind}" + (f" 폭{s.width:g}" if s.kind == "path" else "")
        if (bb[1][0] - bb[0][0]) * sc > 50 or (bb[1][1] - bb[0][1]) * sc > 50:
            out.append(_tx(tag, X(cx), Y(cy) + 4, 10.5, "#222", "middle", "bold"))
    for v in cv.vias:
        out.append(_tx(v.via_def.name, X(v.origin[0]) + 8, Y(v.origin[1]) - 6, 9.5, "#333", "start"))


def _plain_labels(cv: CellView, out: list, X, Y, sc: float) -> None:
    for s in cv.shapes:
        if s.kind == "label":
            fs = max(9.0, min(18.0, s.height * sc * 1.2))
            out.append(f'<text x="{X(s.points[0][0]):.1f}" y="{Y(s.points[0][1]):.1f}" font-family="monospace" font-size="{fs:.0f}" fill="#111">{html.escape(s.text)}</text>')
    for inst in cv.instances:
        bb = inst.bbox()
        out.append(f'<text x="{X(bb[0][0]) + 2:.1f}" y="{Y(bb[1][1]) + 12:.1f}" font-family="monospace" font-size="10" fill="#222" fill-opacity="0.85">{html.escape(inst.name)}</text>')
