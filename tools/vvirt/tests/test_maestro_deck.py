"""Schematic -> SPICE deck -> ngspice on small circuits with closed-form answers (run in WSL: python3 tests/test_maestro_deck.py)."""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.maestro import deck, engine, schematic as S  # noqa: E402
from vvirt.maestro.calc import Calc  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


TD = tempfile.TemporaryDirectory()
STORE = S.Store(os.path.join(TD.name, "mae"))
A = "analogLib"


def rc(cell="rc", c="1p"):
    s = S.Schematic("lib", cell)
    s.add_inst("V0", A, "vdc", {"PLUS": "in", "MINUS": "gnd!"}, {"vdc": "0", "acm": "1"})
    s.add_inst("R0", A, "res", {"PLUS": "in", "MINUS": "OUT"}, {"r": "1k"})
    s.add_inst("C0", A, "cap", {"PLUS": "OUT", "MINUS": "gnd!"}, {"c": c})
    s.add_inst("GND0", A, "gnd", {"gnd!": "gnd!"})
    s.add_pin("OUT", "output")
    STORE.save(s)
    return s


def simulate(spec):
    d = deck.build(spec, STORE)
    r = engine.run(d.text, os.path.join(TD.name, "w"), "t")
    plots = {p.kind(): p for p in r.plots}
    return d, r, plots


rc()
d, r, plots = simulate(deck.PointSpec("lib", "rc", [("ac", {"start": "1", "stop": "10G", "dec": "20"}), ("tran", {"stop": "20n"})]))
check("deck written for ac + tran", d.kinds == ["ac", "tran"] and r.ok, (d.kinds, r.errors, d.text))
c = Calc(plots, default="ac")
f3 = 1 / (2 * math.pi * 1e3 * 1e-12)
bw = c.eval('bandwidth(mag(VF("/OUT")) 3 "low")')
check("RC bandwidth from the built schematic matches 1/(2 pi R C)", bw is not None and abs(bw - f3) / f3 < 0.02, bw)
check("net names are case-insensitive on lookup (/OUT == out)", c.eval('dcGain(VF("/out"))') == c.eval('dcGain(VF("/OUT"))'))
check("device currents are saved (i of the resistor)", "i(@r0[i])" in plots["ac"].data, list(plots["ac"].data))

# design variable in a parameter value, two values
rc("rcv", c="c_val")
res = {}
for val in ("1p", "100f"):
    d, r, plots = simulate(deck.PointSpec("lib", "rcv", [("ac", {"start": "1", "stop": "10G", "dec": "20"})], variables={"c_val": val}))
    res[val] = Calc(plots, default="ac").eval('bandwidth(mag(VF("/OUT")) 3 "low")')
check("variable c_val changes the result 10x", res["1p"] and res["100f"] and abs(res["100f"] / res["1p"] - 10) < 0.3, res)
check("variable appears as a .param card", ".param c_val=" in d.text, d.text)

# expression value
s = S.Schematic("lib", "rcx")
s.add_inst("V0", A, "vdc", {"PLUS": "in", "MINUS": "0"}, {"vdc": "2*vin"})
s.add_inst("R0", A, "res", {"PLUS": "in", "MINUS": "out"}, {"r": "1k"})
s.add_inst("R1", A, "res", {"PLUS": "out", "MINUS": "0"}, {"r": "3k"})
STORE.save(s)
d, r, plots = simulate(deck.PointSpec("lib", "rcx", [("op", {})], variables={"vin": "0.6"}))
check("expression 2*vin and divider: out = 1.2 * 3/4 = 0.9 V", abs(Calc(plots, default="op").eval('v("/out")') - 0.9) < 1e-6, Calc(plots, default="op").eval('v("/out")'))

# dc sweep of a source: divider output follows 3/4 * v
s.insts["V0"].params["vdc"] = "0"
STORE.save(s)
d, r, plots = simulate(deck.PointSpec("lib", "rcx", [("dc", {"comp": "V0", "start": "0", "stop": "2", "step": "0.5"})]))
w = Calc(plots, default="dc").eval('VDC("/out")')
check("dc sweep: 5 points, last = 1.5 V", len(w.x) == 5 and abs(w.y[-1] - 1.5) < 1e-6, (len(w.x), w.y))

