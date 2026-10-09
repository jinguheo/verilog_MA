import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d))).merged()
nw=reg(64,20); dn=reg(64,18); tap=reg(65,44); psdm=reg(94,20); nsdm=reg(93,44)
ntap = tap & nsdm
holes = nw.holes()
print("holes:", holes.count())
for p in holes.each():
    b=p.bbox(); print("  hole", [round(v*dbu,2) for v in (b.left,b.bottom,b.right,b.top)])
def chk(name, region):
    w = region.width_check(int(0.84/dbu)); s = region.space_check(int(1.27/dbu))
    print(name, "width<0.84:", w.count(), " space<1.27:", s.count())
chk("orig nwell", nw)
for g in (0.0, 0.2, 0.25, 0.3):
    grown = nw - holes.sized(int(g/dbu))
    chk("nwell with holes grown by %.2f"%g, grown)
# N-tap enclosure by nwell (>=0.33) check for grown 0.25
grown = nw - holes.sized(int(0.25/dbu))
enc = ntap.enclosed_check if False else None
bad = ntap.inside_part(grown.sized(0)) if False else None
# ntap must stay enclosed with 0.33 margin: ntap sized .33 must be inside grown
out = ntap.sized(int(0.33/dbu)) - grown
print("ntap not enclosed by >=0.33 in grown nwell:", out.count())
for p in out.each():
    b=p.bbox(); print("   ", [round(v*dbu,2) for v in (b.left,b.bottom,b.right,b.top)])
