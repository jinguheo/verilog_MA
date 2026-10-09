import pya
a = pya.Layout(); a.read(f1); b = pya.Layout(); b.read(f2)
ta, tb = a.top_cell(), b.top_cell()
print("top", ta.name, tb.name, "bbox", ta.dbbox(), tb.dbbox())
tot = 0
for li in a.layer_indexes():
    info = a.get_info(li)
    lb = b.find_layer(info.layer, info.datatype)
    ra = pya.Region(ta.begin_shapes_rec(li)).merged()
    rb = pya.Region(tb.begin_shapes_rec(lb)).merged() if lb is not None else pya.Region()
    x = ra ^ rb
    if not x.is_empty():
        bb = x.bbox()
        print((info.layer, info.datatype), "xor polys", x.count(), "area um2", round(x.area()*a.dbu*a.dbu,3), "bbox", [round(v*a.dbu,2) for v in (bb.left, bb.bottom, bb.right, bb.top)])
        tot += 1
print("layers differing:", tot)
