import sys, os
import klayout.db as db
path = os.environ["GDS"]
ly = db.Layout(); ly.read(path)
top = ly.top_cell()
print("klayout top:", top.name, "cells:", ly.cells(), "dbu:", ly.dbu)
bb = top.dbbox()
print("top bbox um: (%.3f %.3f)-(%.3f %.3f)" % (bb.left, bb.bottom, bb.right, bb.top))
tot = 0
for li in ly.layer_indexes():
    info = ly.get_info(li)
    n = top.begin_shapes_rec(li).shape().__class__ and sum(1 for _ in [0])  # placeholder
    r = db.Region(top.begin_shapes_rec(li))
    if r.count():
        print("  layer %s: polygons(flat)=%d area=%.3f um2" % (info, r.count(), r.area() * ly.dbu * ly.dbu))
