"""Maestro SKILL surface (mae* / asi* / axl* / vvSch* / vvMae*) driven through the interpreter, the way the bridge calls it.

Everything up to the simulation runs without ngspice; the run/results part is skipped when ngspice is not installed.
    cd tools/vvirt && python3 tests/test_maestro_skill.py
"""
import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt import records  # noqa: E402
from vvirt.maestro import engine, funcs as maestro_funcs  # noqa: E402
from vvirt.skill_lang import Interp, SkillError, skill_repr  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


TD = tempfile.TemporaryDirectory()
OUT = os.path.join(TD.name, "out")
IT = Interp()
maestro_funcs.install(IT, types.SimpleNamespace(stdlib=None), OUT)


def run(src):
    return IT.eval_text(src)


def rep(src):
    return skill_repr(run(src))


G = records.get


def errs(src, frag=""):
    try:
        run(src)
    except SkillError as exc:
        return frag in str(exc)
    return False


# ---- registration
for fn in ("maeOpenSetup", "maeCreateTest", "maeSetAnalysis", "maeAddOutput", "maeSetSpec", "maeSetVar", "maeSetCorner", "maeRunSimulation", "maeWaitUntilDone",
           "maeGetOutputValue", "maeGetOverallSpecStatus", "asiGetCurrentSession", "axlGetMainSetupDB", "vvSchCreate", "vvSchAddInst", "vvMaeResults", "vvMaeEval", "vvMaeDoctor"):
    check(f"{fn} is registered", fn in IT.funcs)

# ---- schematic: build, check, netlist
check("vvSchCreate", run('vvSchCreate("lib" "rc")') == "lib/rc")
run('vvSchAddInst("lib" "rc" "V0" "analogLib" "vdc" ?conn \'(("PLUS" "in") ("MINUS" "gnd!")) ?params \'(("vdc" "0") ("acm" "1")))')
run('vvSchAddInst("lib" "rc" "R0" "analogLib" "res" ?conn \'(("PLUS" "in") ("MINUS" "OUT")) ?params \'(("r" "r_val")))')
run('vvSchAddInst("lib" "rc" "C0" "analogLib" "cap" ?conn \'(("PLUS" "OUT")) ?params \'(("c" "1p")))')
chk = run('vvSchCheck("lib" "rc")')
check("check reports the unconnected capacitor pin", chk is not None and any("MINUS" in str(x) for x in chk), chk)
run('vvSchConnect("lib" "rc" "C0" "MINUS" "gnd!")')
run('vvSchSetParam("lib" "rc" "C0" "c" "c_val")')
run('vvSchAddPin("lib" "rc" "OUT" ?direction "output")')
check("check is clean after connecting", run('vvSchCheck("lib" "rc")') is None, run('vvSchCheck("lib" "rc")'))
check("vvSchList", "lib/rc" in (run('vvSchList("lib")') or []))
check("vvSchMasters has analogLib res", any(G(m, "cell") == "res" for m in run('vvSchMasters("analogLib")')))
info = run('vvSchInfo("lib" "rc")')
check("vvSchInfo lists three instances", len(G(info, "instances")) == 3, info)
nl = run('vvSchNetlist("lib" "rc" ?variables \'(("r_val" "1k") ("c_val" "1p")))')
check("netlist has the resistor and the .op card", "R" in nl and ".op" in nl.lower(), nl)
run('vvSchCreate("lib" "bad")')
run('vvSchAddInst("lib" "bad" "X9" "analogLib" "nosuch")')
check("unknown master is reported by the check or the netlist", errs('vvSchNetlist("lib" "bad")', "nosuch") or "nosuch" in str(run('vvSchCheck("lib" "bad")')))
run('vvSchDelete("lib" "bad")')
check("unknown schematic is an error", errs('vvSchCheck("lib" "missing")'))

sp = run('vvSchFromSpice("lib" "amp" ".subckt amp in out\\nE1 out 0 in 0 2\\n.ends amp\\n")')
check("vvSchFromSpice finds the subcircuit pins", G(sp, "subckt") == "amp" and list(G(sp, "pins")) == ["in", "out"], sp)
check("vvSchDelete", run('vvSchDelete("lib" "amp")') is True and run('vvSchDelete("lib" "amp")') is None)

# ---- sessions
check("no session: setup call is an error", errs('maeGetSetup()', "no maestro session"))
check("opening a missing view in read mode is an error", errs('maeOpenSetup("lib" "tb")', "does not exist"))
sid = run('maeOpenSetup("lib" "tb" "maestro" ?mode "a")')
check("session id", isinstance(sid, str) and sid.startswith("fnxSession"), sid)
check("asiGetCurrentSession", run("asiGetCurrentSession()") == sid)
check("maeGetSessions", run("maeGetSessions()") == [sid])

