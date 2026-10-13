cd /mnt/d/MyWork/Veriolg_MA/tools/vvirt/src && python3 - <<'PY'
from vvirt.rules import RuleSet
r=RuleSet()
print(r.source)
for l in ["li1","met1","met2","met3","met4","met5","mcon","via","via2","via3","via4"]:
    print(l, r.rules.get(l), "wide",r.wide.get(l), "dir",r.directions.get(l), "pitch",r.pitches.get(l), "enc",r.cut_enc.get(l))
print(r.enclosures)
PY
