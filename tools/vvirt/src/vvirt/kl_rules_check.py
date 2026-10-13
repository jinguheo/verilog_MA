# Runs inside `klayout -b -r`: width / space / area / enclosure checks on merged regions.
import json
import klayout.db as db

DBU = 0.001
job = json.load(open(jin))  # noqa: F821  (jin / jout are passed with -rd)
rules, encl = job["rules"], job["enclosures"]


def to_region(polys):
    r = db.Region()
    for p in polys:
        r.insert(db.Polygon([db.Point(int(round(x / DBU)), int(round(y / DBU))) for x, y in p]))
    return r.merged()


def u(v):
    return int(round(v / DBU))


def box(b):
    return [[round(b.left * DBU, 4), round(b.bottom * DBU, 4)], [round(b.right * DBU, 4), round(b.top * DBU, 4)]]


regions = {l: to_region(p) for l, p in job["layers"].items()}
out = []
for layer, r in regions.items():
    rl = rules.get(layer, {})
    if "minWidth" in rl:
        for ep in r.width_check(u(rl["minWidth"])).each():
            out.append({"layer": layer, "rule": "minWidth", "required": rl["minWidth"], "bbox": box(ep.bbox())})
    if "minSpace" in rl:
        for ep in r.space_check(u(rl["minSpace"])).each():
            out.append({"layer": layer, "rule": "minSpace", "required": rl["minSpace"], "bbox": box(ep.bbox())})
    if "minArea" in rl:
        for p in r.with_area(0, int(round(rl["minArea"] / (DBU * DBU))), False).each():
            out.append({"layer": layer, "rule": "minArea", "required": rl["minArea"], "bbox": box(p.bbox())})
for cut, metal, e in encl:
    if cut in regions and metal in regions:
        c, m = regions[cut], regions[metal]
        for p in (c - m).each():
            out.append({"layer": cut, "rule": f"notInside {metal}", "required": 0, "bbox": box(p.bbox())})
        for ep in c.enclosed_check(m, u(e)).each():
            out.append({"layer": cut, "rule": f"enclosure by {metal}", "required": e, "bbox": box(ep.bbox())})
json.dump(out, open(jout, "w"))  # noqa: F821
