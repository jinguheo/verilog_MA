"""Maestro setup -> points -> parallel ngspice -> outputs/specs -> history (run in WSL: python3 tests/test_maestro_runner.py)."""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.maestro import results as R, runner, schematic as S  # noqa: E402
from vvirt.maestro.setup import Setup, SetupError, SetupStore  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


TD = tempfile.TemporaryDirectory()
ROOT = os.path.join(TD.name, "mae")
SCH = S.Store(ROOT)
SETS = SetupStore(ROOT)
HIST = R.HistoryStore(SETS.results_dir("lib", "tb"))
A = "analogLib"

s = S.Schematic("lib", "tb")
s.add_inst("V0", A, "vdc", {"PLUS": "in", "MINUS": "gnd!"}, {"vdc": "0", "acm": "1"})
s.add_inst("R0", A, "res", {"PLUS": "in", "MINUS": "OUT"}, {"r": "r_val"})
s.add_inst("C0", A, "cap", {"PLUS": "OUT", "MINUS": "gnd!"}, {"c": "c_val"})
s.add_pin("OUT", "output")
SCH.save(s)


def make() -> Setup:
    st = Setup("lib", "tb")
    st.create_test("AC")
    st.set_analysis("AC", "ac", True, {"start": "1", "stop": "10G", "incrType": "Logarithmic", "stepTypeLog": "Points Per Decade", "dec": "20"})
    st.add_output("Vout", "AC", "net", signal="/OUT")
    st.add_output("BW", "AC", "point", expr='bandwidth(mag(VF("/OUT")) 3 "low")')
    st.set_spec("BW", "AC", gt="1G")
    st.set_var("r_val", "1k")
    st.set_var("c_val", "1p,100f")
    return st


# ---- planning
st = make()
pl = runner.plan(st)
check("two sweep points for c_val = 1p,100f", [p.vars["c_val"] for p in pl] == ["1p", "100f"] and all(p.corner is None for p in pl), [(p.id, p.vars) for p in pl])
st.set_var("r_val", "1k,2k")
check("two sweep variables multiply (2 x 2 = 4)", len(runner.plan(st)) == 4)
st.set_var("r_val", "1k")
st.set_corner("hot")
st.set_corner("cold")
st.set_var("temperature", "125", "corner", "hot")
st.set_var("temperature", "-40", "corner", "cold")
check("two corners x two sweep points = 4", len(runner.plan(st)) == 4)
st.set_corner("cold", enabled=False)
check("a disabled corner is skipped", {p.corner for p in runner.plan(st)} == {"hot"})
st.set_corner("hot", disable_tests=["AC"])
try:
    runner.plan(st)
    check("every corner disabled for the test is reported", False)
except runner.RunError as exc:
    check("every corner disabled for the test is reported", "nothing to run" in str(exc), str(exc))

# ---- a real run: sweep only
st = make()
job = runner.Job("Interactive.1")
sm = runner.run(st, SCH, HIST, "Interactive.1", job)
check("run finished with both points ok", sm["status"] == "done" and len(sm["points"]) == 2 and all(p["ok"] for p in sm["points"]), [p.get("errors") for p in sm["points"]])
check("progress counted", job.done == 2 and job.total == 2)
p1, p2 = sm["points"]
f3 = lambda c: 1 / (2 * math.pi * 1e3 * c)
check("BW(1p) = 159 MHz", abs(p1["outputs"]["BW"]["value"] - f3(1e-12)) / f3(1e-12) < 0.02, p1["outputs"]["BW"])
check("BW(100f) = 1.59 GHz", abs(p2["outputs"]["BW"]["value"] - f3(1e-13)) / f3(1e-13) < 0.02, p2["outputs"]["BW"])
check("spec BW > 1G: fail at 1p, pass at 100f", (p1["outputs"]["BW"]["spec_status"], p2["outputs"]["BW"]["spec_status"]) == ("fail", "pass"), (p1["outputs"]["BW"], p2["outputs"]["BW"]))
check("waveform output stored, not inlined", p1["outputs"]["Vout"]["kind"] == "wave" and "value" not in p1["outputs"]["Vout"])
check("point status values", [R.point_status(p) for p in sm["points"]] == ["fail", "pass"])
ov = sm["overall"]
check("overall: fail, yield 50 %", ov["status"] == "fail" and ov["yield"] == 50.0 and ov["pass"] == 1 and ov["fail"] == 1, ov)
w = R.load_waves(os.path.join(HIST.path("Interactive.1"), p1["dir"], "outputs.npz"))["Vout"]
check("saved waveform is the AC response (complex, starts near 1)", abs(w.y[0]) > 0.999 and w.y.dtype.kind == "c", (w.y[:1], w.y.dtype))
check("deck and log are kept for each point", os.path.isfile(os.path.join(HIST.path("Interactive.1"), p1["dir"], "ngspice.cir")) and os.path.isfile(os.path.join(HIST.path("Interactive.1"), p1["dir"], "ngspice.log")))
check("history listed", HIST.names() == ["Interactive.1"] and HIST.exists("Interactive.1"))

