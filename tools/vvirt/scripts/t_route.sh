cd /mnt/d/MyWork/Veriolg_MA/tools/vvirt/src && python3 - <<'PY'
from vvirt import rules as R
obs=[(-0.15,-0.15,0.15,0.15),(2.85,-0.15,3.15,0.15),(1.4,-1.0,1.6,1.0)]
for prefer in (None,"V","H"):
    print(prefer, R.route((0,0),(3,0),0.14,0.14,obs,prefer=prefer,snap=0.005))
# check a Z-y candidate by hand
pts=[(0,0),(0,-1.4),(3,-1.4),(3,0)]
own=[o for o in obs if (o[0]<=0<=o[2] and o[1]<=0<=o[3]) or (o[0]<=3<=o[2] and o[1]<=0<=o[3])]
oth=[o for o in obs if o not in own]
print("own",own,"others",oth)
for r in R.wire_rects(pts,0.14): print(r,[round(R._gap(r,o),3) for o in oth])
PY
