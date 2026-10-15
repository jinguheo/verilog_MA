"""Waveforms and a calculator in the style of the Virtuoso calculator / OCEAN, evaluated by vvirt's SKILL interpreter.

An output expression such as   bandwidth(mag(VF("/OUT")) 3 "low")   or   ymax(VT("/OUT")) - ymin(VT("/OUT"))   is parsed by the
SKILL interpreter; the functions below are registered on it and `Wave` objects take part in ordinary arithmetic (+ - * / **).
Numbers may carry SI suffixes (1G, 10n, 3.3u). Interpolation along a frequency axis is done in log(x).

Not Cadence: the function set is the commonly used core, defined here (see FUNCTIONS), semantics documented per function.
"""
from __future__ import annotations

import math
import re
from typing import Any, Callable

import numpy as np

from .. import skill_lang
from . import units
from .deck import netname
from .rawfile import Plot


class CalcError(Exception):
    pass


class Wave:
    """y(x). x is real and increasing for the analyses used here; y may be complex (AC)."""

    def __init__(self, x, y, xname: str = "x", yname: str = "", logx: bool = False) -> None:
        self.x = np.asarray(x, dtype=float)
        self.y = np.asarray(y)
        self.xname, self.yname, self.logx = xname, yname, logx

    def __repr__(self) -> str:
        return f"<wave {self.yname or 'y'}({self.xname}) {len(self.x)} points>"

    def like(self, y, yname: str = "") -> "Wave":
        return Wave(self.x, y, self.xname, yname or self.yname, self.logx)

    # --- arithmetic -------------------------------------------------------------------------
    def _other(self, o: Any) -> np.ndarray:
        if isinstance(o, Wave):
            if len(o.x) == len(self.x) and np.allclose(o.x, self.x, rtol=1e-12, atol=0):
                return o.y
            return _interp(self.x, o.x, o.y, o.logx)
        return np.asarray(o)

    def __add__(self, o): return self.like(self.y + self._other(o))
    __radd__ = __add__
    def __sub__(self, o): return self.like(self.y - self._other(o))
    def __rsub__(self, o): return self.like(self._other(o) - self.y)
    def __mul__(self, o): return self.like(self.y * self._other(o))
    __rmul__ = __mul__
    def __truediv__(self, o): return self.like(self.y / self._other(o))
    def __rtruediv__(self, o): return self.like(self._other(o) / self.y)
    def __pow__(self, o): return self.like(self.y ** self._other(o))
    def __neg__(self): return self.like(-self.y)
    def __abs__(self): return self.like(np.abs(self.y))


def _interp(xq, x, y, logx: bool = False):
    xq = np.asarray(xq, dtype=float)
    if logx and np.all(x > 0) and np.all(xq > 0):
        xs, xqs = np.log10(x), np.log10(xq)
    else:
        xs, xqs = x, xq
    if np.iscomplexobj(y):
        return np.interp(xqs, xs, y.real) + 1j * np.interp(xqs, xs, y.imag)
    return np.interp(xqs, xs, y)


# ----------------------------------------------------------------------------------------------- numeric helpers
def _need_wave(w: Any, fn: str) -> Wave:
    if not isinstance(w, Wave):
        raise CalcError(f"{fn}: expected a waveform, got {type(w).__name__}")
    return w


def _real(w: Wave, fn: str) -> np.ndarray:
    if np.iscomplexobj(w.y):
        raise CalcError(f"{fn}: waveform is complex; use mag(), phase(), real() or imag() first")
    return w.y


def _crossings(w: Wave, level: float, edge: str = "either") -> list[float]:
    y = _real(w, "cross") - level
    x = w.x
    out: list[float] = []
    for i in range(len(y) - 1):
        a, b = y[i], y[i + 1]
        if a == 0 and i == 0:
            continue
        rising = a < 0 <= b
        falling = a > 0 >= b
        if (edge in ("rising", "either") and rising) or (edge in ("falling", "either") and falling):
            if b == a:
                continue
            t = -a / (b - a)
            if w.logx and x[i] > 0 and x[i + 1] > 0:
                out.append(float(10 ** (math.log10(x[i]) + t * (math.log10(x[i + 1]) - math.log10(x[i])))))
            else:
                out.append(float(x[i] + t * (x[i + 1] - x[i])))
    return out