# hierarchy: a divider cell used twice in series
h = S.Schematic("lib", "div")
h.add_inst("R0", A, "res", {"PLUS": "IN", "MINUS": "MID"}, {"r": "500"})
h.add_inst("R2", A, "res", {"PLUS": "MID", "MINUS": "OUT"}, {"r": "500"})
h.add_inst("R1", A, "res", {"PLUS": "OUT", "MINUS": "0"}, {"r": "1k"})
h.add_pin("IN", "input")
h.add_pin("OUT", "output")
STORE.save(h)
t = S.Schematic("lib", "two")
t.add_inst("V0", A, "vdc", {"PLUS": "a", "MINUS": "0"}, {"vdc": "1"})
t.add_inst("X1", "lib", "div", {"IN": "a", "OUT": "b"})
t.add_inst("X2", "lib", "div", {"IN": "b", "OUT": "c"})
STORE.save(t)
d, r, plots = simulate(deck.PointSpec("lib", "two", [("op", {})]))
check("hierarchy flattens: subckt defined once, used twice", d.text.count(".subckt") == 1 and d.text.count("lib_div") >= 3, d.text)
cc = Calc(plots, default="op")
check("hierarchy result: b = 1 * (1k||2k) / (1k + 1k||2k) = 0.4 V", r.ok and abs(cc.eval('v("/b")') - 0.4) < 1e-6, (r.errors, r.log[-300:]))
check("internal node of an instance is probeable: /X1/MID = 1 - 0.5k * 0.6 mA = 0.7 V", abs(cc.eval('v("/X1/MID")') - 0.7) < 1e-6, cc.eval('v("/X1/MID")'))

# SPICE import with a subcircuit and parameters
sp = S.from_spice("lib", "amp", ".subckt amp in out gain=2\nE1 out 0 in 0 {gain}\n.ends amp\n")
STORE.save(sp)
check("spice import finds subckt ports", sp.top_subckt == "amp" and list(sp.pins) == ["in", "out"], (sp.top_subckt, sp.pins))
u = S.Schematic("lib", "useamp")
u.add_inst("V0", A, "vdc", {"PLUS": "i", "MINUS": "0"}, {"vdc": "0.5"})
u.add_inst("X1", "lib", "amp", {"in": "i", "out": "o"}, {"gain": "4"})
STORE.save(u)
d, r, plots = simulate(deck.PointSpec("lib", "useamp", [("op", {})]))
check("spice subckt with instance parameter: 0.5 * 4 = 2 V", r.ok and abs(Calc(plots, default="op").eval('v("/o")') - 2.0) < 1e-6, (r.errors, d.text[-400:]))

# sky130 transistors: a CMOS inverter at vin = 0 and vin = 1.8 (needs the PDK ngspice models)
if deck.sky130_lib_path():
    inv = S.Schematic("lib", "inv")
    inv.add_inst("VDD", A, "vdc", {"PLUS": "vdd", "MINUS": "0"}, {"vdc": "1.8"})
    inv.add_inst("VIN", A, "vdc", {"PLUS": "in", "MINUS": "0"}, {"vdc": "vin"})
    inv.add_inst("MN", "sky130_fd_pr", "nfet_01v8", {"D": "out", "G": "in", "S": "0", "B": "0"}, {"w": "1", "l": "0.15"})
    inv.add_inst("MP", "sky130_fd_pr", "pfet_01v8", {"D": "out", "G": "in", "S": "vdd", "B": "vdd"}, {"w": "2", "l": "0.15"})
    STORE.save(inv)
    outs = {}
    for vin in ("0", "1.8"):
        d, r, plots = simulate(deck.PointSpec("lib", "inv", [("op", {})], variables={"vin": vin}))
        outs[vin] = Calc(plots, default="op").eval('v("/out")') if r.ok else None
    check("sky130 inverter: out ~ 1.8 V for in = 0, ~ 0 V for in = 1.8", outs["0"] and outs["0"] > 1.75 and outs["1.8"] is not None and outs["1.8"] < 0.05, (outs, r.errors))
    check("sky130 library auto-added with default corner tt", ".lib" in d.text and " tt" in d.text and d.models_from_sky130, d.text[:400])
    d2 = deck.build(deck.PointSpec("lib", "inv", [("op", {})], variables={"vin": "0"}, model_files=[(deck.sky130_lib_path(), "ss")], temperature=125), STORE)
    check("corner: model section and temperature are written", " ss" in d2.text and ".temp 125" in d2.text)
