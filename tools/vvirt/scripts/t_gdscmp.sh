ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
cd $ROOT/src && python3 - <<'PY'
from vvirt.gdsio import GdsFile
for f in ["flower_xstream.gds"]:
    g=GdsFile("/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/_out/"+f)
    d=g.read_cell("flower")
    layers=sorted({(l,dt) for l,dt,_ in d["polys"]}|{(l,dt) for l,dt,*_ in d["paths"]})
    print(f, "polys",len(d["polys"]),"paths",len(d["paths"]),"texts",len(d["texts"]),"layers",layers)
PY
export GDS=$ROOT/workspace/_out/flower_xstream.gds
klayout -b -r $ROOT/scripts/kl_check.py 2>&1 | head -12
