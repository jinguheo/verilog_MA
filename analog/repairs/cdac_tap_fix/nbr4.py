import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
win = pya.Box(int(423.5/dbu), int(-62/dbu), int(424.2/dbu), int(-45/dbu))
seen=set()
for li in ly.layer_indexes():
    info = ly.get_info(li)
    r = pya.Region(top.begin_shapes_rec(li)).merged()
    for p in (r & pya.Region(win)).each():
        b=p.bbox()
        key=(info.layer,info.datatype)
        print(key, [round(v*dbu,3) for v in (b.left,b.bottom,b.right,b.top)])