# ---- tests, analyses, outputs, specs
run('maeCreateTest("AC" ?lib "lib" ?cell "rc")')
run('maeSetAnalysis("AC" "ac" ?enable t ?options `(("start" "1") ("stop" "10G") ("incrType" "Logarithmic") ("stepTypeLog" "Points Per Decade") ("dec" "20")))')
check("enabled analyses", run('maeGetEnabledAnalysis("AC")') == ["ac"])
check("maeGetAnalysis returns the options", ("stop", "10G") in [tuple(x) for x in run('maeGetAnalysis("AC" "ac")')] or ["stop", "10G"] in run('maeGetAnalysis("AC" "ac")'))
run('maeAddOutput("Vout" "AC" ?outputType "net" ?signalName "/OUT")')
run('maeAddOutput("BW" "AC" ?outputType "point" ?expr "bandwidth(mag(VF(\\"/OUT\\")) 3 \\"low\\")")')
run('maeSetSpec("BW" "AC" ?gt "1G")')
check("maeGetSpec", "1G" in str(run('maeGetSpec("BW" "AC")')), run('maeGetSpec("BW" "AC")'))
check("maeGetSpec without a spec is nil", run('maeGetSpec("Vout" "AC")') is None)
outs = run('maeGetTestOutputs("AC")')
check("two outputs with ~> attributes", [o.skill_get("name") for o in outs] == ["Vout", "BW"] and outs[1].skill_get("outputType") == "point", outs)
check("maeGetSetup tests", run("maeGetSetup()") == ["AC"])
check("unknown test is an error", errs('maeAddOutput("X" "NoSuchTest" ?outputType "point" ?expr "1")'))

# ---- variables, parameters, corners
run('maeSetVar("r_val" "1k")')
run('maeSetVar("c_val" "1p,100f")')
check("maeGetVar", run('maeGetVar("r_val")') == "1k")
check("asiGetDesignVarList", ["c_val", "1p,100f"] in [list(x) for x in run("asiGetDesignVarList()")])
run('maeSetParameter("pw" ?value "5n")')
check("maeGetParameter", run('maeGetParameter("pw")') == "5n")
run('maeSetCorner("hot")')
run('maeSetVar("temperature" "125" ?typeName "corner" ?typeValue \'("hot"))')
check("corner variable", run('maeGetVar("temperature" ?typeName "corner" ?typeValue \'("hot"))') == "125")
check("maeGetSetup corners", run('maeGetSetup(?typeName "corners")') == ["hot"])
check("maeDeleteCorner", run('maeDeleteCorner("hot")') is True and run('maeGetSetup(?typeName "corners")') is None)
check("deleting a missing variable is nil", run('maeDeleteVar("nope")') is None)
check("bad typeName is an error", errs('maeGetSetup(?typeName "nonsense")', "not supported"))

# ---- environment and run mode
MODEL = os.path.join(TD.name, "m.lib").replace(os.sep, "/")
with open(MODEL, "w") as fh:
    fh.write(".lib tt\n.endl tt\n")
run(f'maeSetEnvOption("AC" ?options `(("modelFiles" (("{MODEL}" "tt")))))')
check("modelFiles stored", run('maeGetEnvOption("AC" ?option "modelFiles")') == [[MODEL, "tt"]], run('maeGetEnvOption("AC" ?option "modelFiles")'))
check("model file outside allowed dirs is refused", errs('maeSetEnvOption("AC" ?options `(("modelFiles" (("C:/Windows/x.lib" "tt")))))', "outside the allowed"))
check("only ngspice as simulator", errs('maeSetEnvOption("AC" ?options `(("simExecName" "hspice")))', "ngspice"))
run('maeSetSimOption("AC" ?options `(("reltol" "1e-4")))')
check("run mode default", run("maeGetCurrentRunMode()") == "Single Run, Sweeps and Corners")
run('maeSetCurrentRunMode("Monte Carlo Sampling")')
check("run mode set", run("maeGetCurrentRunMode()") == "Monte Carlo Sampling")
run('maeSetCurrentRunMode("Single Run, Sweeps and Corners")')
check("bad run mode is an error", errs('maeSetCurrentRunMode("Bogus")'))
run('maeSetJobPolicy("local" ?maxJobs 2 ?timeout 60)')

# ---- Monte Carlo configuration
mc = run('vvMaeMonteCarlo(?points 20 ?seed 3 ?dists \'(("r_val" (("dist" "gaussian") ("sigma" "5%")))))')
check("vvMaeMonteCarlo", G(mc, "points") == 20 and G(mc, "seed") == 3 and G(mc, "variables")[0][0] == "r_val", mc)
check("vvMaeMonteCarlo ?clear", G(run("vvMaeMonteCarlo(?clear t)"), "variables") in ([], None))

# ---- corners with models
run('vvMaeSetModel("ss" "/tmp/m.lib" "ss")')
check("vvMaeSetModel creates the corner", run('maeGetSetup(?typeName "corners")') == ["ss"])
check("vvMaeSetModel outside allowed dirs is refused", errs('vvMaeSetModel("ss" "C:/Windows/m.lib" "ss")', "outside the allowed"))
run('maeDeleteCorner("ss")')