def _trapz(x, y):
    return float(np.trapezoid(y, x)) if hasattr(np, "trapezoid") else float(np.trapz(y, x))


def _cumtrapz(x, y):
    out = np.zeros(len(y), dtype=y.dtype)
    out[1:] = np.cumsum(0.5 * (y[1:] + y[:-1]) * np.diff(x))
    return out


def _edge(s: Any) -> str:
    s = "either" if s is None else str(s).lower()
    if s not in ("rising", "falling", "either"):
        raise CalcError(f"edge must be \"rising\", \"falling\" or \"either\", got {s!r}")
    return s


# ----------------------------------------------------------------------------------------------- functions
def _mag(w): return w.like(np.abs(w.y)) if isinstance(w, Wave) else abs(w)
def _phase(w):
    w = _need_wave(w, "phase")
    return w.like(np.degrees(np.unwrap(np.angle(w.y))))
def _db20(w): return w.like(20 * np.log10(np.maximum(np.abs(w.y), 1e-300))) if isinstance(w, Wave) else 20 * math.log10(abs(w))
def _db10(w): return w.like(10 * np.log10(np.maximum(np.abs(w.y), 1e-300))) if isinstance(w, Wave) else 10 * math.log10(abs(w))


def _ufunc(fn_np: Callable, fn_math: Callable) -> Callable:
    def f(a):
        return a.like(fn_np(a.y)) if isinstance(a, Wave) else fn_math(a)
    return f


def _value(w, x):
    w = _need_wave(w, "value")
    r = _interp([float(x)], w.x, w.y, w.logx)[0]
    return complex(r) if np.iscomplexobj(w.y) else float(r)


def _ymax(w): return float(np.max(_real(_need_wave(w, "ymax"), "ymax")))
def _ymin(w): return float(np.min(_real(_need_wave(w, "ymin"), "ymin")))
def _xmax(w): return float(np.max(_need_wave(w, "xmax").x))
def _xmin(w): return float(np.min(_need_wave(w, "xmin").x))
def _p2p(w): return _ymax(w) - _ymin(w)


def _average(w):
    w = _need_wave(w, "average")
    y = _real(w, "average")
    span = w.x[-1] - w.x[0]
    return float(y[0]) if span == 0 else _trapz(w.x, y) / span


def _rms(w):
    w = _need_wave(w, "rms")
    y = _real(w, "rms")
    span = w.x[-1] - w.x[0]
    return float(abs(y[0])) if span == 0 else math.sqrt(_trapz(w.x, y * y) / span)


def _stddev(w):
    y = _real(_need_wave(w, "stddev"), "stddev")
    return float(np.std(y, ddof=1)) if len(y) > 1 else 0.0


def _integ(w):
    w = _need_wave(w, "integ")
    return w.like(_cumtrapz(w.x, w.y))


def _deriv(w):
    w = _need_wave(w, "deriv")
    return w.like(np.gradient(w.y, w.x))


def _clip(w, x0, x1):
    w = _need_wave(w, "clip")
    lo, hi = sorted((float(x0), float(x1)))
    m = (w.x >= lo) & (w.x <= hi)
    if m.sum() < 2:
        raise CalcError(f"clip: fewer than two points in [{lo:g}, {hi:g}]")
    return Wave(w.x[m], w.y[m], w.xname, w.yname, w.logx)


def _cross(w, level, n=1, edge="either"):
    w = _need_wave(w, "cross")
    c = _crossings(w, float(level), _edge(edge))
    n = int(n)
    if n == 0:
        return c or None
    return c[n - 1] if 0 < n <= len(c) else (c[n] if n < 0 and -n <= len(c) else None)


def _delay(w1, l1, e1, w2, l2, e2):
    a = _crossings(_need_wave(w1, "delay"), float(l1), _edge(e1))
    b = _crossings(_need_wave(w2, "delay"), float(l2), _edge(e2))
    if not a or not b:
        return None
    t0 = a[0]
    later = [t for t in b if t >= t0]
    return (later[0] - t0) if later else None


