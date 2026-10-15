"""Netlist-level schematic store and the device masters it can instantiate.

A schematic here is instances with explicit pin->net connections (no wires or geometry). It is the design source for a Maestro
test. Three kinds of design exist:
  * built:     instances of analogLib-style masters (vdc, res, cap, ...), sky130 transistors, generic MOS/BJT, or other schematics
  * spice:     a SPICE subcircuit/netlist text imported as-is (pins = the subcircuit ports)
  * xschem:    a netlist produced from an xschem .sch (xschem -n), then treated like `spice`
Persisted as JSON under <workspace>/maestro/<lib>/<cell>/schematic.json.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from . import units


class SchError(Exception):
    pass


GROUND_NETS = {"0", "gnd!", "gnd", "vss!", "GND!", "GND"}


def pv(v: Any) -> str:
    """A parameter value as it appears in a SPICE deck: numbers stay numbers, anything else is a {expression}."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return repr(float(v))
    s = str(v).strip()
    if units.is_number(s):
        return repr(units.si(s))
    return "{" + s + "}"


@dataclass
class Master:
    lib: str
    name: str
    pins: list[str]
    prefix: str                                   # SPICE device letter, "X" for subcircuit-based
    params: dict[str, str] = field(default_factory=dict)     # name -> default (string)
    build: Callable[[str, list[str], dict[str, str]], list[str]] | None = None
    models: list[str] = field(default_factory=list)          # .model cards this master needs
    doc: str = ""


def _src_line(name, nets, kind, dc, ac_mag, ac_phase, tran):
    s = f"{name} {nets[0]} {nets[1]}"
    if dc is not None:
        s += f" DC {dc}"
    if ac_mag is not None:
        s += f" AC {ac_mag}" + (f" {ac_phase}" if ac_phase is not None else "")
    if tran:
        s += " " + tran
    return [s]


def _vdc(n, c, p):  return _src_line(n, c, "V", pv(p["vdc"]), pv(p["acm"]) if p.get("acm", "") != "" else None, pv(p["acp"]) if p.get("acp", "") != "" else None, "")
def _vsin(n, c, p):
    tran = f"SIN({pv(p['sinedc'])} {pv(p['ampl'])} {pv(p['freq'])} {pv(p['td'])} {pv(p['damp'])} {pv(p['sinephase'])})"
    return _src_line(n, c, "V", pv(p["vdc"]), pv(p["acm"]) if p.get("acm", "") != "" else None, None, tran)
def _vpulse(n, c, p):
    tran = f"PULSE({pv(p['v1'])} {pv(p['v2'])} {pv(p['td'])} {pv(p['tr'])} {pv(p['tf'])} {pv(p['pw'])} {pv(p['per'])})"
    return _src_line(n, c, "V", pv(p["vdc"]), pv(p["acm"]) if p.get("acm", "") != "" else None, None, tran)
def _vpwl(n, c, p):
    pts = " ".join(pv(x) if units.is_number(x) else x for x in re.split(r"[\s,]+", str(p["pwl"]).strip()) if x)
    return _src_line(n, c, "V", pv(p["vdc"]), pv(p["acm"]) if p.get("acm", "") != "" else None, None, f"PWL({pts})")
def _idc(n, c, p):  return _src_line(n, c, "I", pv(p["idc"]), pv(p["acm"]) if p.get("acm", "") != "" else None, None, "")
def _ipulse(n, c, p):
    tran = f"PULSE({pv(p['i1'])} {pv(p['i2'])} {pv(p['td'])} {pv(p['tr'])} {pv(p['tf'])} {pv(p['pw'])} {pv(p['per'])})"
    return _src_line(n, c, "I", pv(p["idc"]), None, None, tran)
