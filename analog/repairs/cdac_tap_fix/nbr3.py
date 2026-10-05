import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d)))
win = pya.Region(pya.Box(int(421/dbu), int(-63/dbu), int(427/dbu), int(-44/dbu)))
for name,(l,d) in (("nwell",(64,20)),("dnwell",(64,18))):
    r = reg(l,d).merged() & win
    for p in r.each():
        print(name, [(round(pt.x*dbu,3), round(pt.y*dbu,3)) for pt in p.each_point_hull()])