def _levels(w, initial, final):
    y = _real(w, "edge time")
    lo = float(np.min(y)) if initial is None else float(initial)
    hi = float(np.max(y)) if final is None else float(final)
    return lo, hi


def _rise_time(w, initial=None, final=None, lo_pct=10.0, hi_pct=90.0):
    lo, hi = _levels(_need_wave(w, "riseTime"), initial, final)
    if hi <= lo:
        return None
    a = _crossings(w, lo + (hi - lo) * lo_pct / 100, "rising")
    b = _crossings(w, lo + (hi - lo) * hi_pct / 100, "rising")
    if not a or not b:
        return None
    later = [t for t in b if t >= a[0]]
    return (later[0] - a[0]) if later else None


def _fall_time(w, initial=None, final=None, lo_pct=10.0, hi_pct=90.0):
    lo, hi = _levels(_need_wave(w, "fallTime"), initial, final)
    if hi <= lo:
        return None
    a = _crossings(w, lo + (hi - lo) * hi_pct / 100, "falling")
    b = _crossings(w, lo + (hi - lo) * lo_pct / 100, "falling")
    if not a or not b:
        return None
    later = [t for t in b if t >= a[0]]
    return (later[0] - a[0]) if later else None


def _overshoot(w, initial=None, final=None):
    y = _real(_need_wave(w, "overshoot"), "overshoot")
    ini = float(y[0]) if initial is None else float(initial)
    fin = float(y[-1]) if final is None else float(final)
    if fin == ini:
        return None
    return float((np.max(y) - fin) / abs(fin - ini) * 100.0) if fin > ini else float((fin - np.min(y)) / abs(fin - ini) * 100.0)


def _settling(w, tol=0.02, final=None):
    y = _real(_need_wave(w, "settlingTime"), "settlingTime")
    fin = float(y[-1]) if final is None else float(final)
    band = abs(fin - float(y[0])) * float(tol)
    outside = np.where(np.abs(y - fin) > band)[0]
    if len(outside) == 0:
        return float(w.x[0])
    k = outside[-1]
    return float(w.x[min(k + 1, len(w.x) - 1)])


def _slew(w):
    return float(np.max(np.abs(np.gradient(_real(_need_wave(w, "slewRate"), "slewRate"), w.x))))


def _periods(w):
    y = _real(_need_wave(w, "period"), "period")
    mid = 0.5 * (float(np.max(y)) + float(np.min(y)))
    c = _crossings(w, mid, "rising")
    return np.diff(c) if len(c) > 1 else np.array([])


def _period(w):
    p = _periods(w)
    return float(np.mean(p)) if len(p) else None


def _frequency(w):
    p = _period(w)
    return (1.0 / p) if p else None


def _duty(w):
    y = _real(_need_wave(w, "dutyCycle"), "dutyCycle")
    mid = 0.5 * (float(np.max(y)) + float(np.min(y)))
    r, f = _crossings(w, mid, "rising"), _crossings(w, mid, "falling")
    if len(r) < 1 or not f:
        return None
    for tr in r:
        later = [t for t in f if t > tr]
        nxt = [t for t in r if t > tr]
        if later and nxt:
            return (later[0] - tr) / (nxt[0] - tr) * 100.0
    return None


def _bandwidth(w, level=3.0, kind="low"):
    w = _need_wave(w, "bandwidth")
    y = np.abs(w.y)
    wm = Wave(w.x, y, w.xname, w.yname, w.logx)
    thr = 10 ** (-float(level) / 20.0)
    kind = str(kind).lower()
    if kind == "low":
        c = _crossings(wm, y[0] * thr, "falling")
        return c[0] if c else None
    if kind == "high":
        c = _crossings(wm, y[-1] * thr, "rising")
        return c[-1] if c else None
    if kind == "band":
        k = int(np.argmax(y))
        ref = y[k] * thr
        lo = _crossings(wm, ref, "rising")
        hi = _crossings(wm, ref, "falling")
        lo = [c for c in lo if c <= w.x[k]]
        hi = [c for c in hi if c >= w.x[k]]
        return (hi[0] - lo[-1]) if lo and hi else None
    raise CalcError('bandwidth: kind must be "low", "high" or "band"')


