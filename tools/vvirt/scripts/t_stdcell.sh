#!/usr/bin/env bash
cd /mnt/d/MyWork/Veriolg_MA/tools/vvirt/src
python3 - <<'PY'
import time
t=time.time()
from vvirt.stdcell import StdCellLib
lib=StdCellLib()
print("root",lib.root,"masters",len(lib.masters),"gds cells",len(lib.gds.index) if lib.gds else None,"t=%.2f"%(time.time()-t))
m=lib.masters["sky130_fd_sc_hd__inv_1"]
print(m.name,m.width,m.height,{k:(v.direction,v.use,len(v.rects)) for k,v in m.pins.items()})
g=lib.cell_geometry("sky130_fd_sc_hd__inv_1")
print({k:len(v) for k,v in g.items()}, lib.gds.dbu_um)
print(g["polys"][:2], g["texts"][:3])
print(lib.search("nand2")[:5])
PY
