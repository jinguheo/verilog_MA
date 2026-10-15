"""Self-contained HTML report of one history: setup summary, per-point output table with spec status, waveform plots (inline SVG),
Monte Carlo histograms. No scripts, no external files."""
from __future__ import annotations

import html as _h
import math
import os

import numpy as np

from . import results as R, units
from .calc import Wave

PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4b5563", "#65a30d", "#ea580c"]


def _esc(x) -> str:
    return _h.escape(str(x), quote=True)


def _ticks(lo: float, hi: float, log: bool, n: int = 6) -> list[float]:
    if log:
        a, b = math.floor(math.log10(lo)), math.ceil(math.log10(hi))
        return [10.0 ** k for k in range(a, b + 1)]
    if hi == lo:
        return [lo]
    step = 10 ** math.floor(math.log10((hi - lo) / n))
    for m in (1, 2, 5, 10):
        if (hi - lo) / (step * m) <= n:
            step *= m
            break
    first = math.ceil(lo / step) * step
    out, v = [], first
    while v <= hi + step * 1e-9:
        out.append(round(v, 12))
        v += step
    return out


def svg_plot(series: list[tuple[str, np.ndarray, np.ndarray]], xlabel: str, ylabel: str, logx: bool, width: int = 640, height: int = 260) -> str:
    series = [(n, x, y) for n, x, y in series if len(x) > 1 and np.all(np.isfinite(y))]
    if not series:
        return "<p class='muted'>no data</p>"
    xs = np.concatenate([s[1] for s in series])
    ys = np.concatenate([s[2] for s in series])
    if logx:
        xs = xs[xs > 0]
    xlo, xhi = float(xs.min()), float(xs.max())
    ylo, yhi = float(ys.min()), float(ys.max())
    if yhi == ylo:
        ylo, yhi = ylo - 1, yhi + 1
    pad = (yhi - ylo) * 0.05
    ylo, yhi = ylo - pad, yhi + pad
    L, R_, T, B = 62, 12, 10, 34
    w, h = width - L - R_, height - T - B

    def X(v):
        return L + ((math.log10(v) - math.log10(xlo)) / (math.log10(xhi) - math.log10(xlo)) if logx else (v - xlo) / ((xhi - xlo) or 1)) * w

    def Y(v):
        return T + (1 - (v - ylo) / ((yhi - ylo) or 1)) * h

    o = [f"<svg viewBox='0 0 {width} {height}' xmlns='http://www.w3.org/2000/svg' role='img' aria-label='{_esc(ylabel)} versus {_esc(xlabel)}'>"]
    for t in _ticks(xlo, xhi, logx):
        if xlo <= t <= xhi:
            x = X(t)
            o.append(f"<line x1='{x:.1f}' y1='{T}' x2='{x:.1f}' y2='{T + h}' class='grid'/><text x='{x:.1f}' y='{T + h + 14}' class='tick' text-anchor='middle'>{_esc(units.eng(t, 3))}</text>")
    for t in _ticks(ylo, yhi, False):
        if ylo <= t <= yhi:
            y = Y(t)
            o.append(f"<line x1='{L}' y1='{y:.1f}' x2='{L + w}' y2='{y:.1f}' class='grid'/><text x='{L - 6}' y='{y + 3:.1f}' class='tick' text-anchor='end'>{_esc(units.eng(t, 3))}</text>")
    o.append(f"<rect x='{L}' y='{T}' width='{w}' height='{h}' class='frame'/>")
    for i, (name, x, y) in enumerate(series):
        if len(x) > 1500:                                   # keep the page light: thin to ~1500 points
            idx = np.linspace(0, len(x) - 1, 1500).astype(int)
            x, y = x[idx], y[idx]
        m = (x > 0) if logx else np.ones(len(x), bool)
        pts = " ".join(f"{X(a):.1f},{Y(b):.1f}" for a, b in zip(x[m], y[m]))
        o.append(f"<polyline points='{pts}' fill='none' stroke='{PALETTE[i % len(PALETTE)]}' stroke-width='1.6'><title>{_esc(name)}</title></polyline>")
    o.append(f"<text x='{L + w / 2}' y='{height - 4}' class='lab' text-anchor='middle'>{_esc(xlabel)}</text>")
    o.append(f"<text x='12' y='{T + h / 2}' class='lab' text-anchor='middle' transform='rotate(-90 12 {T + h / 2})'>{_esc(ylabel)}</text>")
    o.append("</svg>")
    legend = "".join(f"<span class='key'><i style='background:{PALETTE[i % len(PALETTE)]}'></i>{_esc(n)}</span>" for i, (n, _x, _y) in enumerate(series[:12]))
    return "".join(o) + f"<div class='legend'>{legend}</div>"