def _res(n, c, p):  return [f"{n} {c[0]} {c[1]} {pv(p['r'])}" + (f" tc1={pv(p['tc1'])}" if p.get("tc1", "") != "" else "") + (f" tc2={pv(p['tc2'])}" if p.get("tc2", "") != "" else "")]
def _cap(n, c, p):  return [f"{n} {c[0]} {c[1]} {pv(p['c'])}" + (f" ic={pv(p['ic'])}" if p.get("ic", "") != "" else "")]
def _ind(n, c, p):  return [f"{n} {c[0]} {c[1]} {pv(p['l'])}" + (f" ic={pv(p['ic'])}" if p.get("ic", "") != "" else "")]
def _vcvs(n, c, p): return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} {pv(p['gain'])}"]
def _vccs(n, c, p): return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} {pv(p['gm'])}"]
def _diode(n, c, p): return [f"{n} {c[0]} {c[1]} {p['model']}" + (f" area={pv(p['area'])}" if p.get("area", "") != "" else "")]
def _mos(model):
    def f(n, c, p):
        return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} {model} w={pv(p['w'])} l={pv(p['l'])} m={pv(p['m'])}"]
    return f
def _sky_mos(model):
    def f(n, c, p):
        return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} {model} w={pv(p['w'])} l={pv(p['l'])} nf={pv(p['nf'])} mult={pv(p['m'])}"]
    return f
def _bjt(model):
    def f(n, c, p):
        return [f"{n} {c[0]} {c[1]} {c[2]} {model}" + (f" area={pv(p['area'])}" if p.get("area", "") != "" else "")]
    return f
def _switch(n, c, p): return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} vvsw"]
def _bsrc(n, c, p): return [f"{n} {c[0]} {c[1]} {p['expr_kind']}={{{p['expr']}}}"]
def _opamp(n, c, p):
    # ideal op-amp as a subcircuit instance: IN+ IN- OUT VDD VSS
    return [f"{n} {c[0]} {c[1]} {c[2]} {c[3]} {c[4]} vv_opamp gain={pv(p['gain'])} gbw={pv(p['gbw'])} rout={pv(p['rout'])} vsat_margin={pv(p['vsat_margin'])}"]


OPAMP_SUBCKT = """.subckt vv_opamp inp inn out vdd vss gain=1e5 gbw=1e6 rout=100 vsat_margin=0.1
* single-pole voltage amplifier: pole at gbw/gain, output clamped to the supplies, output resistance rout
Ein_diff n1 0 inp inn {gain}
Rp n1 n2 1k
Cp n2 0 {1/(2*3.14159265*(gbw/gain)*1k)}
Eout n3 0 value={max(min(v(n2), v(vdd)-vsat_margin), v(vss)+vsat_margin)}
Rout n3 out {rout}
.ends vv_opamp"""

MODELS = {
    "d": ".model vvd D(is=1e-14 n=1 rs=10 cjo=1p)",
    "nmos": ".model vvnmos NMOS(level=1 vto=0.5 kp=200u lambda=0.05 gamma=0.4 phi=0.7 cgso=0.3n cgdo=0.3n)",
    "pmos": ".model vvpmos PMOS(level=1 vto=-0.5 kp=80u lambda=0.05 gamma=0.4 phi=0.7 cgso=0.3n cgdo=0.3n)",
    "npn": ".model vvnpn NPN(is=1e-16 bf=100 vaf=100 cje=1p cjc=0.5p tf=0.3n)",
    "pnp": ".model vvpnp PNP(is=1e-16 bf=50 vaf=50 cje=1p cjc=0.5p tf=0.6n)",
    "sw": ".model vvsw SW(vt=0.5 vh=0.1 ron=10 roff=1e9)",
}

_SRC_DEF = {"vdc": "0", "acm": "", "acp": ""}


