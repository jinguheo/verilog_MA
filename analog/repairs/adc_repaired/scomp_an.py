import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
print("bbox um", top.dbbox())
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d))).merged()
nw=reg(64,20); dn=reg(64,18); hvi=reg(75,20)
tap=reg(65,44); diff=reg(65,20); psdm=reg(94,20); nsdm=reg(93,44)
ptap = tap & psdm
print("nwell polys", nw.count(), "tap", tap.count())
# P-tap and n+ diff regions; rule region: within 0.43 of nwell (HV)
mvnw = nw & hvi.sized(0) if False else nw
bad_p = ptap.separation_check(mvnw, int(0.43/dbu))
print("ptap<->nwell sep violations (edge pairs):", bad_p.count())
for ep in list(bad_p.each())[:40]:
    f=ep.first; s=ep.second
    print("  ", [round(v*dbu,3) for v in (f.p1.x,f.p1.y,f.p2.x,f.p2.y)], "|", [round(v*dbu,3) for v in (s.p1.x,s.p1.y,s.p2.x,s.p2.y)], "dist", round(ep.distance()*dbu,3) if hasattr(ep,'distance') else '')