def svg_hist(values: list[float], label: str, spec_lines: list[tuple[str, float]], width: int = 420, height: int = 180) -> str:
    a = np.array(values, dtype=float)
    if len(a) < 2:
        return ""
    bins = max(5, min(30, int(math.sqrt(len(a)) * 2)))
    cnt, edges = np.histogram(a, bins=bins)
    L, T, B = 44, 8, 30
    w, h = width - L - 10, height - T - B
    peak = max(1, int(cnt.max()))
    xlo, xhi = float(edges[0]), float(edges[-1])
    o = [f"<svg viewBox='0 0 {width} {height}' xmlns='http://www.w3.org/2000/svg' role='img' aria-label='histogram of {_esc(label)}'>"]
    bw = w / bins
    for i, c in enumerate(cnt):
        bh = c / peak * h
        o.append(f"<rect x='{L + i * bw:.1f}' y='{T + h - bh:.1f}' width='{max(bw - 1, 1):.1f}' height='{bh:.1f}' fill='{PALETTE[0]}' opacity='0.8'/>")
    o.append(f"<rect x='{L}' y='{T}' width='{w}' height='{h}' class='frame'/>")
    for t in _ticks(xlo, xhi, False, 4):
        x = L + (t - xlo) / ((xhi - xlo) or 1) * w
        o.append(f"<text x='{x:.1f}' y='{T + h + 13}' class='tick' text-anchor='middle'>{_esc(units.eng(t, 3))}</text>")
    for name, v in spec_lines:
        if xlo <= v <= xhi:
            x = L + (v - xlo) / ((xhi - xlo) or 1) * w
            o.append(f"<line x1='{x:.1f}' y1='{T}' x2='{x:.1f}' y2='{T + h}' stroke='#dc2626' stroke-dasharray='4 3'/><text x='{x + 3:.1f}' y='{T + 11}' class='tick' fill='#dc2626'>{_esc(name)}</text>")
    o.append(f"<text x='{L - 6}' y='{T + 9}' class='tick' text-anchor='end'>{peak}</text><text x='{L - 6}' y='{T + h}' class='tick' text-anchor='end'>0</text></svg>")
    return "".join(o)


CSS = """body{font:14px/1.45 system-ui,Segoe UI,sans-serif;margin:24px auto;max-width:1100px;padding:0 16px;color:#111;background:#fff}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{font-size:14px;margin:16px 0 4px}
.muted{color:#666}.pass{color:#15803d;font-weight:600}.fail{color:#b91c1c;font-weight:600}.error{color:#b45309;font-weight:600}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}th{background:#f4f4f5}
td.num{text-align:right;font-variant-numeric:tabular-nums}svg{width:100%;max-width:700px;height:auto;display:block}
.grid{stroke:#e5e7eb}.frame{fill:none;stroke:#9ca3af}.tick{font-size:10px;fill:#4b5563}.lab{font-size:11px;fill:#374151}
.legend{font-size:12px;margin:2px 0 10px}.key{margin-right:12px;white-space:nowrap}.key i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}
.cards{display:flex;gap:12px;flex-wrap:wrap}.card{border:1px solid #ddd;border-radius:6px;padding:8px 14px;min-width:120px}.card b{display:block;font-size:18px}
@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e5e7eb}th{background:#1c1f26}th,td,.card{border-color:#333}.grid{stroke:#2a2f3a}.frame{stroke:#5b6472}.tick,.lab{fill:#aab}.muted{color:#999}h2{border-color:#333}}"""


