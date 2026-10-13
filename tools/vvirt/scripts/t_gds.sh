#!/usr/bin/env bash
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
G=$ROOT/workspace/_out/layout_demo_20261013_215243.gds
cd $ROOT/src
python3 - "$G" <<'PY'
import sys
from vvirt.gdsio import GdsFile
g=GdsFile(sys.argv[1])
print("structs",g.cells(),"dbu_um",g.dbu_um)
for c in g.cells():
    d=g.read_cell(c); print(c,{k:len(v) for k,v in d.items()})
PY
which klayout || ls ~/.local/bin 2>/dev/null | head
python3 -c "import gdstk" 2>&1 | head -1
