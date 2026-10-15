"""Natural-language style request: 'load sky130_fd_sc_hd, place nand2_1 and dfxtp_1 side by side, abutted'.
Resolves cell names/widths from the real library through the bridge, places them, reads the result back."""
import re
from virtuoso_bridge import VirtuosoClient
from virtuoso_bridge.virtuoso.layout.ops import layout_create_param_inst as inst

LIB, CELL, STD = "testlib", "place_cmd", "sky130_fd_sc_hd"
c = VirtuosoClient.from_env()
def info(cell):
    i = f'vvCellInfo("{STD}__{cell}")'
    name = c.execute_skill(f'vvGet({i} "name")').output.strip('"')
    w, h = map(float, re.findall(r"-?\d+\.?\d*", c.execute_skill(f'list(vvGet({i} "width") vvGet({i} "height"))').output))
    return name, w, h
print("libraries:", c.execute_skill('vvLibraries()').output)
print("dfxtp matches:", c.execute_skill(f'vvCells("{STD}" "dfxtp")').output)
(n1, w1, h1), (n2, w2, h2) = info("nand2_1"), info("dfxtp_1")
with c.layout.create(LIB, CELL) as lay:
    lay.add(inst(STD, n1, "layout", "U_nand", 0.0, 0.0, "R0"))
    lay.add(inst(STD, n2, "layout", "U_dff", w1, 0.0, "R0"))
    lay.add(inst(STD, n1, "layout", "U_nand_flip", 0.0, 2 * h1, "MX"))   # next row, mirrored like a real standard-cell row
print(c.execute_skill(f'let((cv) cv=dbOpenCellViewByType("{LIB}" "{CELL}" "layout" "maskLayout" "r") '
                      'mapcar(lambda((i) list(i~>name i~>cellName i~>xy i~>orient i~>bBox)) cv~>instances))').output)
print(c.execute_skill(f'vvExportSvg("{LIB}" "{CELL}" "/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out/{CELL}.svg")').output)
