"""Placement/routing parameters read from the PDK files (and the run's resolved.json) instead of typed-in constants.

Every value carries its source so a report can say where it came from:
  site / row height      <pdk>/libs.ref/<lib>/techlef/*.tlef        SITE unithd  (0.46 x 2.72)
  latch-up distance      <pdk>/libs.tech/magic/sky130A.tech         "N-diff distance to P-tap must be < 15.0um (LU.2)" / LU.3
  tap spacing used       <run>/resolved.json                        FP_TAPCELL_DIST (the flow's own tap pitch)
  routing layers         tlef (see techlef.py)                      direction / pitch / width / spacing / area
When a file is missing the documented default is used and the source says "default".
"""
from __future__ import annotations

import json
import os
import re

from .stdcell import find_pdk_root
from . import techlef

DEFAULTS = {"site_um": 0.46, "row_um": 2.72, "lu_um": 15.0}


def read(pdk_root: str | None = None, run_dir: str | None = None, site: str = "unithd") -> dict:
    root = pdk_root or find_pdk_root()
    p: dict = {"site_um": DEFAULTS["site_um"], "row_um": DEFAULTS["row_um"], "lu_um": DEFAULTS["lu_um"], "tap_dist_um": None, "source": {}}
    for k in ("site_um", "row_um", "lu_um"):
        p["source"][k] = "default"
    if root:
        for t in [x for x in [techlef.find_tlef(root)] if x]:
            m = re.search(r"^SITE\s+%s\b.*?SIZE\s+([\d.]+)\s+BY\s+([\d.]+)" % site, open(t, encoding="utf-8", errors="replace").read(), re.S | re.M)
            if m:
                p["site_um"], p["row_um"] = float(m.group(1)), float(m.group(2))
                p["source"]["site_um"] = p["source"]["row_um"] = os.path.relpath(t, root)
                break
        tech = os.path.join(root, "libs.tech", "magic", "sky130A.tech")
        if os.path.exists(tech):
            vals = [float(v) for v in re.findall(r"distance to [NP]-tap(?: in deep nwell)?\.?\s*must be < ([\d.]+)um \(LU", open(tech, encoding="utf-8", errors="replace").read())]
            if vals:
                p["lu_um"] = min(vals)
                p["source"]["lu_um"] = "libs.tech/magic/sky130A.tech (LU.2/LU.3)"
    if run_dir:
        rj = os.path.join(run_dir, "resolved.json")
        if os.path.exists(rj):
            v = json.load(open(rj, encoding="utf-8")).get("FP_TAPCELL_DIST")
            if v:
                p["tap_dist_um"] = float(v)
                p["source"]["tap_dist_um"] = "run resolved.json FP_TAPCELL_DIST"
    return p


def tech(pdk_root: str | None = None) -> techlef.TechLef | None:
    t = techlef.find_tlef(pdk_root or find_pdk_root())
    return techlef.parse(t) if t else None
