"""sky130_fd_sc_hd standard-cell library: masters from LEF (size/pins) and layout from GDS."""
from __future__ import annotations

import glob
import os
import re
from dataclasses import dataclass, field

from .gdsio import GdsFile


@dataclass
class Pin:
    name: str
    direction: str = "INPUT"
    use: str = "SIGNAL"
    rects: list[tuple[str, float, float, float, float]] = field(default_factory=list)  # (lef layer, x0,y0,x1,y1) um


@dataclass
class Master:
    name: str
    width: float = 0.0
    height: float = 0.0
    pins: dict[str, Pin] = field(default_factory=dict)


def find_pdk_root() -> str | None:
    env = os.environ.get("VVIRT_PDK_ROOT")
    if env and os.path.isdir(env):
        return env
    cands = glob.glob(os.path.expanduser("~/.volare/volare/sky130/versions/*/sky130A"))
    return sorted(cands)[-1] if cands else None


class StdCellLib:
    def __init__(self, root: str | None = None, libname: str = "sky130_fd_sc_hd") -> None:
        self.root = root or find_pdk_root()
        self.libname = libname
        self.masters: dict[str, Master] = {}
        self.gds: GdsFile | None = None
        self.gds_dbu_um = 0.001
        if not self.root:
            return
        base = os.path.join(self.root, "libs.ref", libname)
        lef = os.path.join(base, "lef", libname + ".lef")
        gds = os.path.join(base, "gds", libname + ".gds")
        if os.path.isfile(lef):
            self._parse_lef(lef)
        if os.path.isfile(gds):
            self.gds = GdsFile(gds)
            self.gds_dbu_um = self.gds.dbu_um

    def _parse_lef(self, path: str) -> None:
        with open(path, encoding="utf-8", errors="replace") as fh:
            toks = re.findall(r'[^\s;]+|;', fh.read())
        i, n = 0, len(toks)
        cur: Master | None = None
        pin: Pin | None = None
        layer = ""
        in_port = False
        while i < n:
            t = toks[i]
            if t == "MACRO" and i + 1 < n:
                cur = Master(toks[i + 1])
                self.masters[cur.name] = cur
                i += 2
                continue
            if cur is not None:
                if t == "SIZE" and pin is None:
                    cur.width, cur.height = float(toks[i + 1]), float(toks[i + 3])
                    i += 4
                    continue
                if t == "PIN" and i + 1 < n and not in_port:
                    pin = Pin(toks[i + 1])
                    cur.pins[pin.name] = pin
                    i += 2
                    continue
                if pin is not None:
                    if t == "DIRECTION":
                        pin.direction = toks[i + 1]
                        i += 2
                        continue
                    if t == "USE":
                        pin.use = toks[i + 1]
                        i += 2
                        continue
                    if t == "PORT":
                        in_port = True
                    elif t == "LAYER" and in_port:
                        layer = toks[i + 1]
                        i += 2
                        continue
                    elif t == "RECT" and in_port:
                        pin.rects.append((layer, float(toks[i + 1]), float(toks[i + 2]), float(toks[i + 3]), float(toks[i + 4])))
                        i += 5
                        continue
                    elif t == "END" and i + 1 < n:
                        if in_port and toks[i + 1] not in (pin.name,):
                            in_port = False
                        elif toks[i + 1] == pin.name:
                            pin, in_port = None, False
                            i += 2
                            continue
                if t == "END" and i + 1 < n and toks[i + 1] == cur.name:
                    cur, pin, in_port = None, None, False
                    i += 2
                    continue
            i += 1

    # ------------------------------------------------------------------ queries
    def has(self, cell: str) -> bool:
        return cell in self.masters

    def search(self, pattern: str = "", limit: int = 50) -> list[str]:
        pat = pattern.lower()
        out = [m for m in self.masters if pat in m.lower()]
        return sorted(out)[:limit]

    def cell_geometry(self, cell: str) -> dict[str, list]:
        """Layout of a cell as integer database units of the library GDS."""
        if self.gds is None or cell not in self.gds.index:
            return {"polys": [], "paths": [], "texts": [], "srefs": [], "arefs": []}
        return self.gds.read_cell(cell)
