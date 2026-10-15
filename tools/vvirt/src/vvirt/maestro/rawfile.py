"""Reader for ngspice rawfiles (binary and ASCII, several plots per file)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


class RawError(Exception):
    pass


@dataclass
class Plot:
    name: str                                  # e.g. "AC Analysis", "Transient Analysis"
    title: str = ""
    complex: bool = False
    names: list[str] = field(default_factory=list)      # variable names in file order (lower case, e.g. "v(out)")
    types: list[str] = field(default_factory=list)      # "voltage", "current", "time", "frequency", ...
    data: dict[str, np.ndarray] = field(default_factory=dict)
    points: int = 0

    @property
    def x_name(self) -> str:
        return self.names[0] if self.names else ""

    def kind(self) -> str:
        """Analysis kind from the plot name: dc, ac, tran, noise, op, tf, sens, pz, disto, other."""
        n = self.name.lower()
        for key, kind in (("operating point", "op"), ("transient", "tran"), ("ac analysis", "ac"), ("dc transfer", "dc"), ("noise spectral", "noise"),
                          ("integrated noise", "noise_int"), ("transfer function", "tf"), ("sensitivity", "sens"), ("pole-zero", "pz"), ("distortion", "disto")):
            if key in n:
                return kind
        return "other"


def parse(blob: bytes) -> list[Plot]:
    plots: list[Plot] = []
    pos, n = 0, len(blob)
    while pos < n:
        # header: lines until "Binary:" or "Values:"
        end = pos
        header: list[str] = []
        mode = None
        while end < n:
            nl = blob.find(b"\n", end)
            if nl < 0:
                raise RawError("truncated header")
            line = blob[end:nl].decode("ascii", "replace").rstrip("\r")
            end = nl + 1
            if line.startswith("Binary:"):
                mode = "binary"
                break
            if line.startswith("Values:"):
                mode = "ascii"
                break
            header.append(line)
        if mode is None:
            break
        p = Plot("")
        nvars = 0
        in_vars = False
        for line in header:
            if in_vars and line.startswith("\t"):
                parts = line.split()
                p.names.append(parts[1].lower())
                p.types.append(parts[2] if len(parts) > 2 else "")
                continue
            in_vars = False
            if line.startswith("Title:"):
                p.title = line[6:].strip()
            elif line.startswith("Plotname:"):
                p.name = line[9:].strip()
            elif line.startswith("Flags:"):
                p.complex = "complex" in line
            elif line.startswith("No. Variables:"):
                nvars = int(line.split(":")[1])
            elif line.startswith("No. Points:"):
                p.points = int(line.split(":")[1])
            elif line.startswith("Variables:"):
                in_vars = True
        if nvars != len(p.names):
            raise RawError(f"plot {p.name!r}: {len(p.names)} variables listed, {nvars} declared")
        per = nvars * (2 if p.complex else 1)
        if mode == "binary":
            size = p.points * per * 8
            if end + size > n:
                raise RawError(f"plot {p.name!r}: binary block truncated")
            arr = np.frombuffer(blob, dtype="<f8", count=p.points * per, offset=end).reshape(p.points, per)
            pos = end + size
            for k, nm in enumerate(p.names):
                p.data[nm] = (arr[:, 2 * k] + 1j * arr[:, 2 * k + 1]) if p.complex else arr[:, k].copy()
        else:
            text = blob[end:].decode("ascii", "replace")
            toks = text.replace(",", " ").split()
            cols = [[] for _ in range(nvars)]
            i = 0
            consumed = 0
            for _pt in range(p.points):
                i += 1  # point index
                for v in range(nvars):
                    t = toks[i]
                    i += 1
                    if p.complex:
                        re_, im = t, toks[i]
                        i += 1
                        cols[v].append(complex(float(re_), float(im)))
                    else:
                        cols[v].append(float(t))
                    consumed = i
            for k, nm in enumerate(p.names):
                p.data[nm] = np.array(cols[k], dtype=complex if p.complex else float)
            # rest of the file after the consumed tokens: find where the next "Title:" begins
            nxt = text.find("\nTitle:", 0)
            pos = n if nxt < 0 else end + nxt + 1
        plots.append(p)
    return plots


def load(path: str) -> list[Plot]:
    with open(path, "rb") as fh:
        return parse(fh.read())