else:
    print("skip sky130 (PDK ngspice models not found)")

# generic MOS + opamp master
g = S.Schematic("lib", "gen")
g.add_inst("V0", A, "vdc", {"PLUS": "p", "MINUS": "0"}, {"vdc": "0.1"})
g.add_inst("OA", A, "opamp", {"INP": "p", "INN": "n", "OUT": "o", "VDD": "vp", "VSS": "vm"}, {"gain": "1e4"})
g.add_inst("VP", A, "vdc", {"PLUS": "vp", "MINUS": "0"}, {"vdc": "2"})
g.add_inst("VM", A, "vdc", {"PLUS": "vm", "MINUS": "0"}, {"vdc": "-2"})
g.add_inst("RF", A, "res", {"PLUS": "o", "MINUS": "n"}, {"r": "9k"})
g.add_inst("RG", A, "res", {"PLUS": "n", "MINUS": "0"}, {"r": "1k"})
STORE.save(g)
d, r, plots = simulate(deck.PointSpec("lib", "gen", [("op", {})]))
check("op-amp master as non-inverting amplifier: gain 10 -> 1.0 V", r.ok and abs(Calc(plots, default="op").eval('v("/o")') - 1.0) < 0.01, (r.errors, r.log[-300:]))

# noise and tf
d, r, plots = simulate(deck.PointSpec("lib", "rc", [("noise", {"output": "/OUT", "input": "V0", "start": "1", "stop": "1G", "dec": "10"})]))
cn = Calc(plots, default="noise")
check("noise: integrated output noise of R-C is sqrt(kT/C) = 64 uV", r.ok and abs(cn.eval("onoise_total()") - math.sqrt(1.380649e-23 * 300.15 / 1e-12)) / 64e-6 < 0.1, (r.errors, cn.eval("onoise_total()")))
d, r, plots = simulate(deck.PointSpec("lib", "rcx", [("tf", {"output": "/out", "input": "V0"})]))
check("tf analysis runs", r.ok, r.errors)

# errors
for name, mk, why in (("unconnected pin", lambda: (lambda x: (x.insts["R0"].conns.pop("MINUS"), STORE.save(x), deck.build(deck.PointSpec("lib", "rc2", [("op", {})]), STORE)))(rc("rc2")), "is not connected"),
                      ("unsupported analysis", lambda: deck.build(deck.PointSpec("lib", "rc", [("pss", {})]), STORE), "not supported"),
                      ("missing design", lambda: deck.build(deck.PointSpec("lib", "nosuch", [("op", {})]), STORE), "does not exist"),
                      ("no analysis", lambda: deck.build(deck.PointSpec("lib", "rc", []), STORE), "no analysis"),
                      ("bad variable name", lambda: deck.build(deck.PointSpec("lib", "rc", [("op", {})], variables={"a b": "1"}), STORE), "valid identifier"),
                      ("params on a built subcell", lambda: (lambda x: (x.insts["X1"].params.update({"k": "1"}), STORE.save(x), deck.build(deck.PointSpec("lib", "two", [("op", {})]), STORE)))(STORE.load("lib", "two")), "design variables")):
    try:
        mk()
        check("error: " + name, False, "no error")
    except (deck.DeckError, S.SchError) as exc:
        check("error: " + name, why in str(exc), str(exc))
try:
    S.Schematic("l", "c").add_inst("R", A, "res", {"BAD": "x"})
    check("pin name is validated against the master", False)
except S.SchError as exc:
    check("pin name is validated against the master", "no pin" in str(exc), str(exc))
check("schematic check finds problems", any("single connection" in m for m in (lambda x: (x.add_inst("R9", A, "res", {"PLUS": "a", "MINUS": "b"}), x.check())[1])(S.Schematic("l", "c2"))))
try:
    STORE.cell_dir("../x", "y")
    check("path traversal in names rejected", False)
except S.SchError:
    check("path traversal in names rejected", True)

print(f"{fails} failed")
sys.exit(1 if fails else 0)
