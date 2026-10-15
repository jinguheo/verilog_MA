"""pnr_est (placement estimate) and netlist reader on small synthetic inputs (run: python3 tests/test_pnr_est.py)."""
import os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt import pnr_est, netlist

fails = 0
def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))

# core 20..120 x 20..120 um, rows of 0.46 site / 2.72 row; a 40x40 macro; a tap row; two stacked std cells
TAP, INV = "sky130_fd_sc_hd__tapvpwrvgnd_1", "sky130_fd_sc_hd__inv_1"
SIZES = {"MAC": (40.0, 40.0), TAP: (0.46, 2.72), INV: (1.38, 2.72)}
def def_text(macro_x, extra="", left_taps=True):
    rows = "".join(f"ROW r{i} unithd 20000 {20000 + i * 2720} N DO 217 BY 1 STEP 460 0 ;\n" for i in range(36))
    comps = [f"- m MAC + PLACED ( {int(round(macro_x * 1000))} 49920 ) N ;"]
    comps += [f"- t{i}_{k} {TAP} + PLACED ( {20000 + k * 13800} {20000 + i * 2720} ) N ;" for i in range(36) for k in range(7) if (20000 + k * 13800 < macro_x * 1000 - 500 or 20000 + k * 13800 > macro_x * 1000 + 40500) and (left_taps or 20000 + k * 13800 > macro_x * 1000)]
    # filler cells give every row point something to be "covered" (a tap-less row of real cells)
    comps += [f"- f{i}_{k} {INV} + PLACED ( {20000 + k * 1380} {20000 + i * 2720} ) N ;" for i in range(36) for k in range(1, 28) if 20000 + k * 1380 < macro_x * 1000 - 2000 and all(abs(20000 + k * 1380 - 20000 - j * 13800) > 1500 for j in range(7)) and not (i == 0 and 20000 + k * 1380 > 55000)]
    comps += [f"- a {INV} + PLACED ( 60260 20000 ) N ;"]
    return ("VERSION 5.8 ;\nDESIGN t ;\nUNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 140000 140000 ) ;\n" + rows +
            f"COMPONENTS {len(comps)} ;\n" + "\n".join(comps) + extra + "\nEND COMPONENTS\nEND DESIGN\n")

def run(text):
    p = os.path.join(tempfile.mkdtemp(), "t.def")
    open(p, "w").write(text)
    d = pnr_est.read_def(p)
    est = pnr_est.estimate(d, SIZES)
    return d, est, pnr_est.suggest_eco(d, SIZES, est)

d, est, eco = run(def_text(60.02))
check("components read", est["stats"]["components"] == len(d.comps) and "m" in d.comps, est["stats"]["components"])
check("legal placement has no overlaps", est["stats"]["overlaps"] == 0, est["stats"]["overlaps"])

d, est, eco = run(def_text(60.02, f"\n- b {INV} + PLACED ( 60260 20000 ) N ;"))
check("duplicate cell position reported as overlap", est["stats"]["overlaps"] >= 1, est["stats"]["overlaps"])

# a wide tap-less sliver (x 20..48) between the core edge and the macro at x=60 -> far from taps -> move the macro left
d, est, eco = run(def_text(60.02, left_taps=False))
check("tap-less sliver found", est["stats"]["tap_far_rows"] > 0, est["stats"])
mv = [e for e in eco if e["op"] == "move_macro"]
check("suggests moving the macro left, nothing is applied", len(mv) == 1 and mv[0]["dx"] < 0 and d.comps["m"].x == 60.02, eco)

# netlist reader
nl = netlist.flatten(netlist.parse("""
module sub(input a, output y); INV u(.A(a), .Y(y)); endmodule
module top(input [1:0] i, output o);
  wire n; sub s0(.a(i[0]), .y(n)); sub s1(.a(n), .y(o)); assign x = i[1];
endmodule"""), "top")
check("netlist flattened with hierarchy names", sorted(nl.insts) == ["s0/u", "s1/u"], sorted(nl.insts))
check("net shared between the two inverters", any({i for i, _p in v} == {"s0/u", "s1/u"} for v in nl.nets.values()), nl.nets)

# route check: PDK spacing comes from the tech LEF layer, two nets 0.10 um apart on met1 (rule 0.14) must be flagged, 0.20 must not
from vvirt import route_check, def_export
from vvirt.techlef import TechLayer
LAYERS = {"met1": TechLayer("met1", type="ROUTING", width=0.14, spacing=0.14)}
def routed(gap):
    dd = pnr_est.Design()
    n1, n2 = pnr_est.Net("a"), pnr_est.Net("b")
    n1.segs.append(("met1", 0.0, 0.0, 10.0, 0.0))
    n2.segs.append(("met1", 0.0, 0.14 + gap, 10.0, 0.14 + gap))
    dd.nets = {"a": n1, "b": n2}
    return dd
check("spacing violation flagged", route_check.check(routed(0.10), LAYERS, {}, def_export.def_via_shapes)["counts"]["spacing"] == 1)
check("legal spacing is clean", route_check.check(routed(0.20), LAYERS, {}, def_export.def_via_shapes)["counts"] == {"short": 0, "spacing": 0})
check("overlap is a short", route_check.check(routed(-0.10), LAYERS, {}, def_export.def_via_shapes)["counts"]["short"] == 1)

# DEF -> Virtuoso: origin of the cell for every orientation, generated via geometry
for o, exp in (("N", (5, 7)), ("FS", (5, 7 + 2.72)), ("FN", (5 + 1.38, 7)), ("S", (5 + 1.38, 7 + 2.72))):
    got = def_export.origin_for(5, 7, 1.38, 2.72, o)
    check(f"origin for {o}", abs(got[0] - exp[0]) < 1e-9 and abs(got[1] - exp[1]) < 1e-9, got)
v = def_export.def_via_shapes({"layers": ["met1", "via", "met2"], "cut": [0.15, 0.15], "space": [0.17, 0.17], "enc": [0.085, 0.165, 0.055, 0.085], "rowcol": [1, 5], "rects": []})
check("generated via has 5 cuts + 2 metals", len(v) == 7 and sum(1 for r in v if r[0] == "via") == 5, v)
print(f"{fails} failed")
sys.exit(1 if fails else 0)
