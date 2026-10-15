"""Structural Verilog netlist reader (flat gate-level netlists such as OpenLane's *.nl.v / *.pnl.v).

GDS has no net or pin semantics and no instance names, so connectivity has to come from a netlist that goes with the layout.
This reader covers what synthesis / place-and-route tools emit:
  module / endmodule, input / output / inout [msb:lsb], wire, assign a = b, named port connections .PIN(net),
  escaped identifiers (\\name[3] ), bus bit selects a[3], concatenations {a, b}, constants 1'b0 / 1'b1, (* attributes *), comments.
Hierarchy is flattened (instances of modules defined in the same file get "parent/child" names); instances of unknown modules
are leaf cells. Not supported: parameters, generate, positional port connections of leaf cells (reported as an error).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


class NetlistError(Exception):
    pass


@dataclass
class Module:
    name: str
    ports: list[tuple[str, str, int | None, int | None]] = field(default_factory=list)  # (name, dir, msb, lsb)
    insts: list[tuple[str, str, dict[str, list[str]]]] = field(default_factory=list)  # (inst, cell, pin -> [net bits])
    assigns: list[tuple[list[str], list[str]]] = field(default_factory=list)  # lhs bits, rhs bits


@dataclass
class FlatNetlist:
    top: str
    ports: dict[str, str]  # net bit -> direction
    insts: dict[str, tuple[str, dict[str, str]]]  # inst -> (cell, pin -> net)
    nets: dict[str, list[tuple[str, str]]]  # net -> [(inst, pin)]
    skipped_power: int = 0


_TOK = re.compile(r"""\\\S+\s|[A-Za-z_][A-Za-z0-9_$]*|\d+'[sS]?[bBhHdDoO][0-9a-fA-FxXzZ_]+|\d+|[()\[\]{}.,;:=#@]""")