def _unity_gain_freq(w):
    w = _need_wave(w, "unityGainFreq")
    wm = Wave(w.x, np.abs(w.y), w.xname, w.yname, w.logx)
    c = _crossings(wm, 1.0, "falling")
    return c[0] if c else None


def _gbw(w):
    return _unity_gain_freq(w)


def _phase_margin(w):
    w = _need_wave(w, "phaseMargin")
    f = _unity_gain_freq(w)
    if f is None:
        return None
    ph = np.degrees(np.unwrap(np.angle(w.y)))
    ph = ph - 360.0 * round(float(ph[0]) / 360.0)   # start in (-180, 180] so an inverting loop gain (phase 180 at dc) is read the same way
    return float(180.0 + _interp([f], w.x, ph, w.logx)[0])


def _gain_margin(w):
    w = _need_wave(w, "gainMargin")
    ph = np.degrees(np.unwrap(np.angle(w.y)))
    c = _crossings(Wave(w.x, ph, w.xname, "", w.logx), -180.0, "falling")
    if not c:
        return None
    mag = float(_interp([c[0]], w.x, np.abs(w.y), w.logx)[0])
    return -20.0 * math.log10(max(mag, 1e-300))


def _dc_gain(w):
    w = _need_wave(w, "dcGain")
    return float(np.abs(w.y[0]))


def _resample_uniform(w: Wave, start, stop, n):
    t = np.linspace(start, stop, n, endpoint=False)
    return t, _interp(t, w.x, w.y, False)


def _dft(w, start=None, stop=None, npts=1024, window="rectangular"):
    w = _need_wave(w, "dft")
    start = float(w.x[0]) if start is None else float(start)
    stop = float(w.x[-1]) if stop is None else float(stop)
    n = int(npts)
    t, y = _resample_uniform(w, start, stop, n)
    win = {"rectangular": np.ones(n), "hann": np.hanning(n), "hamming": np.hamming(n), "blackman": np.blackman(n)}.get(str(window).lower())
    if win is None:
        raise CalcError("dft: window must be rectangular, hann, hamming or blackman")
    spec = np.fft.rfft(y * win) / (np.sum(win) / 2.0)
    spec[0] = spec[0] / 2.0
    f = np.fft.rfftfreq(n, d=(stop - start) / n)
    return Wave(f, spec, "frequency", "dft")


def _thd(w, fund, nharm=10, npts=4096):
    """THD in percent: sqrt(sum |H_k|^2, k=2..nharm) / |H_1| from an FFT over a whole number of periods of `fund`."""
    w = _need_wave(w, "thd")
    fund = float(fund)
    span = w.x[-1] - w.x[0]
    nper = int(span * fund + 1e-9)
    if nper < 1:
        raise CalcError("thd: the waveform is shorter than one period of the fundamental")
    stop = float(w.x[0]) + nper / fund
    n = int(npts)
    t, y = _resample_uniform(w, float(w.x[0]), stop, n)
    spec = np.abs(np.fft.rfft(y * np.hanning(n)))
    df_bin = nper  # bin index of the fundamental
    h = [spec[k * df_bin - 1:k * df_bin + 2].max() for k in range(1, int(nharm) + 1) if k * df_bin + 1 < len(spec)]
    if len(h) < 2 or h[0] == 0:
        return None
    return float(100.0 * math.sqrt(sum(v * v for v in h[1:])) / h[0])


def _sample_count(w): return len(_need_wave(w, "size").x)


def _max(*a): return max(a)
def _min(*a): return min(a)