def _reg() -> dict[tuple[str, str], Master]:
    M: dict[tuple[str, str], Master] = {}

    def add(lib, name, pins, prefix, params=None, build=None, models=None, doc=""):
        M[(lib, name)] = Master(lib, name, pins, prefix, params or {}, build, models or [], doc)

    A = "analogLib"
    add(A, "vdc", ["PLUS", "MINUS"], "V", dict(_SRC_DEF), _vdc, doc="DC voltage source; acm/acp = small-signal magnitude/phase")
    add(A, "vsin", ["PLUS", "MINUS"], "V", dict(vdc="0", acm="", sinedc="0", ampl="1", freq="1k", td="0", damp="0", sinephase="0"), _vsin, doc="sine source")
    add(A, "vpulse", ["PLUS", "MINUS"], "V", dict(vdc="0", acm="", v1="0", v2="1", td="0", tr="1n", tf="1n", pw="10n", per="20n"), _vpulse, doc="pulse source")
    add(A, "vpwl", ["PLUS", "MINUS"], "V", dict(vdc="0", acm="", pwl="0 0 1n 1"), _vpwl, doc="piecewise-linear source: pwl='t0 v0 t1 v1 ...'")
    add(A, "idc", ["PLUS", "MINUS"], "I", dict(idc="0", acm=""), _idc, doc="DC current source (current flows PLUS -> MINUS through the source)")
    add(A, "ipulse", ["PLUS", "MINUS"], "I", dict(idc="0", i1="0", i2="1m", td="0", tr="1n", tf="1n", pw="10n", per="20n"), _ipulse, doc="pulse current source")
    add(A, "res", ["PLUS", "MINUS"], "R", dict(r="1k", tc1="", tc2=""), _res, doc="resistor")
    add(A, "cap", ["PLUS", "MINUS"], "C", dict(c="1p", ic=""), _cap, doc="capacitor")
    add(A, "ind", ["PLUS", "MINUS"], "L", dict(l="1n", ic=""), _ind, doc="inductor")
    add(A, "vcvs", ["NCPLUS", "NCMINUS", "PLUS", "MINUS"], "E", dict(gain="1"), lambda n, c, p: [f"{n} {c[2]} {c[3]} {c[0]} {c[1]} {pv(p['gain'])}"], doc="voltage-controlled voltage source")
    add(A, "vccs", ["NCPLUS", "NCMINUS", "PLUS", "MINUS"], "G", dict(gm="1m"), lambda n, c, p: [f"{n} {c[2]} {c[3]} {c[0]} {c[1]} {pv(p['gm'])}"], doc="voltage-controlled current source")
    add(A, "diode", ["PLUS", "MINUS"], "D", dict(model="vvd", area=""), _diode, [MODELS["d"]], doc="diode (generic model vvd)")
    add(A, "nmos4", ["D", "G", "S", "B"], "M", dict(w="1u", l="0.18u", m="1"), _mos("vvnmos"), [MODELS["nmos"]], doc="generic level-1 NMOS")
    add(A, "pmos4", ["D", "G", "S", "B"], "M", dict(w="2u", l="0.18u", m="1"), _mos("vvpmos"), [MODELS["pmos"]], doc="generic level-1 PMOS")
    add(A, "npn", ["C", "B", "E"], "Q", dict(area=""), _bjt("vvnpn"), [MODELS["npn"]], doc="generic NPN")
    add(A, "pnp", ["C", "B", "E"], "Q", dict(area=""), _bjt("vvpnp"), [MODELS["pnp"]], doc="generic PNP")
    add(A, "switch", ["NCPLUS", "NCMINUS", "PLUS", "MINUS"], "S", {}, lambda n, c, p: [f"{n} {c[2]} {c[3]} {c[0]} {c[1]} vvsw"], [MODELS["sw"]], doc="voltage-controlled switch")
    add(A, "bsrc", ["PLUS", "MINUS"], "B", dict(expr_kind="v", expr="0"), _bsrc, doc="behavioural source: expr_kind v|i, expr in ngspice syntax")
    add(A, "opamp", ["INP", "INN", "OUT", "VDD", "VSS"], "X", dict(gain="1e5", gbw="1e6", rout="100", vsat_margin="0.1"), _opamp, doc="single-pole op-amp (vv_opamp subcircuit)")
    add(A, "gnd", ["gnd!"], "-", {}, None, doc="ground symbol: ties its net to 0")
    S = "sky130_fd_pr"
    for nm, kind in (("nfet_01v8", "n"), ("pfet_01v8", "p"), ("nfet_01v8_lvt", "n"), ("pfet_01v8_lvt", "p"), ("nfet_g5v0d10v5", "n"), ("pfet_g5v0d10v5", "p"),
                     ("nfet_03v3_nvt", "n"), ("pfet_01v8_hvt", "p")):
        add(S, nm, ["D", "G", "S", "B"], "X", dict(w="1", l="0.15", nf="1", m="1"), _sky_mos(f"sky130_fd_pr__{nm}"), doc="sky130 transistor (w, l in um as the sky130 models expect; needs the sky130 ngspice model library)")
    return M