def _strip(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    text = re.sub(r"\(\*.*?\*\)", " ", text, flags=re.S)
    return text


def _tokens(text: str) -> list[str]:
    toks = []
    for m in _TOK.finditer(_strip(text)):
        t = m.group(0)
        toks.append(t.strip() if t.startswith("\\") else t)
    return toks


class _P:
    def __init__(self, toks: list[str]) -> None:
        self.t, self.i = toks, 0

    def peek(self, k: int = 0) -> str | None:
        return self.t[self.i + k] if self.i + k < len(self.t) else None

    def take(self) -> str:
        if self.i >= len(self.t):
            raise NetlistError("unexpected end of netlist")
        v = self.t[self.i]
        self.i += 1
        return v

    def expect(self, v: str) -> None:
        got = self.take()
        if got != v:
            raise NetlistError(f"expected {v!r} but found {got!r} (token {self.i})")


def _bits(name: str, msb: int | None, lsb: int | None) -> list[str]:
    if msb is None:
        return [name]
    step = 1 if msb >= lsb else -1
    return [f"{name}[{k}]" for k in range(msb, lsb + step, step)]


def _expr(p: _P, buses: dict[str, tuple[int, int]]) -> list[str]:
    """net expression -> list of bit names (msb first)."""
    t = p.take()
    if t == "{":
        out: list[str] = []
        while True:
            out += _expr(p, buses)
            nx = p.take()
            if nx == "}":
                return out
            if nx != ",":
                raise NetlistError(f"bad concatenation near {nx!r}")
    if re.match(r"\d+'", t):
        width = int(t.split("'")[0])
        val = t.split("'")[1][1:].replace("_", "")
        base = {"b": 2, "h": 16, "d": 10, "o": 8}[t.split("'")[1][0].lower()]
        try:
            n = int(val, base)
        except ValueError:
            n = 0
        return [("1'b1" if (n >> k) & 1 else "1'b0") for k in range(width - 1, -1, -1)]
    if re.fullmatch(r"\d+", t):
        return ["1'b1" if int(t) else "1'b0"]
    name = t
    if p.peek() == "[":
        p.take()
        a = int(p.take())
        if p.peek() == ":":
            p.take()
            b = int(p.take())
            p.expect("]")
            return _bits(name, a, b)
        p.expect("]")
        return [f"{name}[{a}]"]
    if name in buses:
        msb, lsb = buses[name]
        return _bits(name, msb, lsb)
    return [name]


def parse(text: str) -> dict[str, Module]:
    p = _P(_tokens(text))
    mods: dict[str, Module] = {}
    while p.peek() is not None:
        t = p.take()
        if t != "module":
            continue
        m = Module(p.take())
        buses: dict[str, tuple[int, int]] = {}
        port_order: list[str] = []
        if p.peek() == "(":
            p.take()
            while p.peek() != ")":
                tk = p.take()
                if tk in ("input", "output", "inout", "wire", "reg"):  # ANSI-style header
                    d = tk
                    msb = lsb = None
                    if p.peek() == "[":
                        p.take(); msb = int(p.take()); p.expect(":"); lsb = int(p.take()); p.expect("]")
                    nm = p.take()
                    if msb is not None:
                        buses[nm] = (msb, lsb)
                    m.ports.append((nm, d, msb, lsb))
                    port_order.append(nm)
                elif tk != ",":
                    port_order.append(tk)
            p.take()
        p.expect(";")
        while p.peek() != "endmodule":
            kw = p.take()
            if kw in ("input", "output", "inout", "wire", "supply0", "supply1", "tri", "reg"):
                msb = lsb = None
                if p.peek() == "[":
                    p.take(); msb = int(p.take()); p.expect(":"); lsb = int(p.take()); p.expect("]")
                while True:
                    nm = p.take()
                    if msb is not None:
                        buses[nm] = (msb, lsb)
                    if kw in ("input", "output", "inout"):
                        m.ports.append((nm, kw, msb, lsb))
                    nx = p.take()
                    if nx == ";":
                        break
                    if nx != ",":
                        raise NetlistError(f"bad declaration near {nx!r}")
            elif kw == "assign":
                lhs = _expr(p, buses)
                p.expect("=")
                rhs = _expr(p, buses)
                p.expect(";")
                m.assigns.append((lhs, rhs))
            else:  # cell instantiation:  cell [#(...)] inst ( .PIN(net), ... );
                cell = kw
                if p.peek() == "#":
                    p.take(); p.expect("(")
                    depth = 1
                    while depth:
                        x = p.take()
                        depth += (x == "(") - (x == ")")
                inst = p.take()
                p.expect("(")
                conns: dict[str, list[str]] = {}
                if p.peek() != ")" and p.peek() != ".":
                    raise NetlistError(f"instance {inst} ({cell}): positional port connections are not supported")
                while p.peek() != ")":
                    if p.peek() == ",":
                        p.take()
                        continue
                    p.expect(".")
                    pin = p.take()
                    p.expect("(")
                    conns[pin] = [] if p.peek() == ")" else _expr(p, buses)
                    p.expect(")")
                p.take()
                p.expect(";")
                m.insts.append((inst, cell, conns))
        p.take()
        mods[m.name] = m
    return mods


def flatten(mods: dict[str, Module], top: str | None = None, power_pins: set[str] | None = None) -> FlatNetlist:
    """Flatten the hierarchy of the top module; assigns become net aliases. power_pins (e.g. VPWR VGND VPB VNB) are dropped."""
    if not mods:
        raise NetlistError("no module found")
    if top is None:
        used = {c for m in mods.values() for _i, c, _k in m.insts}
        cands = [n for n in mods if n not in used]
        top = cands[-1] if cands else list(mods)[-1]
    if top not in mods:
        raise NetlistError(f"top module {top} not found (have: {', '.join(mods)})")
    power_pins = power_pins or set()
    alias: dict[str, str] = {}

    def find(n: str) -> str:
        while n in alias:
            n = alias[n]
        return n

    insts: dict[str, tuple[str, dict[str, str]]] = {}
    ports: dict[str, str] = {}
    skipped = 0

    def walk(mname: str, prefix: str, binding: dict[str, str]) -> None:
        nonlocal skipped
        m = mods[mname]
        local = lambda n: binding.get(n, prefix + n if prefix else n)  # noqa: E731
        for lhs, rhs in m.assigns:
            for a, b in zip(lhs, rhs):
                la, lb = local(a), local(b)
                if la != lb:
                    alias[find(la)] = find(lb)
        for iname, cell, conns in m.insts:
            full = prefix + iname
            if cell in mods:
                sub = mods[cell]
                bind: dict[str, str] = {}
                for pn, d, msb, lsb in sub.ports:
                    sig = conns.get(pn)
                    if sig is None:
                        continue
                    for b, s in zip(_bits(pn, msb, lsb), sig):
                        bind[b] = local(s)
                walk(cell, full + "/", bind)
            else:
                pins: dict[str, str] = {}
                for pin, sig in conns.items():
                    if pin in power_pins:
                        skipped += 1
                        continue
                    if len(sig) == 1:
                        pins[pin] = local(sig[0])
                    elif len(sig) > 1:
                        # sig is msb first; a leaf cell's bus port is taken to be declared [n-1:0], so the first entry is bit n-1
                        for k, s in enumerate(sig):
                            pins[f"{pin}[{len(sig) - 1 - k}]"] = local(s)
                insts[full] = (cell, pins)

    tm = mods[top]
    walk(top, "", {})
    for pn, d, msb, lsb in tm.ports:
        for b in _bits(pn, msb, lsb):
            ports[b] = d
    nets: dict[str, list[tuple[str, str]]] = {}
    out_insts: dict[str, tuple[str, dict[str, str]]] = {}
    for iname, (cell, pins) in insts.items():
        res = {pin: find(n) for pin, n in pins.items()}
        out_insts[iname] = (cell, res)
        for pin, n in res.items():
            nets.setdefault(n, []).append((iname, pin))
    return FlatNetlist(top, {find(k): v for k, v in ports.items()} | {k: v for k, v in ports.items()}, out_insts, nets, skipped)


def load(path: str, top: str | None = None, power_pins: set[str] | None = None) -> FlatNetlist:
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError as exc:
        raise NetlistError(f"cannot read {path}: {exc.strerror}")
    return flatten(parse(text), top, power_pins)
