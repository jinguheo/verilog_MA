"""Read routing/via design rules from the PDK technology LEF (sky130_fd_sc_hd__nom.tlef).

This is the same file OpenROAD uses for routing, so min width / spacing / area / preferred direction / pitch /
cut size / cut spacing / cut enclosures come from the PDK instead of being typed in by hand. Full signoff DRC is
a different (much larger) rule set: the official sky130A_mr.drc deck (see vvirt.rules / vvOfficialDrc).
"""
from __future__ import annotations

import glob
import os
import re
from dataclasses import dataclass, field


@dataclass
class TechLayer:
    name: str
    type: str = ""
    direction: str | None = None
    pitch: float | None = None
    offset: float | None = None
    width: float | None = None
    spacing: float | None = None          # minimum spacing (narrow wires)
    wide: tuple[float, float] | None = None  # (wire width above which, spacing) from SPACINGTABLE
    area: float | None = None
    enc_below: tuple[float, float] | None = None
    enc_above: tuple[float, float] | None = None


@dataclass
class TechLef:
    path: str
    layers: dict[str, TechLayer] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)

    def cut_between(self) -> list[tuple[str, str, str]]:
        """(lower routing layer, cut layer, upper routing layer) following the LAYER order."""
        out = []
        for i, n in enumerate(self.order):
            if self.layers[n].type == "CUT" and 0 < i < len(self.order) - 1:
                out.append((self.order[i - 1], n, self.order[i + 1]))
        return out


def find_tlef(root: str | None = None) -> str | None:
    env = os.environ.get("VVIRT_TLEF")
    if env and os.path.isfile(env):
        return env
    pats = [os.path.join(root, "libs.ref", "sky130_fd_sc_hd", "techlef", "sky130_fd_sc_hd__nom.tlef")] if root else []
    pats.append(os.path.expanduser("~/.volare/volare/sky130/versions/*/sky130A/libs.ref/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef"))
    for p in pats:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    return None


def parse(path: str) -> TechLef:
    tl = TechLef(path)
    cur: TechLayer | None = None
    in_table = False
    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            m = re.match(r"LAYER\s+(\S+)\s*$", line)
            if m and cur is None:
                cur = TechLayer(m.group(1))
                tl.layers[cur.name] = cur
                tl.order.append(cur.name)
                in_table = False
                continue
            if cur is None:
                continue
            if re.match(r"END\s+" + re.escape(cur.name) + r"\s*$", line):
                cur, in_table = None, False
                continue
            f = line.rstrip(";").split()
            key = f[0]
            nums = [float(x) for x in f[1:] if re.fullmatch(r"-?\d+\.?\d*(?:[eE][-+]?\d+)?", x)]
            if key == "TYPE":
                cur.type = f[1]
            elif key == "DIRECTION":
                cur.direction = "H" if f[1].startswith("H") else "V"
            elif key == "PITCH" and nums:
                cur.pitch = nums[0] if len(nums) == 1 else min(nums)
            elif key == "OFFSET" and nums:
                cur.offset = nums[0]
            elif key == "SPACINGTABLE":
                in_table = True
            elif key == "WIDTH" and in_table and len(nums) == 2:
                w, s = nums
                if w == 0:
                    cur.spacing = s
                else:
                    cur.wide = (w, s)
                if line.endswith(";"):
                    in_table = False
            elif key == "WIDTH" and len(nums) == 1:
                cur.width = nums[0]
            elif key == "SPACING" and len(nums) == 1:
                cur.spacing = nums[0]
            elif key == "AREA" and nums:
                cur.area = nums[0]
            elif key == "ENCLOSURE" and len(f) >= 4 and f[1] in ("BELOW", "ABOVE"):
                pair = (float(f[2]), float(f[3]))
                if f[1] == "BELOW":
                    cur.enc_below = pair
                else:
                    cur.enc_above = pair
    return tl
