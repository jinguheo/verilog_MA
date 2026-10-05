import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
X=423.82
for li in ly.layer_indexes():
    info = ly.get_info(li)
    r = pya.Region(top.begin_shapes_rec(li)).merged()
    hits=[]
    for p in r.each():
        for e in p.each_edge():
            if abs(e.x1*dbu-X)<0.004 and abs(e.x2*dbu-X)<0.004 and abs(e.dy())*dbu>1:
                hits.append((round(e.y1*dbu,2),round(e.y2*dbu,2)))
    if hits: print((info.layer,info.datatype), hits[:6])