# ---- corners with temperature: resistor tc1 makes the bandwidth depend on temperature
s2 = SCH.load("lib", "tb")
s2.insts["R0"].params["tc1"] = "0.001"
SCH.save(s2)
st = make()
st.set_var("c_val", "1p")
st.set_corner("hot")
st.set_corner("cold")
st.set_var("temperature", "127", "corner", "hot")
st.set_var("temperature", "-23", "corner", "cold")
sm = runner.run(st, SCH, HIST, "Interactive.2", runner.Job("Interactive.2"))
bw = {p["corner"]: p["outputs"]["BW"]["value"] for p in sm["points"]}
# R(T) = R0 (1 + tc1 (T - 27)):  hot (127 C) 1.10 k, cold (-23 C) 0.95 k  ->  BW ratio cold/hot = 1.1/0.95
check("corner temperature changes the result as the resistor tc1 predicts", all(p["ok"] for p in sm["points"]) and abs(bw["cold"] / bw["hot"] - 1.1 / 0.95) < 0.01, bw)
check("temperature is a .temp card and not a .param", ".temp 127" in open(os.path.join(HIST.path("Interactive.2"), sm["points"][0]["dir"], "ngspice.cir")).read() and "temperature=" not in open(os.path.join(HIST.path("Interactive.2"), sm["points"][0]["dir"], "ngspice.cir")).read())
s2.insts["R0"].params.pop("tc1")
SCH.save(s2)

# ---- re-evaluate on saved waveforms, no simulation
st = make()
sm = runner.run(st, SCH, HIST, "Interactive.3", runner.Job("Interactive.3"))
st.set_spec("BW", "AC", gt="100M")
st.add_output("GainDC", "AC", "point", expr='dcGain(VF("/OUT"))')
sm2 = runner.reevaluate(st, SCH, HIST, "Interactive.3")
check("re-evaluation with a relaxed spec: both points pass", [R.point_status(p) for p in sm2["points"]] == ["pass", "pass"] and sm2["overall"]["status"] == "pass", [R.point_status(p) for p in sm2["points"]])
check("a new output appears after re-evaluation without re-simulating", all(abs(p["outputs"]["GainDC"]["value"] - 1.0) < 1e-6 for p in sm2["points"]) and "reevaluated" in sm2)

# ---- Monte Carlo on r_val (BW ~ 1/R): sigma 5 % -> BW relative spread about 5 %
st = make()
st.set_var("c_val", "1p")
st.run_mode = "Monte Carlo Sampling"
st.monte_carlo.points, st.monte_carlo.seed = 30, 5
st.monte_carlo.dists = {"r_val": {"dist": "gaussian", "sigma": "5%"}}
sm = runner.run(st, SCH, HIST, "Interactive.4", runner.Job("Interactive.4"))
stats = R.output_stats(sm, "AC", "BW")
check("Monte Carlo: 30 points, all ok", len(sm["points"]) == 30 and all(p["ok"] for p in sm["points"]) and all(p["mc_index"] for p in sm["points"]))
check("Monte Carlo: mean BW near nominal, relative sigma about 5 %", stats and abs(stats["mean"] - f3(1e-12)) / f3(1e-12) < 0.05 and 0.025 < stats["std"] / stats["mean"] < 0.08, stats)
sm_b = runner.run(st, SCH, HIST, "Interactive.5", runner.Job("Interactive.5"))
check("Monte Carlo is reproducible for a given seed", [p["vars"]["r_val"] for p in sm["points"]] == [p["vars"]["r_val"] for p in sm_b["points"]])
st.monte_carlo.seed = 6
check("a different seed gives different samples", [p.vars["r_val"] for p in runner.plan(st)] != [p["vars"]["r_val"] for p in sm["points"]] and len(runner.plan(st)) == 30)

