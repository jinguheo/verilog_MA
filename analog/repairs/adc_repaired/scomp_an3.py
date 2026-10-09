import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
def reg(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d))).merged()
nw=reg(64,20); tap=reg(65,44); nsdm=reg(93,44); psdm=reg(94,20)
ntap = tap & nsdm
holes = nw.holes()
S=lambda um:int(round(um/dbu))
base_bad = ntap.sized(S(0.33)) - nw
print("baseline ntap(+0.33) outside nwell:", base_bad.count())
for g in (0.25,):
    grown = nw - holes.sized(S(g))
    bad = ntap.sized(S(0.33)) - grown
    new = bad - base_bad.sized(S(0.01))
    print("grown", g, "offenders:", bad.count(), "new:", new.count())
    for p in new.each():
        b=p.bbox(); print("  new", [round(v*dbu,3) for v in (b.left,b.bottom,b.right,b.top)])
# what is the n-tap enclosure margin in the original: min distance ntap edge to nwell boundary
enc = ntap.enclosed_check(nw, S(0.33)) if hasattr(ntap,'enclosed_check') else None
print("enclosure (<0.33) pairs in original:", enc.count() if enc is not None else 'n/a')
