"""Coverage-aware reports: vvCheckReport / vvOfficialDrcReport / vvRoute limitations through the real client."""
import sys
from virtuoso_bridge import VirtuosoClient
c = VirtuosoClient.from_env()
ok = True
def sk(s):
    r = c.execute_skill(s)
    out = (r.output or "")
    print(">>", s.splitlines()[0][:90]); print("   ", out[:700], ("| ERR:" + "; ".join(r.errors)[:200]) if r.errors else "")
    return out
sk('cv = dbOpenCellViewByType("testlib" "smoke_report" "layout" "maskLayout" "w")')
sk('dbCreateRect(cv list("met2" "drawing") list(list(-0.15 -0.15) list(0.15 0.15)))\ndbCreateRect(cv list("met2" "drawing") list(list(2.85 -0.15) list(3.15 0.15)))\ndbCreateRect(cv list("met2" "drawing") list(list(1.4 -1.0) list(1.6 1.0)))\ndbCreateRect(cv list("poly" "drawing") list(list(5 5) list(5.2 5.3)))')
r = sk('vvRoute(cv "met2" list(0 0) list(3 0))')
ok &= "bounding boxes" in r
rep = sk('vvCheckReport(cv)')
ok &= '"clean_in_scope"' in rep and "presentWithoutRule" in rep and '"poly"' in rep and "notChecked" in rep
sk('dbCreatePath(cv list("met2" "drawing") list(list(0.0 0.24) list(1.2 0.24)) 0.14)')
rep2 = sk('vvCheckReport(cv list("met2"))')
ok &= '"violations"' in rep2 and "minSpace" in rep2
rep3 = sk('vvCheckReport(cv list("poly"))')
ok &= "nothing_checked" in rep3
off = sk('vvOfficialDrcReport(cv)')
ok &= "groupsRun" in off and "feol" in off and "m2.2" in off
sk('vvSetRule("met2" "minSpace" 0.5)')
ok &= "met2.minSpace" in sk('assoc("ruleOverrides" vvCheckReport(cv list("met2")))')
sk('vvLoadProfile("default")')
print("REPORTS OK" if ok else "REPORTS UNEXPECTED"); sys.exit(0 if ok else 1)