# ---- CSV
csv_d = R.to_csv(runner.run(make(), SCH, HIST, "Interactive.6", runner.Job("Interactive.6")), "Detail")
check("detail csv has header, 2 points x 2 outputs and the sweep variable", csv_d.splitlines()[0].startswith("Point,Test,Corner,c_val,r_val,Output") and len(csv_d.splitlines()) == 5, csv_d)
csv_s = R.to_csv(HIST.read("Interactive.6"), "Summary")
check("summary csv lists BW with min and max", "AC,BW," in csv_s, csv_s)

# ---- errors do not take the run down
st = make()
st.add_output("Broken", "AC", "point", expr='ymax(VF("/OUT"))')            # complex waveform -> error in this output only
st.add_output("Missing", "AC", "point", expr='VF("/nosuch")')
sm = runner.run(st, SCH, HIST, "Interactive.7", runner.Job("Interactive.7"))
o = sm["points"][0]["outputs"]
check("a failing output is reported per output; the others still evaluate", o["Broken"]["kind"] == "error" and o["Missing"]["kind"] == "error" and o["BW"]["kind"] == "scalar" and sm["points"][0]["ok"], o)
st = make()
st.test("AC").lib, st.test("AC").cell = "lib", "nosuchcell"
sm = runner.run(st, SCH, HIST, "Interactive.8", runner.Job("Interactive.8"))
check("a missing design fails the point with a clear message", not sm["points"][0]["ok"] and "does not exist" in sm["points"][0]["errors"][0] and R.point_status(sm["points"][0]) == "error", sm["points"][0]["errors"])
check("overall status error when a point errored", sm["overall"]["status"] == "error")

# ---- cancellation
st = make()
st.set_var("c_val", "1p,2p,3p,4p,5p,6p")
st.job["maxJobs"] = 1
jb = runner.Job("Interactive.9")
jb.cancel()
sm = runner.run(st, SCH, HIST, "Interactive.9", jb)
check("cancelled run is marked cancelled and no point simulated", sm["status"] == "cancelled" and all(p.get("cancelled") for p in sm["points"]))

# ---- setup validation and persistence
st = make()
for name, fn, why in (("unknown test", lambda: st.test("nope"), "does not exist"),
                      ("bad output type", lambda: st.add_output("x", "AC", "bogus"), "output type"),
                      ("point output without expression", lambda: st.add_output("x", "AC", "point"), "needs an expression"),
                      ("spec on a missing output", lambda: st.set_spec("nope", "AC", gt="1"), "does not exist"),
                      ("non-numeric spec", lambda: st.set_spec("BW", "AC", gt="abc"), "must be a number"),
                      ("unknown spec option", lambda: st.set_spec("BW", "AC", foo="1"), "unknown spec option"),
                      ("unsupported analysis", lambda: st.set_analysis("AC", "pss"), "not supported"),
                      ("bad variable name", lambda: st.set_var("a b", "1"), "valid identifier"),
                      ("unsupported run mode", lambda: st.set_run_mode("Global Optimization"), "not supported"),
                      ("duplicate test", lambda: st.create_test("AC"), "already exists"),
                      ("bad cell path", lambda: SETS.dir("../x", "y"), "bad library")):
    try:
        fn()
        check("error: " + name, False, "no error")
    except SetupError as exc:
        check("error: " + name, why in str(exc), str(exc))
SETS.save(st)
st2 = SETS.load("lib", "tb")
check("save/load round-trips tests, outputs, specs, vars", st2.to_json() == st.to_json() and st2.spec("AC", "BW").gt == "1G" and st2.vars["c_val"] == "1p,100f")
tol = Setup("l", "c")
tol.create_test("T")
tol.add_output("o", "T", "point", expr="1")
tol.set_spec("o", "T", target="10", tolerance="10%")
sp = tol.spec("T", "o")
check("target +/- tolerance: relative % and absolute", sp.check(10.5) and not sp.check(11.5) and Setup.from_json(tol.to_json()).spec("T", "o").check(9.2))
check("copy a test", Setup.create_test(st, "AC2", source="AC").outputs["BW"].test == "AC2")

print(f"{fails} failed")
sys.exit(1 if fails else 0)