def _num(v) -> str:
    return units.eng(v, 5) if isinstance(v, (int, float)) else _esc(v)


def html(store: R.HistoryStore, history: str, sch=None) -> str:
    sm = store.read(history)
    ov = R.overall(sm)
    pts = sm["points"]
    o = [f"<!doctype html><html lang='en'><meta charset='utf-8'><title>Maestro {_esc(history)}</title><style>{CSS}</style><body>"]
    o.append(f"<h1>{_esc(sm['lib'])}/{_esc(sm['cell'])} - {_esc(history)}</h1><div class='muted'>{_esc(sm.get('simulator', ''))} - {_esc(sm.get('mode', ''))} - {_esc(sm.get('created', ''))} - {len(pts)} point(s) - {_esc(sm.get('seconds', 0))} s of simulator time</div>")
    o.append("<div class='cards'>" + "".join(f"<div class='card'><span class='muted'>{k}</span><b class='{c}'>{_esc(v)}</b></div>" for k, v, c in (
        ("overall", ov["status"], ov["status"] if ov["status"] in ("pass", "fail", "error") else "muted"), ("pass", ov["pass"], "pass"), ("fail", ov["fail"], "fail" if ov["fail"] else "muted"),
        ("error", ov["error"], "error" if ov["error"] else "muted"), ("yield", "-" if ov["yield"] is None else f"{ov['yield']:.1f} %", "muted"))) + "</div>")

    setup = sm.get("setup", {})
    o.append("<h2>Setup</h2><table><tr><th>Test</th><th>Design</th><th>Analyses</th><th>Outputs / specs</th></tr>")
    specs = {(s["test"], s["output"]): s for s in setup.get("specs", [])}
    for t in setup.get("tests", []):
        an = "; ".join(f"{k}: " + ", ".join(f"{a}={b}" for a, b in v.get("options", {}).items()) for k, v in t.get("analyses", {}).items() if v.get("enable", True))
        outs = []
        for out in t.get("outputs", []):
            sp = specs.get((t["name"], out["name"]))
            outs.append(f"<code>{_esc(out['name'])}</code> = <code>{_esc(out.get('expr') or out.get('signal'))}</code>" + (f" <span class='muted'>[spec {_esc(' '.join(f'{k} {v}' for k, v in sp.items() if k not in ('test', 'output')))}]</span>" if sp else ""))
        o.append(f"<tr><td>{_esc(t['name'])}</td><td>{_esc(t.get('lib'))}/{_esc(t.get('cell'))}</td><td>{_esc(an)}</td><td>{'<br>'.join(outs)}</td></tr>")
    o.append("</table>")
    var_txt = ", ".join(f"{k}={v}" for k, v in setup.get("vars", {}).items())
    cor = "; ".join(f"{c['name']}{'' if c.get('enabled', True) else ' (off)'}: " + ", ".join(f"{k}={v}" for k, v in c.get("vars", {}).items()) for c in setup.get("corners", []))
    if var_txt or cor:
        o.append(f"<p class='muted'>Variables: {_esc(var_txt) or '-'}<br>Corners: {_esc(cor) or '-'}</p>")

    var_names = sorted({k for p in pts for k in p.get("vars", {})})
    onames: list[str] = []
    for p in pts:
        for n in p.get("outputs", {}):
            if n not in onames:
                onames.append(n)
    scalar_names = [n for n in onames if any(p.get("outputs", {}).get(n, {}).get("kind") == "scalar" for p in pts)]
    o.append("<h2>Results</h2><table><tr><th>#</th><th>Test</th><th>Corner</th>" + "".join(f"<th>{_esc(v)}</th>" for v in var_names) + "".join(f"<th>{_esc(n)}</th>" for n in scalar_names) + "<th>Status</th></tr>")
    for p in pts:
        st = R.point_status(p)
        cells = []
        for n in scalar_names:
            r = p.get("outputs", {}).get(n)
            if r is None:
                cells.append("<td></td>")
            elif r["kind"] == "scalar":
                cls = {"pass": "pass", "fail": "fail"}.get(r.get("spec_status", ""), "")
                cells.append(f"<td class='num {cls}' title='{_esc(r.get('spec', ''))}'>{_num(r['value'])}</td>")
            else:
                cells.append(f"<td class='error' title='{_esc(r.get('error', ''))}'>{_esc(r['kind'])}</td>")
        o.append(f"<tr><td>{p['id']}</td><td>{_esc(p['test'])}</td><td>{_esc(p.get('corner') or '')}</td>" + "".join(f"<td>{_esc(p.get('vars', {}).get(v, ''))}</td>" for v in var_names)
                 + "".join(cells) + f"<td class='{st}'>{st}</td></tr>")
        if not p.get("ok") and p.get("errors"):
            o.append(f"<tr><td></td><td colspan='{len(var_names) + len(scalar_names) + 3}' class='error'>{_esc(p['errors'][0])}</td></tr>")
    o.append("</table>")

    # waveform outputs, overlaying every point of a test
    wave_names = [n for n in onames if any(p.get("outputs", {}).get(n, {}).get("kind") == "wave" for p in pts)]
    if wave_names:
        o.append("<h2>Waveforms</h2>")
    for t in sorted({p["test"] for p in pts}):
        for n in wave_names:
            series = []
            for p in R.points(sm, t):
                if p.get("outputs", {}).get(n, {}).get("kind") != "wave":
                    continue
                w = R.load_waves(os.path.join(store.path(history), p["dir"], "outputs.npz")).get(n)
                if w is not None:
                    label = f"#{p['id']} " + (p.get("corner") or "") + " " + " ".join(f"{k}={v}" for k, v in p.get("vars", {}).items() if k in var_names and sum(1 for q in pts if q.get("vars", {}).get(k) != p.get("vars", {}).get(k)))
                    series.append((label.strip(), w))
            if not series:
                continue
            o.append(f"<h3>{_esc(t)} / {_esc(n)}</h3>")
            w0: Wave = series[0][1]
            if any(s[1].y.dtype.kind == "c" for s in series):
                o.append(svg_plot([(l, w.x, 20 * np.log10(np.maximum(np.abs(w.y), 1e-300))) for l, w in series], w0.xname, "magnitude (dB)", w0.logx))
                o.append(svg_plot([(l, w.x, np.degrees(np.unwrap(np.angle(w.y)))) for l, w in series], w0.xname, "phase (deg)", w0.logx, height=200))
            else:
                o.append(svg_plot([(l, w.x, np.real(w.y)) for l, w in series], w0.xname, n, w0.logx))

    mc = [p for p in pts if p.get("mc_index")]
    if mc:
        o.append("<h2>Monte Carlo</h2>")
        for t in sorted({p["test"] for p in mc}):
            for n in scalar_names:
                vals = [p["outputs"][n]["value"] for p in R.points(sm, t) if n in p.get("outputs", {}) and p["outputs"][n].get("kind") == "scalar"]
                if len(vals) < 2:
                    continue
                st = R.output_stats(sm, t, n)
                spec = setup and next((s for s in setup.get("specs", []) if s["test"] == t and s["output"] == n), None)
                lines = [(k, units.si(spec[k])) for k in ("lt", "gt", "minimum", "maximum") if spec and spec.get(k) is not None]
                o.append(f"<h3>{_esc(t)} / {_esc(n)}</h3><p class='muted'>n={st['n']} mean={_num(st['mean'])} std={_num(st['std'])} min={_num(st['min'])} max={_num(st['max'])}</p>{svg_hist(vals, n, lines)}")
    o.append("</body></html>")
    return "".join(o)
