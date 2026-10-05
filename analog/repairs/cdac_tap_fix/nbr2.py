import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d)))
win = pya.Region(pya.Box(int(421/dbu), int(-63/dbu), int(430/dbu), int(-44/dbu)))
for name,(l,d) in (("nwell",(64,20)),("dnwell",(64,18)),("pwell",(64,44)),("hvi",(75,20))):
    r = reg(l,d).merged() & win
    print(name)
    for p in r.each():
        b=p.bbox(); print("  ",[round(v*dbu,3) for v in (b.left,b.bottom,b.right,b.top)], "pts", p.num_points())
