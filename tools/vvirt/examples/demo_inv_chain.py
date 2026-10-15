"""LLM-style session: build a 4-inverter chain from sky130 standard cells, wire it with li1 using the cells' real
pin geometry, then modify it (swap one inverter for a stronger one and re-route). Everything goes through the real
virtuoso-bridge client; the "Virtuoso" on the other end is vvirt.

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/demo_inv_chain.py
"""
from __future__ import annotations

import re
import sys

from virtuoso_bridge import VirtuosoClient
from virtuoso_bridge.virtuoso.layout.ops import (
    layout_create_label as label,
    layout_create_param_inst as inst,
    layout_create_path as path,
    layout_create_rect as rect,
)

LIB, CELL, STD = "testlib", "inv_chain4", "sky130_fd_sc_hd"
OUT = "/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out"
c = VirtuosoClient.from_env()


def pins(cell: str) -> dict[str, tuple[float, float]]:
    """Centre of each signal pin's first rectangle, read through SKILL (vvCellInfo)."""
    res = {}
    for n in ("A", "Y"):
        x, y = map(float, re.findall(r"-?\d+\.?\d*", c.execute_skill(f'vvGet(vvPin("{STD}__{cell}" "{n}") "center")').output))
        res[n] = (x, y)
    return res


def width(cell: str) -> float:
    return float(c.execute_skill(f'vvGet(vvCellInfo("{STD}__{cell}") "width")').output)


def wires(cells: list[str]) -> list[str]:
    """li1 jumpers: output of stage i to input of stage i+1 (Manhattan, via a vertical detour above the cell row)."""
    cmds, x = [], 0.0
    xs = []
    for cname in cells:
        xs.append(x)
        x += width(cname)
    for i in range(len(cells) - 1):
        yo = pins(cells[i])["Y"]
        ai = pins(cells[i + 1])["A"]
        p0 = (xs[i] + yo[0], yo[1])
        p1 = (xs[i + 1] + ai[0], ai[1])
        mid = (p1[0] - 0.05, p0[1])
        cmds.append(path("li1", "drawing", [p0, mid, (mid[0], p1[1]), p1], 0.17))
    return cmds


def build(cells: list[str], mode_create: bool) -> None:
    ctx = c.layout.create(LIB, CELL) if mode_create else c.layout.modify(LIB, CELL)
    with ctx as lay:
        x = 0.0
        for i, cname in enumerate(cells):
            lay.add(inst(STD, f"{STD}__{cname}", "layout", f"S{i}", x, 0.0, "R0"))
            x += width(cname)
        for w in wires(cells):
            lay.add(w)
        a = pins(cells[0])["A"]
        lay.add(label("li1", "pin", a[0], a[1], "IN", "centerCenter", "R0", "roman", 0.1))
        y = pins(cells[-1])["Y"]
        lay.add(label("li1", "pin", x - width(cells[-1]) + y[0], y[1], "OUT", "centerCenter", "R0", "roman", 0.1))


# --- step 1: create
build(["inv_1"] * 4, True)
print(c.execute_skill(f'vvExportSvg("{LIB}" "{CELL}" "{OUT}/{CELL}_v1.svg")').output)

# --- step 2: modify -- remove all wiring + instances of the old row, rebuild with inv_2 at stage 3 (delete & re-place)
with c.layout.modify(LIB, CELL) as lay:
    lay.add('foreach(s cv~>shapes dbDeleteObject(s)) foreach(i cv~>instances dbDeleteObject(i))')
build(["inv_1", "inv_1", "inv_4", "inv_1"], False)
print(c.execute_skill(f'vvExportSvg("{LIB}" "{CELL}" "{OUT}/{CELL}_v2.svg")').output)
print(c.execute_skill(f'vvExportGds("{LIB}" "{CELL}" "{OUT}/{CELL}.gds")').output)
summary = c.execute_skill(f'let((cv) cv = dbOpenCellViewByType("{LIB}" "{CELL}" "layout" "maskLayout" "r") list(length(cv~>instances) length(cv~>shapes) cv~>bBox))').output
print("instances/shapes/bbox:", summary)
sys.exit(0 if summary and summary.startswith("(4 ") else 1)