MASTERS = _reg()


def find_master(lib: str, name: str) -> Master | None:
    return MASTERS.get((lib, name))


# ----------------------------------------------------------------------------------------------- schematic
@dataclass
class Inst:
    name: str
    lib: str
    cell: str
    conns: dict[str, str] = field(default_factory=dict)
    params: dict[str, str] = field(default_factory=dict)


@dataclass
class Schematic:
    lib: str
    cell: str
    kind: str = "built"                           # built | spice
    insts: dict[str, Inst] = field(default_factory=dict)
    pins: dict[str, str] = field(default_factory=dict)      # port name -> direction (input/output/inout)
    spice: str = ""                                # for kind == "spice": the netlist text
    top_subckt: str = ""                           # for kind == "spice": subcircuit to instantiate when used as a design
    source: str = ""

    def add_inst(self, name: str, lib: str, cell: str, conns: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> Inst:
        if name in self.insts:
            raise SchError(f"instance {name} already exists in {self.lib}/{self.cell}")
        m = find_master(lib, cell)
        if m is not None:
            bad = [p for p in (conns or {}) if p not in m.pins]
            if bad:
                raise SchError(f"{lib}/{cell} has no pin(s) {', '.join(bad)}; pins are {', '.join(m.pins)}")
            badp = [p for p in (params or {}) if p not in m.params]
            if badp:
                raise SchError(f"{lib}/{cell} has no parameter(s) {', '.join(badp)}; parameters are {', '.join(m.params) or 'none'}")
        inst = Inst(name, lib, cell, {k: str(v) for k, v in (conns or {}).items()}, {k: str(v) for k, v in (params or {}).items()})
        self.insts[name] = inst
        return inst

    def connect(self, inst: str, pin: str, net: str) -> None:
        i = self._inst(inst)
        m = find_master(i.lib, i.cell)
        if m is not None and pin not in m.pins:
            raise SchError(f"{i.lib}/{i.cell} has no pin {pin}; pins are {', '.join(m.pins)}")
        i.conns[pin] = str(net)

    def set_param(self, inst: str, name: str, value: Any) -> None:
        i = self._inst(inst)
        m = find_master(i.lib, i.cell)
        if m is not None and name not in m.params:
            raise SchError(f"{i.lib}/{i.cell} has no parameter {name}; parameters are {', '.join(m.params) or 'none'}")
        i.params[name] = str(value)

    def _inst(self, name: str) -> Inst:
        if name not in self.insts:
            raise SchError(f"no instance {name} in {self.lib}/{self.cell}")
        return self.insts[name]

    def add_pin(self, name: str, direction: str = "inout") -> None:
        if direction not in ("input", "output", "inout"):
            raise SchError("pin direction must be input, output or inout")
        self.pins[str(name)] = direction

    def nets(self) -> list[str]:
        s: set[str] = set()
        for i in self.insts.values():
            s.update(i.conns.values())
        s.update(self.pins)
        return sorted(s)

    def check(self) -> list[str]:
        """Problems that would make the netlist unsimulatable: unconnected pins, nets with a single connection, no ground."""
        out: list[str] = []
        count: dict[str, int] = {}
        for i in self.insts.values():
            m = find_master(i.lib, i.cell)
            if m is None:
                continue
            for p in m.pins:
                if p not in i.conns:
                    out.append(f"{i.name}.{p} is not connected")
                else:
                    count[i.conns[p]] = count.get(i.conns[p], 0) + 1
        for n, c in count.items():
            if c == 1 and n not in self.pins and n not in GROUND_NETS:
                out.append(f"net {n} has a single connection")
        if self.kind == "built" and self.insts and not any(n in GROUND_NETS for n in count):
            out.append("no net is tied to ground (0 / gnd!)")
        return out

    # ---- persistence ----
    def to_json(self) -> dict:
        return {"lib": self.lib, "cell": self.cell, "kind": self.kind, "pins": self.pins, "spice": self.spice, "top_subckt": self.top_subckt, "source": self.source,
                "insts": [{"name": i.name, "lib": i.lib, "cell": i.cell, "conns": i.conns, "params": i.params} for i in self.insts.values()]}

    @staticmethod
    def from_json(d: dict) -> "Schematic":
        s = Schematic(d["lib"], d["cell"], d.get("kind", "built"), pins=dict(d.get("pins", {})), spice=d.get("spice", ""), top_subckt=d.get("top_subckt", ""), source=d.get("source", ""))
        for i in d.get("insts", []):
            s.insts[i["name"]] = Inst(i["name"], i["lib"], i["cell"], dict(i.get("conns", {})), dict(i.get("params", {})))
        return s


class Store:
    """Schematics and Maestro setups live under <root>/<lib>/<cell>/."""

    def __init__(self, root: str) -> None:
        self.root = root

    def cell_dir(self, lib: str, cell: str) -> str:
        for part in (lib, cell):
            if not re.fullmatch(r"[A-Za-z0-9_.$+-]+", part) or part in (".", ".."):
                raise SchError(f"bad library/cell name {part!r}")
        return os.path.join(self.root, lib, cell)

    def path(self, lib: str, cell: str) -> str:
        return os.path.join(self.cell_dir(lib, cell), "schematic.json")

    def exists(self, lib: str, cell: str) -> bool:
        return os.path.isfile(self.path(lib, cell))

    def load(self, lib: str, cell: str) -> Schematic:
        p = self.path(lib, cell)
        if not os.path.isfile(p):
            raise SchError(f"schematic {lib}/{cell} does not exist")
        with open(p, encoding="utf-8") as fh:
            return Schematic.from_json(json.load(fh))

    def save(self, sch: Schematic) -> str:
        d = self.cell_dir(sch.lib, sch.cell)
        os.makedirs(d, exist_ok=True)
        p = self.path(sch.lib, sch.cell)
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(sch.to_json(), fh, indent=1)
        return p

    def cells(self, lib: str | None = None) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        if not os.path.isdir(self.root):
            return out
        for l in sorted(os.listdir(self.root)):
            if lib and l != lib:
                continue
            ld = os.path.join(self.root, l)
            if os.path.isdir(ld):
                for c in sorted(os.listdir(ld)):
                    if os.path.isfile(os.path.join(ld, c, "schematic.json")):
                        out.append((l, c))
        return out

    def delete(self, lib: str, cell: str) -> bool:
        p = self.path(lib, cell)
        if os.path.isfile(p):
            os.remove(p)
            return True
        return False


_SUBCKT = re.compile(r"^\s*\.subckt\s+(\S+)\s+(.*)$", re.I | re.M)


def from_spice(lib: str, cell: str, text: str, top: str | None = None) -> Schematic:
    """Register SPICE text as a design. `top` names the subcircuit to instantiate; default: the last .subckt, or the text itself as a flat netlist."""
    s = Schematic(lib, cell, "spice", spice=text.strip() + "\n", source="spice")
    subs = _SUBCKT.findall(text)
    if top:
        match = [x for x in subs if x[0].lower() == top.lower()]
        if not match:
            raise SchError(f"subcircuit {top} not found; found: {', '.join(x[0] for x in subs) or 'none'}")
        s.top_subckt = match[0][0]
        ports = [t for t in match[0][1].split() if "=" not in t]
    elif subs:
        s.top_subckt = subs[-1][0]
        ports = [t for t in subs[-1][1].split() if "=" not in t]
    else:
        ports = []
    for p in ports:
        s.pins[p] = "inout"
    return s
