"""SPICE/engineering-notation numbers: "10n" -> 1e-8, 1e-8 -> "10n"."""
from __future__ import annotations

import math
import re

_SUFFIX = {"f": 1e-15, "p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3, "k": 1e3, "meg": 1e6, "g": 1e9, "t": 1e12, "a": 1e-18, "x": 1e6}
_NUM = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]*)\s*$")


def si(value, default=None) -> float:
    """Parse a number or an SI string ("1G", "10n", "5 meg", "1e-3", "100mV" -> trailing unit letters after the suffix are ignored)."""
    if isinstance(value, bool):
        raise ValueError("boolean is not a number")
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        if default is not None:
            return default
        raise ValueError("no value")
    m = _NUM.match(str(value))
    if not m:
        raise ValueError(f"not a number: {value!r}")
    num, suf = float(m.group(1)), m.group(2)
    if not suf:
        return num
    low = suf.lower()
    if low.startswith("meg"):
        return num * 1e6
    if low[0] in _SUFFIX and not (low[0] == "m" and low.startswith("mil")):
        return num * _SUFFIX[low[0]]
    return num  # a bare unit such as "V" or "Hz"


def is_number(value) -> bool:
    try:
        si(value)
        return True
    except (ValueError, TypeError):
        return False


_ENG = [(1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "k"), (1.0, ""), (1e-3, "m"), (1e-6, "u"), (1e-9, "n"), (1e-12, "p"), (1e-15, "f")]


def eng(x: float, digits: int = 4) -> str:
    """Engineering notation with a Cadence-style suffix: 1.5e-9 -> "1.5n"."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return str(x)
    if x == 0:
        return "0"
    ax = abs(x)
    for scale, suf in _ENG:
        if ax >= scale * 0.9999999:
            return f"{x / scale:.{digits}g}{suf}"
    return f"{x:.{digits}g}"


def spice(x) -> str:
    """Number formatted for a SPICE deck (plain float, no suffix ambiguity)."""
    return repr(float(x)) if not isinstance(x, str) else x


def split_values(text) -> list[str]:
    """Maestro sweep syntax: "1p,100f" -> ["1p", "100f"]; "0.81:0.09:0.99" (from:step:to) -> the explicit list."""
    s = str(text).strip()
    if ":" in s and "," not in s:
        parts = s.split(":")
        if len(parts) == 3 and all(is_number(p) for p in parts):
            a, st, b = (si(p) for p in parts)
            if st == 0:
                return [parts[0]]
            n = int(math.floor((b - a) / st + 1e-9)) + 1
            return [repr(a + k * st) for k in range(max(n, 1))]
    return [p.strip() for p in s.split(",") if p.strip()]