FUNCTIONS: dict[str, Callable] = {
    "mag": _mag, "magnitude": _mag, "phase": _phase, "db20": _db20, "dB20": _db20, "db10": _db10, "dB10": _db10,
    "real": lambda w: w.like(np.real(w.y)) if isinstance(w, Wave) else float(np.real(w)),
    "imag": lambda w: w.like(np.imag(w.y)) if isinstance(w, Wave) else float(np.imag(w)),
    "conjugate": lambda w: w.like(np.conj(w.y)),
    "abs": lambda w: abs(w),
    "sqrt": _ufunc(np.sqrt, math.sqrt), "exp": _ufunc(np.exp, math.exp), "ln": _ufunc(np.log, math.log), "log": _ufunc(np.log, math.log),
    "log10": _ufunc(np.log10, math.log10), "sin": _ufunc(np.sin, math.sin), "cos": _ufunc(np.cos, math.cos), "tan": _ufunc(np.tan, math.tan),
    "atan": _ufunc(np.arctan, math.atan), "tanh": _ufunc(np.tanh, math.tanh),
    "pow": lambda a, b: a ** b,
    "value": _value, "ymax": _ymax, "ymin": _ymin, "xmax": _xmax, "xmin": _xmin, "peakToPeak": _p2p,
    "average": _average, "mean": _average, "rms": _rms, "stddev": _stddev, "integ": _integ, "deriv": _deriv, "clip": _clip,
    "cross": _cross, "delay": _delay, "riseTime": _rise_time, "fallTime": _fall_time, "overshoot": _overshoot, "settlingTime": _settling,
    "slewRate": _slew, "period": _period, "frequency": _frequency, "dutyCycle": _duty,
    "bandwidth": _bandwidth, "unityGainFreq": _unity_gain_freq, "gainBwProd": _gbw, "phaseMargin": _phase_margin, "gainMargin": _gain_margin,
    "dcGain": _dc_gain, "dft": _dft, "thd": _thd, "size": _sample_count,
    "max": _max, "min": _min,
}

_SI_LITERAL = re.compile(r"(?<![\w.\"])(\d+\.?\d*(?:[eE][+-]?\d+)?)(meg|[fpnumkMGTa])(?![\w\"(])")


def expand_si(expr: str) -> str:
    """Rewrite SI-suffixed number literals (1G, 10n) outside string literals as plain floats."""
    parts = re.split(r'("(?:\\.|[^"\\])*")', expr)
    out = []
    for i, p in enumerate(parts):
        if i % 2 == 1:
            out.append(p)
        else:
            out.append(_SI_LITERAL.sub(lambda m: repr(units.si(m.group(1) + m.group(2))), p))
    return "".join(out)


