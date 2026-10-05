import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell()
dbu = ly.dbu
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d)))
nw = reg(64, 20); dn = reg(64, 18)
# area of interest around dummy switches (um): x 423..446, y -64..-44
# GDS from magic: units may be um; print overall bbox first
print("top bbox um", top.dbbox())
# dummy switch instance 1 region from magic internal 84662..89082 /200 -> um
box = pya.Box(int(420/dbu), int(-65/dbu), int(450/dbu), int(-43/dbu))
for name, r in (("nwell", nw), ("dnwell", dn)):
    sub = (r & pya.Region(box))
    print(name, "polygons in window:")
    for p in sub.each():
        b = p.bbox()
        print("  ", [round(v*dbu,3) for v in (b.left, b.bottom, b.right, b.top)])
