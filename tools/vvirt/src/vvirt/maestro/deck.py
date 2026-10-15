"""Turn a schematic + one resolved simulation point (variables, corner, analyses) into an ngspice deck."""
from __future__ import annotations

import glob
import os
import re
from dataclasses import dataclass, field
from typing import Any

from . import units
from .schematic import GROUND_NETS, OPAMP_SUBCKT, Schematic, SchError, Store, find_master, pv


class DeckError(Exception):
    pass


ANALYSES = ("tran", "ac", "dc", "op", "noise", "tf")


def netname(name: str) -> str:
    """Schematic net / probe name -> the name ngspice reports: "/OUT" -> "out", "/X1/OUT" -> "x1.out", "d<3>" -> "d_3_"."""
    s = str(name).strip()
    s = s[1:] if s.startswith("/") else s
    s = s.replace("/", ".")
    s = re.sub(r"[^A-Za-z0-9_.$#]", "_", s)
    return s.lower()


def deck_net(name: str) -> str:
    return "0" if str(name) in GROUND_NETS else netname(name)


def spice_inst_name(prefix: str, name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_.$#]", "_", str(name))
    return s if s[:1].upper() == prefix.upper() else f"{prefix}_{s}"


def sky130_lib_path() -> str | None:
    env = os.environ.get("VVIRT_SKY130_LIB")
    if env and os.path.isfile(env):
        return env
    roots = [os.environ.get("PDK_ROOT"), os.path.expanduser("~/.volare")]
    for r in roots:
        if not r:
            continue
        hits = glob.glob(os.path.join(r, "**", "sky130A", "libs.tech", "ngspice", "sky130.lib.spice"), recursive=True)
        if hits:
            return sorted(hits)[0]
    return None


@dataclass
class PointSpec:
    lib: str
    cell: str
    analyses: list[tuple[str, dict[str, str]]]
    variables: dict[str, str] = field(default_factory=dict)
    temperature: float | None = None
    model_files: list[tuple[str, str]] = field(default_factory=list)      # (path, section)
    sim_options: dict[str, str] = field(default_factory=dict)
    includes: list[str] = field(default_factory=list)
    title: str = ""
    initial: dict[str, str] = field(default_factory=dict)                 # net -> .ic value
    extra_lines: list[str] = field(default_factory=list)


@dataclass
class Deck:
    text: str
    kinds: list[str]                      # analyses written, in order
    notes: list[str] = field(default_factory=list)
    models_from_sky130: bool = False


def _truthy(v: Any) -> bool:
    return str(v).strip().lower() in ("t", "true", "1", "yes", "on")


def _ac_card(o: dict[str, str]) -> str:
    start, stop = o.get("start", "1"), o.get("stop")
    if stop is None:
        raise DeckError("ac analysis needs a stop frequency")
    kind = str(o.get("incrType", "Logarithmic")).lower()
    if kind.startswith("lin"):
        n = o.get("lin", o.get("steps", "101"))
        return f".ac lin {int(units.si(n))} {pv(start)} {pv(stop)}"
    per = "oct" if "octave" in str(o.get("stepTypeLog", "")).lower() or "oct" in o else "dec"
    n = o.get(per, o.get("dec", "10"))
    return f".ac {per} {int(units.si(n))} {pv(start)} {pv(stop)}"


def _tran_card(o: dict[str, str]) -> str:
    stop = o.get("stop")
    if stop is None:
        raise DeckError("tran analysis needs a stop time")
    stop_v = units.si(stop)
    step = o.get("step") or repr(stop_v / 1000.0)
    start = o.get("start", "0")
    card = f".tran {pv(step)} {pv(stop)} {pv(start)}"
    if o.get("maxstep"):
        card += f" {pv(o['maxstep'])}"
    if _truthy(o.get("uic", "")):
        card += " uic"
    return card


def _dc_card(o: dict[str, str], sch: Schematic) -> tuple[str, str]:
    sweep = o.get("comp") or o.get("sweep") or o.get("dev") or o.get("source")
    if not sweep and not o.get("temp"):
        return ".op", "op"
    start, stop = o.get("start"), o.get("stop")
    step = o.get("step")
    if sweep is None:
        sweep = "temp"
    if start is None or stop is None:
        raise DeckError("dc sweep needs start and stop")
    if step is None:
        step = repr((units.si(stop) - units.si(start)) / 100.0)
    if sweep.lower() == "temp":
        return f".dc temp {pv(start)} {pv(stop)} {pv(step)}", "dc"
    inst = sch.insts.get(sweep)
    if inst is None:
        raise DeckError(f"dc sweep source {sweep!r} is not an instance of {sch.lib}/{sch.cell}")
    m = find_master(inst.lib, inst.cell)
    if m is None or m.prefix not in ("V", "I", "R"):
        raise DeckError(f"dc sweep needs a source or resistor, {sweep} is {inst.lib}/{inst.cell}")
    return f".dc {spice_inst_name(m.prefix, sweep)} {pv(start)} {pv(stop)} {pv(step)}", "dc"


def _source_name(sch: Schematic, name: str, what: str) -> str:
    inst = sch.insts.get(name)
    if inst is None:
        raise DeckError(f"{what} source {name!r} is not an instance of {sch.lib}/{sch.cell}")
    m = find_master(inst.lib, inst.cell)
    if m is None or m.prefix not in ("V", "I"):
        raise DeckError(f"{what} {name} must be a voltage or current source")
    return spice_inst_name(m.prefix, name)


def _noise_card(o: dict[str, str], sch: Schematic) -> str:
    out = o.get("output") or o.get("outputNode")
    src = o.get("input") or o.get("inputSource") or o.get("inputSrc")
    if not out or not src:
        raise DeckError('noise analysis needs "output" (a net such as "/OUT") and "input" (a source instance name)')
    ref = o.get("ref") or o.get("outputRef")
    node = f"v({deck_net(out)}{',' + deck_net(ref) if ref else ''})"
    start, stop = o.get("start", "1"), o.get("stop")
    if stop is None:
        raise DeckError("noise analysis needs a stop frequency")
    pts = int(units.si(o.get("dec", "10")))
    return f".noise {node} {_source_name(sch, src, 'noise input')} dec {pts} {pv(start)} {pv(stop)}"


def _tf_card(o: dict[str, str], sch: Schematic) -> str:
    out = o.get("output") or o.get("outputNode")
    src = o.get("input") or o.get("inputSource") or o.get("inputSrc")
    if not out or not src:
        raise DeckError('tf analysis needs "output" and "input"')
    return f".tf v({deck_net(out)}) {_source_name(sch, src, 'tf input')}"


def _emit_inst(inst, sch: Schematic, store: Store, used: dict, lines: list[str], models: set[str], flags: dict, prefix: str = "") -> None:
    m = find_master(inst.lib, inst.cell)
    if m is not None:
        if m.build is None:       # gnd symbol
            return
        nets = []
        for p in m.pins:
            if p not in inst.conns:
                raise DeckError(f"{sch.lib}/{sch.cell}: {inst.name}.{p} is not connected")
            nets.append(deck_net(inst.conns[p]))
        params = dict(m.params)
        params.update(inst.params)
        name = spice_inst_name(m.prefix, inst.name)
        lines.extend(m.build(name, nets, params))
        models.update(m.models)
        if m.name == "opamp":
            flags["opamp"] = True
        if m.lib == "sky130_fd_pr":
            flags["sky130"] = True
        return
    sub = store.load(inst.lib, inst.cell) if store.exists(inst.lib, inst.cell) else None
    if sub is None:
        raise DeckError(f"{sch.lib}/{sch.cell}: instance {inst.name} refers to {inst.lib}/{inst.cell}, which is neither a device master nor a schematic")
    key = (inst.lib, inst.cell)
    if key not in used:
        used[key] = None
        used[key] = _subckt_text(sub, store, used, models, flags)
    if inst.params and sub.kind == "built":
        raise DeckError(f"{sch.lib}/{sch.cell}: instance {inst.name} passes parameters to the schematic {inst.lib}/{inst.cell}; use design variables instead (only SPICE subcircuits take instance parameters)")
    ports = list(sub.pins)
    for p in ports:
        if p not in inst.conns:
            raise DeckError(f"{sch.lib}/{sch.cell}: {inst.name}.{p} is not connected")
    name = spice_inst_name("X", inst.name)
    par = " ".join(f"{k}={pv(v)}" for k, v in inst.params.items())
    sub_name = sub.top_subckt if sub.kind == "spice" and sub.top_subckt else _sub_name(sub)
    lines.append(f"{name} {' '.join(deck_net(inst.conns[p]) for p in ports)} {sub_name}" + (f" {par}" if par else ""))


def _sub_name(sch: Schematic) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", f"{sch.lib}_{sch.cell}").lower()


def _subckt_text(sch: Schematic, store: Store, used: dict, models: set[str], flags: dict) -> str:
    if sch.kind == "spice":
        return sch.spice
    body: list[str] = []
    for inst in sch.insts.values():
        _emit_inst(inst, sch, store, used, body, models, flags)
    ports = " ".join(deck_net(p) for p in sch.pins)
    name = _sub_name(sch)
    return f".subckt {name} {ports}\n" + "\n".join(body) + f"\n.ends {name}"


def build(spec: PointSpec, store: Store) -> Deck:
    try:
        top = store.load(spec.lib, spec.cell)
    except SchError as exc:
        raise DeckError(str(exc)) from exc
    notes: list[str] = []
    lines: list[str] = [f"* {spec.title or spec.lib + '/' + spec.cell}"]
    for k, v in spec.variables.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
            raise DeckError(f"design variable name {k!r} is not a valid identifier")
        lines.append(f".param {k.lower()}={pv(v)}")
    if spec.sim_options:
        lines.append(".options " + " ".join(f"{k}={v}" if str(v) != "" else str(k) for k, v in spec.sim_options.items()))
    lines.append(".options savecurrents")
    if spec.temperature is not None:
        lines.append(f".temp {spec.temperature:g}")

    used: dict[tuple[str, str], str | None] = {}
    models: set[str] = set()
    flags: dict[str, bool] = {}
    body: list[str] = []
    if top.kind == "spice" and not top.top_subckt:
        body.append(top.spice.strip())
    elif top.kind == "spice":
        body.append(top.spice.strip())
        body.append(f"X_top {' '.join(deck_net(p) for p in top.pins)} {top.top_subckt}")
    else:
        for inst in top.insts.values():
            _emit_inst(inst, top, store, used, body, models, flags)

    mf = list(spec.model_files)
    sky = False
    if flags.get("sky130") and not any("sky130" in os.path.basename(p) for p, _s in mf):
        p = sky130_lib_path()
        if p is None:
            raise DeckError("the design uses sky130 transistors but the sky130 ngspice model library was not found (set VVIRT_SKY130_LIB)")
        mf.append((p, "tt"))
        notes.append("sky130 models: default corner tt (no model file configured)")
    for path, section in mf:
        if not os.path.isfile(path):
            raise DeckError(f"model file not found: {path}")
        sky = sky or "sky130" in os.path.basename(path)
        lines.append(f'.lib "{path}" {section}' if section else f'.include "{path}"')
    for inc in spec.includes:
        if not os.path.isfile(inc):
            raise DeckError(f"include file not found: {inc}")
        lines.append(f'.include "{inc}"')
    lines.extend(sorted(models))
    if flags.get("opamp"):
        lines.append(OPAMP_SUBCKT)
    for t in used.values():
        if t:
            lines.append(t)
    lines.extend(body)
    for net, val in spec.initial.items():
        lines.append(f".ic v({deck_net(net)})={pv(val)}")
    lines.extend(spec.extra_lines)

    kinds: list[str] = []
    for kind, opts in spec.analyses:
        kind = kind.lower()
        if kind == "tran":
            lines.append(_tran_card(opts))
        elif kind == "ac":
            lines.append(_ac_card(opts))
        elif kind in ("dc", "dcop", "op"):
            card, k2 = (_dc_card(opts, top) if kind == "dc" else (".op", "op"))
            lines.append(card)
            kind = k2
        elif kind == "noise":
            lines.append(_noise_card(opts, top))
        elif kind == "tf":
            lines.append(_tf_card(opts, top))
        else:
            raise DeckError(f"analysis {kind!r} is not supported (supported: {', '.join(ANALYSES)}; not supported: pss, pnoise, pz, sens, disto, stb, montecarlo as an analysis - use the Monte Carlo run mode)")
        kinds.append(kind)
    if not kinds:
        raise DeckError("no analysis is enabled")
    lines.append(".end")
    return Deck("\n".join(lines) + "\n", kinds, notes, sky)
