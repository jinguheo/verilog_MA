import pya
ly = pya.Layout(); ly.read(gds)
top = ly.top_cell(); dbu = ly.dbu
for li in ly.layer_indexes():
    info = ly.get_info(li)
    r = pya.Region(top.begin_shapes_rec(li)).merged()
    hits=[]
    for p in r.each():
        for e in p.each_edge():
            xm=e.x1*dbu
            if 419.0<xm<419.7 and abs(e.dx())==0 and abs(e.dy())*dbu>0.5 and -63<e.y1*dbu<-44:
                hits.append((round(xm,3),round(e.y1*dbu,2),round(e.y2*dbu,2)))
    if hits: print((info.layer,info.datatype), hits[:5])