# ---- deck, netlist, script
deck = run('vvMaeDeck("AC")')
check("deck has the AC card and the variable value", ".ac dec 20" in deck.lower() and "r_val=1000" in deck and "c_val=1e-12" in deck, deck)
check("deck second sweep point exists", "c_val=1e-13" in run('vvMaeDeck("AC" ?point 2)'))
check("deck point out of range is an error", errs('vvMaeDeck("AC" ?point 9)', "point"))
nd = run(f'maeCreateNetlistForCorner("AC" nil "{TD.name.replace(os.sep, "/")}/nl")')
check("maeCreateNetlistForCorner writes a file", os.path.isfile(nd), nd)
script = os.path.join(TD.name, "setup.il").replace(os.sep, "/")
run(f'maeWriteScript("{script}")')
text = open(script, encoding="utf-8").read()
check("script reopens the setup and recreates the test", 'maeOpenSetup("lib" "tb"' in text and 'maeCreateTest("AC"' in text and 'maeSetSpec("BW" "AC"' in text, text[:300])
check("unsupported migration functions say so", errs('maeMigrateADEXLToMaestro()', "not supported"))

# ---- save, read-only reopen, close
check("maeSaveSetup", run("maeSaveSetup()") is True)
check("maeCloseSession", run(f'maeCloseSession("{sid}")') is True and run("maeGetSessions()") is None)
ro = run('maeOpenSetup("lib" "tb")')
check("saved setup reopens read-only with its content", run("maeGetSetup()") == ["AC"])
check("read-only session refuses edits", errs('maeSetVar("r_val" "2k")', "read-only"))
run("maeMakeEditable()")
check("maeMakeEditable allows edits", run('maeSetVar("r_val" "2k")') is True)
run('maeSetVar("r_val" "1k")')
run(f'maeCloseSession("{ro}")')
run('maeOpenSetup("lib" "tb" "maestro" ?mode "a")')

# ---- results and history before any run
check("no history yet", run("vvMaeHistories()") is None)
check("results without a run are an error", errs("vvMaeResults()", "no simulation history"))
dr = run("vvMaeDoctor()")
check("vvMaeDoctor lists supported analyses", "ac" in list(G(dr, "supportedAnalyses")) and len(G(dr, "supportedRunModes")) == 2, dr)

# ---- simulation (needs ngspice)
if engine.ngspice_path() is None:
    print("skip simulation: ngspice not installed (set VVIRT_NGSPICE)")
else:
    h = run("maeRunSimulation(?waitUntilDone t)")
    check("run returns a history name", isinstance(h, str) and h.startswith("Interactive."), h)
    check("maeGetResultTests", run("maeGetResultTests()") == ["AC"])
    check("maeGetResultOutputs", set(run("maeGetResultOutputs()")) == {"Vout", "BW"})
    bw = run('maeGetOutputValue("BW" "AC" ?pointIndex 1)')
    check("bandwidth of 1k / 1p is about 159 MHz", isinstance(bw, float) and 1.4e8 < bw < 1.8e8, bw)
    check("spec 1G fails for that bandwidth", run('maeGetSpecStatus("BW" "AC" ?pointIndex 1)') == "fail")
    check("overall status is fail", run("maeGetOverallSpecStatus()") == "fail")
    res = run("vvMaeResults()")
    check("vvMaeResults has both sweep points", len(G(res, "points")) == 2, res)
    ev = run('vvMaeEval("dcGain(VF(\\"/OUT\\"))" ?pointIndex 1)')
    check("vvMaeEval dc gain is about 1", G(ev, "kind") == "scalar" and abs(G(ev, "value") - 1) < 1e-3, ev)
    csvp = os.path.join(TD.name, "vout.csv").replace(os.sep, "/")
    run(f'vvMaeWaveCsv("Vout" "{csvp}" ?pointIndex 1)')
    check("vvMaeWaveCsv writes a csv", open(csvp).readline().startswith("x,"))
    check("vvMaeStats", G(run('vvMaeStats("BW" "AC")'), "n") == 2)
    html = os.path.join(TD.name, "report.html").replace(os.sep, "/")
    run(f'vvMaeReport("{html}")')
    check("vvMaeReport writes html", "<html" in open(html, encoding="utf-8").read().lower())
    check("vvMaeHistories lists the run", len(run("vvMaeHistories()")) == 1)
    run(f'maeSetHistoryLock("{h}")')
    check("locked history cannot be deleted", errs(f'vvMaeDeleteHistory("{h}")', "locked"))
    run(f'maeSetHistoryLock("{h}" nil)')
    check("unlocked history is deleted", run(f'vvMaeDeleteHistory("{h}")') is True and run("vvMaeHistories()") is None)

print(f"{fails} failed")
sys.exit(1 if fails else 0)
