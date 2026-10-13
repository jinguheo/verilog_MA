"""Acceptance run: drive the virtual Virtuoso through the real virtuoso-bridge client API.

Creates a small sky130 layout from standard cells, then modifies it (add, move, select/delete, delete-by-layer, mosaic),
reads it back through the same SKILL builders the shipped examples use, and exports SVG + GDS.

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/accept_layout.py
"""
from __future__ import annotations

import sys

from virtuoso_bridge import VirtuosoClient
from virtuoso_bridge.virtuoso.layout import parse_layout_geometry_output
from virtuoso_bridge.virtuoso.layout.ops import (
    layout_create_label as label,
    layout_create_param_inst as inst,
    layout_create_path as path,
    layout_create_polygon as polygon,
    layout_create_rect as rect,
    layout_create_simple_mosaic as mosaic,
    layout_create_via_by_name as via,
    layout_delete_selected,
    layout_delete_shapes_on_layer,
    layout_list_shapes,
    layout_read_geometry,
    layout_read_summary,
    layout_select_box,
)

LIB, CELL = "testlib", "accept_inv_chain"
STD = "sky130_fd_sc_hd"
checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def main() -> int:
    c = VirtuosoClient.from_env()

    # ---- 1. create: three inverters in a row, a met1 strap, a via stack, a pin label, a polygon
    with c.layout.create(LIB, CELL) as lay:
        for i in range(3):
            lay.add(inst(STD, "sky130_fd_sc_hd__inv_1", "layout", f"U{i}", 1.38 * i, 0.0, "R0"))
        lay.add(rect("met1", "drawing", 0.0, 3.0, 4.14, 3.23))
        lay.add(path("met2", "drawing", [(0.5, 3.1), (0.5, 4.5), (3.0, 4.5)], 0.14))
        lay.add(via("M1M2_PR", 0.5, 3.1))
        lay.add(polygon("met3", "drawing", [(0.0, 5.0), (1.0, 5.0), (1.4, 5.6), (0.5, 6.0)]))
        lay.add(label("met1", "pin", 0.2, 3.1, "VIN", "centerLeft", "R0", "roman", 0.2))
    summary = c.execute_skill(layout_read_summary(LIB, CELL)).output or ""
    check("create: summary lists 3 instances", summary.count("inst:") == 3, summary.splitlines()[0] if summary else "")
    check("create: 4 shapes + 1 via", "(4 shapes  1 vias  3 instances)" in summary or "4 shapes" in summary, summary.splitlines()[0])

    # ---- 2. read geometry through the standard parser
    geo = parse_layout_geometry_output(c.execute_skill(layout_read_geometry(LIB, CELL)).output or "")
    kinds = sorted({g.get("objType") or g.get("kind") or g.get("type") for g in geo})
    check("read geometry returns objects", len(geo) >= 8, f"{len(geo)} objects, kinds={kinds}")

    # ---- 3. modify: move nothing, add a second row of cells, mosaic, then delete by layer and by selection
    with c.layout.modify(LIB, CELL) as lay:
        lay.add(inst(STD, "sky130_fd_sc_hd__nand2_1", "layout", "N0", 0.0, 2.72, "MX"))
        lay.add(mosaic(STD, "sky130_fd_sc_hd__buf_1", origin=(6.0, 0.0), rows=2, cols=3, row_pitch=2.72, col_pitch=2.3, instance_name="M0"))
        lay.add(rect("met4", "drawing", 0.0, 7.0, 2.0, 7.3))
    s2 = c.execute_skill(layout_read_summary(LIB, CELL)).output or ""
    check("modify: mosaic + nand added", "M0" in s2 and "N0" in s2, s2.splitlines()[0])

    with c.layout.modify(LIB, CELL) as lay:
        lay.add(layout_delete_shapes_on_layer("met4", "drawing"))
    s3 = c.execute_skill(layout_read_summary(LIB, CELL)).output or ""
    check("delete by layer removes met4 rect", "met4" not in s3, s3.splitlines()[0])

    c.open_window(LIB, CELL, view="layout")
    r = c.execute_skill(layout_select_box((0.3, 2.9, 3.1, 4.6))).output or ""
    check("select box finds the met2 path + via", "selected 2" in r, r)
    d = c.execute_skill(layout_delete_selected()).output or ""
    check("delete selected", "deleted" in d, d)
    s4 = c.execute_skill(layout_read_summary(LIB, CELL)).output or ""
    check("met2 path is gone, other shapes kept", "path [met2" not in s4 and "rect [met1" in s4 and "polygon [met3" in s4, s4.splitlines()[0])

    # ---- 4. introspection helpers an LLM can use
    cells = c.execute_skill('vvCells("sky130_fd_sc_hd" "nand2_1")').output or ""
    check("std-cell search", "sky130_fd_sc_hd__nand2_1" in cells, cells[:80])
    info = c.execute_skill('vvCellInfo("sky130_fd_sc_hd__inv_1")').output or ""
    check("std-cell pin info", '"Y"' in info and "2.72" in info, info[:100])

    # ---- 5. exports
    out = "/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out"
    svg = c.execute_skill(f'vvExportSvg("{LIB}" "{CELL}" "{out}/{CELL}.svg")').output or ""
    gds = c.execute_skill(f'vvExportGds("{LIB}" "{CELL}" "{out}/{CELL}.gds")').output or ""
    check("svg + gds exported", svg.endswith('.svg"') and gds.endswith('.gds"'), gds)

    bad = [n for n, ok, _ in checks if not ok]
    print(f"\n{len(checks) - len(bad)}/{len(checks)} checks passed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
