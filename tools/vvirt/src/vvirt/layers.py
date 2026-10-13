"""sky130A layer/purpose map (GDS numbers verified from sky130A.lyp) and display colours."""
from __future__ import annotations

# layer name -> {purpose: (gds layer, gds datatype)}
LPP: dict[str, dict[str, tuple[int, int]]] = {
    "nwell": {"drawing": (64, 20), "pin": (64, 16), "label": (64, 5), "net": (84, 23)},
    "pwell": {"drawing": (64, 44), "pin": (122, 16), "label": (64, 59)},
    "dnwell": {"drawing": (64, 18)},
    "diff": {"drawing": (65, 20), "pin": (65, 16), "label": (65, 6), "boundary": (65, 4)},
    "tap": {"drawing": (65, 44), "pin": (65, 48), "label": (65, 5)},
    "psdm": {"drawing": (94, 20)},
    "nsdm": {"drawing": (93, 44)},
    "poly": {"drawing": (66, 20), "pin": (66, 16), "label": (66, 5), "gate": (66, 9)},
    "lvtn": {"drawing": (125, 44)},
    "hvtp": {"drawing": (78, 44)},
    "hvi": {"drawing": (75, 20)},
    "licon1": {"drawing": (66, 44), "pin": (66, 58)},
    "npc": {"drawing": (95, 20)},
    "li1": {"drawing": (67, 20), "pin": (67, 16), "label": (67, 5), "net": (67, 23), "boundary": (67, 4), "blockage": (67, 10)},
    "mcon": {"drawing": (67, 44), "pin": (67, 48)},
    "met1": {"drawing": (68, 20), "pin": (68, 16), "label": (68, 5), "net": (68, 23), "boundary": (68, 4), "blockage": (68, 10)},
    "via": {"drawing": (68, 44), "pin": (68, 58)},
    "met2": {"drawing": (69, 20), "pin": (69, 16), "label": (69, 5), "net": (69, 23), "boundary": (69, 4), "blockage": (69, 10)},
    "via2": {"drawing": (69, 44), "pin": (69, 58)},
    "met3": {"drawing": (70, 20), "pin": (70, 16), "label": (70, 5), "net": (70, 23), "boundary": (70, 4), "blockage": (70, 10)},
    "via3": {"drawing": (70, 44), "pin": (70, 48)},
    "met4": {"drawing": (71, 20), "pin": (71, 16), "label": (71, 5), "net": (71, 23), "boundary": (71, 4), "blockage": (71, 10)},
    "via4": {"drawing": (71, 44), "pin": (71, 48)},
    "met5": {"drawing": (72, 20), "pin": (72, 16), "label": (72, 5), "net": (72, 23), "boundary": (72, 4), "blockage": (72, 10)},
    "pad": {"drawing": (76, 20), "pin": (76, 16), "label": (76, 5)},
    "areaid": {"standardc": (81, 4), "core": (81, 2), "analog": (81, 79)},
    "prBoundary": {"boundary": (235, 4), "drawing": (235, 4)},
    "text": {"drawing": (83, 44)},
}

# Virtuoso-style aliases (M1, Metal1, POLY1, ...) -> sky130 layer name. Matching is case-insensitive.
ALIASES: dict[str, str] = {
    "m1": "met1", "m2": "met2", "m3": "met3", "m4": "met4", "m5": "met5",
    "metal1": "met1", "metal2": "met2", "metal3": "met3", "metal4": "met4", "metal5": "met5",
    "m1_m2": "via", "v1": "via", "via1": "via", "v2": "via2", "v3": "via3", "v4": "via4",
    "poly1": "poly", "po": "poly", "polysilicon": "poly", "oxide": "diff", "od": "diff", "active": "diff",
    "contact": "licon1", "co": "licon1", "licon": "licon1", "li": "li1", "local_interconnect": "li1",
    "nw": "nwell", "pw": "pwell", "boundary": "prBoundary", "prboundary": "prBoundary",
}