class Calc:
    """Evaluate expressions against the plots of one simulation point.

    plots: kind ("ac", "tran", "dc", "op", "noise", ...) -> Plot.
    default: kind used by v()/i() when the function does not name an analysis itself; None means "only one is available".
    current: optional callable(net_or_pin, kind) -> Wave|float|None to derive currents the simulator did not save.
    """

    def __init__(self, plots: dict[str, Plot], default: str | None = None, current: Callable | None = None,
                 params: dict[str, float] | None = None) -> None:
        self.plots = plots
        self.default = default
        self.current = current
        self.params = params or {}
        self.interp = skill_lang.Interp()
        self._install()

    # ---- signal access ------------------------------------------------------------------
    def _kind(self, kind: str | None) -> str:
        if kind:
            if kind not in self.plots:
                raise CalcError(f"no {kind} results at this point (available: {', '.join(sorted(self.plots)) or 'none'})")
            return kind
        if self.default and self.default in self.plots:
            return self.default
        cand = [k for k in self.plots if k not in ("noise_int",)]
        if len(cand) == 1:
            return cand[0]
        raise CalcError("ambiguous analysis: this test has several; use VT/VF/VDC/getData(... ?result \"tran\") or select an analysis")

    @staticmethod
    def sig_name(name: str, what: str) -> str:
        return f"{what}({netname(name)})"

    def wave(self, name: str, what: str, kind: str | None) -> Any:
        k = self._kind(kind)
        p = self.plots[k]
        key = self.sig_name(name, what)
        if key not in p.data:
            alt = [n for n in p.names if n.startswith(what + "(")]
            raise CalcError(f"signal {name!r} not found in the {k} results ({key}); available: {', '.join(alt[:12])}")
        y = p.data[key]
        if k == "op":
            return complex(y[0]) if np.iscomplexobj(y) else float(y[0])
        x = np.real(p.data[p.x_name])
        return Wave(x, y, p.x_name, key, logx=(k in ("ac", "noise")))

    def _install(self) -> None:
        F = self.interp.funcs
        F.update(FUNCTIONS)

        def sig(what: str, kind: str | None):
            def f(name):
                try:
                    return self.wave(name, what, kind)
                except CalcError:
                    if what == "i" and self.current:
                        r = self.current(str(name), self._kind(kind))
                        if r is not None:
                            return r
                    raise
            return f

        for nm, (what, kind) in {"v": ("v", None), "VT": ("v", "tran"), "VF": ("v", "ac"), "VDC": ("v", "dc"), "VOP": ("v", "op"),
                                 "i": ("i", None), "IT": ("i", "tran"), "IF": ("i", "ac"), "IDC": ("i", "dc"), "IOP": ("i", "op")}.items():
            F[nm] = sig(what, kind)
        F["vdc"] = F["VDC"]

        def get_data(name, **kw):
            res = kw.get("result")
            kind = str(res) if res else None
            n = str(name)
            if n.lower() in ("time", "frequency") and (kind or self.default or len(self.plots) == 1):
                p = self.plots[self._kind(kind)]
                return Wave(np.arange(len(p.data[p.x_name])), np.real(p.data[p.x_name]), "index", n)
            what = "v"
            if re.match(r"^[iv]\(", n):
                what, n = n[0], n[2:-1]
            return self.wave(n, what, kind)

        F["getData"] = get_data

        def onoise(**kw):
            p = self.plots.get("noise")
            if p is None or "onoise_spectrum" not in p.data:
                raise CalcError("no output-noise results (run a noise analysis)")
            return Wave(np.real(p.data[p.x_name]), np.real(p.data["onoise_spectrum"]), p.x_name, "onoise", logx=True)

        def inoise(**kw):
            p = self.plots.get("noise")
            if p is None or "inoise_spectrum" not in p.data:
                raise CalcError("no input-noise results (run a noise analysis)")
            return Wave(np.real(p.data[p.x_name]), np.real(p.data["inoise_spectrum"]), p.x_name, "inoise", logx=True)

        def onoise_total():
            p = self.plots.get("noise_int")
            if p is None or "v(onoise_total)" not in p.data:
                raise CalcError("no integrated output noise (run a noise analysis)")
            return float(np.real(p.data["v(onoise_total)"][-1]))

        def inoise_total():
            p = self.plots.get("noise_int")
            if p is None or "v(inoise_total)" not in p.data:
                raise CalcError("no integrated input noise (run a noise analysis)")
            return float(np.real(p.data["v(inoise_total)"][-1]))

        F["onoise"], F["inoise"], F["onoise_total"], F["inoise_total"] = onoise, inoise, onoise_total, inoise_total
        F["var"] = lambda name: self.params[str(name)] if str(name) in self.params else (_ for _ in ()).throw(CalcError(f"unknown variable {name!r}"))
        F["VAR"] = F["var"]

    # ---- evaluation ---------------------------------------------------------------------
    def eval(self, expr: str) -> Any:
        text = expand_si(str(expr))
        try:
            r = self.interp.eval_text(text)
        except skill_lang.SkillError as exc:
            raise CalcError(str(exc.message)) from exc
        except (ZeroDivisionError, FloatingPointError) as exc:
            raise CalcError(f"arithmetic error: {exc}") from exc
        return _plain(r)


def _plain(r: Any) -> Any:
    if isinstance(r, bool) or r is None:
        return r
    if isinstance(r, (np.floating, np.integer)):
        return float(r)
    if isinstance(r, np.bool_):
        return bool(r)
    if isinstance(r, np.ndarray) and r.ndim == 0:
        return r.item()
    return r


def to_scalar(r: Any) -> float | None:
    """Scalar value of a result for specs and tables: floats pass, complex -> magnitude, waves/None -> None."""
    if isinstance(r, bool) or r is None or isinstance(r, (Wave, str, list)):
        return None
    if isinstance(r, complex):
        return abs(r)
    try:
        return float(r)
    except (TypeError, ValueError):
        return None
