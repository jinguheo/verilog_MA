"""Recolor the raw OpenROAD placement screenshots (tools/wsl/chan_top_reshape_raw/*.png, red std cells on
black, cyan PDN stripes) into the dashboard palette and write them to
my_dashboard/public/macro-area/chan-top-reshape/. Only colors change - every pixel keeps its brightness
(= cell density / stripe intensity), so the picture shows exactly the same placement.

  python tools/recolor_reshape_pngs.py

Palette (same as the Macro Tetris canvas): background #101726, std cells purple #7F77DD, PDN stripes green #1D9E75.
"""
import pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "tools/wsl/chan_top_reshape_raw"
DST = ROOT / "my_dashboard/public/macro-area/chan-top-reshape"
BG = np.array([0x10, 0x17, 0x26], float)
CELL = np.array([0x7F, 0x77, 0xDD], float)
PDN = np.array([0x1D, 0x9E, 0x75], float)


def ramp(t, color):
    t = np.clip(t, 0, 1)[..., None]
    return BG + (color - BG) * t


for f in sorted(SRC.glob("*.png")):
    a = np.asarray(Image.open(f).convert("RGB"), float) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    cyan = np.minimum(g, b) - 0.5 * r            # stripes: green+blue high, red low
    is_pdn = cyan > 0.25
    cell_t = np.maximum(r, 0.5 * (g + b)) ** 1.5  # brightness of the (red) cell fill / grid lines
    out = np.where(is_pdn[..., None], ramp(np.minimum(1, cyan * 1.3 + 0.15), PDN), ramp(cell_t, CELL))
    # keep pure-black pixels (outside the die) at the dashboard background
    out = np.where((a.max(-1) < 0.02)[..., None], BG, out)
    DST.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype("uint8")).save(DST / f.name, optimize=True)  # size unchanged: aspect = die W:H
    print(f.name, a.shape[1], "x", a.shape[0])