# Via definitions (name -> cut layer, bottom conductor, top conductor, cut size um, enclosure um)
VIADEFS: dict[str, dict] = {
    "licon1_poly": {"cut": "licon1", "bot": "poly", "top": "li1", "cut_size": 0.17, "enc_bot": 0.08, "enc_top": 0.08},
    "licon1_diff": {"cut": "licon1", "bot": "diff", "top": "li1", "cut_size": 0.17, "enc_bot": 0.04, "enc_top": 0.08},
    "mcon": {"cut": "mcon", "bot": "li1", "top": "met1", "cut_size": 0.17, "enc_bot": 0.0, "enc_top": 0.03},
    "L1M1_PR": {"cut": "mcon", "bot": "li1", "top": "met1", "cut_size": 0.17, "enc_bot": 0.0, "enc_top": 0.03},
    "via": {"cut": "via", "bot": "met1", "top": "met2", "cut_size": 0.15, "enc_bot": 0.055, "enc_top": 0.055},
    "M1M2_PR": {"cut": "via", "bot": "met1", "top": "met2", "cut_size": 0.15, "enc_bot": 0.055, "enc_top": 0.055},
    "M1_M2": {"cut": "via", "bot": "met1", "top": "met2", "cut_size": 0.15, "enc_bot": 0.055, "enc_top": 0.055},
    "via2": {"cut": "via2", "bot": "met2", "top": "met3", "cut_size": 0.20, "enc_bot": 0.04, "enc_top": 0.065},
    "M2M3_PR": {"cut": "via2", "bot": "met2", "top": "met3", "cut_size": 0.20, "enc_bot": 0.04, "enc_top": 0.065},
    "M2_M3": {"cut": "via2", "bot": "met2", "top": "met3", "cut_size": 0.20, "enc_bot": 0.04, "enc_top": 0.065},
    "via3": {"cut": "via3", "bot": "met3", "top": "met4", "cut_size": 0.20, "enc_bot": 0.06, "enc_top": 0.065},
    "M3M4_PR": {"cut": "via3", "bot": "met3", "top": "met4", "cut_size": 0.20, "enc_bot": 0.06, "enc_top": 0.065},
    "M3_M4": {"cut": "via3", "bot": "met3", "top": "met4", "cut_size": 0.20, "enc_bot": 0.06, "enc_top": 0.065},
    "via4": {"cut": "via4", "bot": "met4", "top": "met5", "cut_size": 0.80, "enc_bot": 0.19, "enc_top": 0.31},
    "M4M5_PR": {"cut": "via4", "bot": "met4", "top": "met5", "cut_size": 0.80, "enc_bot": 0.19, "enc_top": 0.31},
    "M4_M5": {"cut": "via4", "bot": "met4", "top": "met5", "cut_size": 0.80, "enc_bot": 0.19, "enc_top": 0.31},
}

# SVG fill colours (approximating the sky130 KLayout palette)
COLORS: dict[str, str] = {
    "nwell": "#b9d9a0", "pwell": "#d7c4a8", "dnwell": "#8fb080", "diff": "#7fbf7f", "tap": "#5fa05f",
    "psdm": "#e9b6c9", "nsdm": "#b6c9e9", "poly": "#d94b4b", "lvtn": "#caa", "hvtp": "#cac", "hvi": "#cca",
    "licon1": "#222222", "npc": "#bbb", "li1": "#e0a03c", "mcon": "#444444",
    "met1": "#4a74d9", "via": "#222222", "met2": "#c95fd1", "via2": "#333333",
    "met3": "#3fbfa0", "via3": "#333333", "met4": "#d9c13f", "via4": "#333333", "met5": "#d98a3f",
    "pad": "#999999", "areaid": "#eeeeee", "prBoundary": "#000000", "text": "#000000",
}
DRAW_ORDER = ["nwell", "pwell", "dnwell", "areaid", "diff", "tap", "psdm", "nsdm", "lvtn", "hvtp", "hvi", "npc", "poly", "licon1",
              "li1", "mcon", "met1", "via", "met2", "via2", "met3", "via3", "met4", "via4", "met5", "pad", "prBoundary", "text"]

_GDS_TO_LPP: dict[tuple[int, int], tuple[str, str]] = {}
for _l, _ps in LPP.items():
    for _p, _lp in _ps.items():
        _GDS_TO_LPP.setdefault(_lp, (_l, _p))


def canonical(layer: str) -> str | None:
    """Resolve an LLM-supplied layer name to a sky130 layer name, or None if unknown."""
    if layer in LPP:
        return layer
    low = layer.lower()
    for k in LPP:
        if k.lower() == low:
            return k
    return ALIASES.get(low)


def to_gds(layer: str, purpose: str) -> tuple[int, int] | None:
    c = canonical(layer)
    if c is None:
        return None
    ps = LPP[c]
    if purpose in ps:
        return ps[purpose]
    if purpose == "drawing" and ps:
        return next(iter(ps.values()))
    # unknown purposes of a known layer fall back to the drawing datatype
    return ps.get("drawing")


def from_gds(layer: int, datatype: int) -> tuple[str, str] | None:
    return _GDS_TO_LPP.get((layer, datatype))
