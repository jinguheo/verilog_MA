"""Calculator on synthetic waveforms with closed-form answers (run in WSL: python3 tests/test_maestro_calc.py)."""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.maestro import calc, units  # noqa: E402
from vvirt.maestro.calc import Calc, CalcError, Wave  # noqa: E402
from vvirt.maestro.rawfile import Plot  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


def near(a, b, rel=0.01):
    return a is not None and abs(a - b) <= rel * max(abs(b), 1e-30)


# --- units
check("si suffixes", units.si("1G") == 1e9 and units.si("10n") == 1e-8 and units.si("5 meg") == 5e6 and units.si("100mV") == 0.1 and units.si("1e-3") == 1e-3)
check("si rejects text", not units.is_number("abc"))
check("eng format", units.eng(1.5e-9) == "1.5n" and units.eng(2.2e6) == "2.2M" and units.eng(0) == "0")
check("sweep lists", units.split_values("1p,100f") == ["1p", "100f"] and units.split_values("0.8:0.1:1.0") == ["0.8", "0.9", "1.0"] or len(units.split_values("0.8:0.1:1.0")) == 3)
check("si literal expansion skips strings", calc.expand_si('value(v("/n1n") 10n)') == 'value(v("/n1n") 1e-08)', calc.expand_si('value(v("/n1n") 10n)'))

# --- single pole low-pass, f3dB = 1/(2 pi R C), R=1k C=1p -> 159.155 MHz
R, C = 1e3, 1e-12
f3 = 1 / (2 * math.pi * R * C)
f = np.logspace(0, 11, 551)
h = 1 / (1 + 1j * f / f3)
ac = Plot("AC Analysis", complex=True, names=["frequency", "v(in)", "v(out)"], types=["frequency", "voltage", "voltage"], points=len(f))
ac.data = {"frequency": f.astype(complex), "v(in)": np.ones(len(f), dtype=complex), "v(out)": h}
c = Calc({"ac": ac}, default="ac")
check("bandwidth low-pass -3 dB", near(c.eval('bandwidth(mag(VF("/out")) 3 "low")'), f3, 0.01), c.eval('bandwidth(mag(VF("/out")) 3 "low")'))
check("bandwidth works on uppercase net", near(c.eval('bandwidth(mag(v("/OUT")) 3 "low")'), f3, 0.01))
check("dc gain 1", near(c.eval('dcGain(VF("/out"))'), 1.0, 1e-6))
check("db20 at corner about -3.01", abs(c.eval(f'value(db20(VF("/out")) {f3!r})') + 3.0103) < 0.05)
check("phase at corner about -45", abs(c.eval(f'value(phase(VF("/out")) {f3!r})') + 45.0) < 0.5)
check("arithmetic on waves and SI literals", near(c.eval('value(mag(VF("/out")) 1) * 2'), 2.0, 1e-3))
# amplifier A0=1000 single pole at 1 kHz -> unity gain freq ~ 1 MHz, phase margin ~ 90 deg
a = 1000 / (1 + 1j * f / 1e3)
ac2 = Plot("AC Analysis", complex=True, names=["frequency", "v(out)"], points=len(f))
ac2.data = {"frequency": f.astype(complex), "v(out)": a}
c2 = Calc({"ac": ac2}, default="ac")
check("unity gain frequency ~ GBW = 1 MHz", near(c2.eval('unityGainFreq(VF("/out"))'), 1e6, 0.01), c2.eval('unityGainFreq(VF("/out"))'))
check("gainBwProd = 1 MHz", near(c2.eval('gainBwProd(VF("/out"))'), 1e6, 0.01))
check("phase margin ~ 90 deg (single pole)", abs(c2.eval('phaseMargin(VF("/out"))') - 90.0) < 1.0, c2.eval('phaseMargin(VF("/out"))'))
# three-pole loop gain has a gain margin
t3 = 10 / ((1 + 1j * f / 1e6) ** 3)
ac3 = Plot("AC Analysis", complex=True, names=["frequency", "v(out)"], points=len(f))
ac3.data = {"frequency": f.astype(complex), "v(out)": t3}
c3 = Calc({"ac": ac3}, default="ac")
gm = c3.eval('gainMargin(VF("/out"))')
check("gain margin of 10/(1+s/w)^3 is 20*log10(8/10) = -1.94 dB", gm is not None and abs(gm - (-20 * math.log10(10 / 8))) < 0.1, gm)

# --- transient: 1 V step through an RC (tau = 1 ns); pulse train for frequency/duty
t = np.linspace(0, 20e-9, 4001)
vs = 1 - np.exp(-t / 1e-9)
tr = Plot("Transient Analysis", names=["time", "v(out)", "v(in)"], points=len(t))
tr.data = {"time": t, "v(out)": vs, "v(in)": np.ones_like(t)}
ct = Calc({"tran": tr}, default="tran")
check("rise time 10-90% = 2.197 tau", near(ct.eval('riseTime(VT("/out"))'), 2.1972e-9, 0.02), ct.eval('riseTime(VT("/out"))'))
check("cross at 0.5 = ln2 tau", near(ct.eval('cross(VT("/out") 0.5 1 "rising")'), math.log(2) * 1e-9, 0.01))
check("ymax / ymin / peakToPeak", near(ct.eval('ymax(VT("/out"))'), 1.0, 0.001) and ct.eval('ymin(VT("/out"))') == 0.0 and near(ct.eval('peakToPeak(VT("/out"))'), 1.0, 0.001))
check("settling time to 2 % ~ 3.9 tau", near(ct.eval('settlingTime(VT("/out") 0.02)'), 3.912e-9, 0.03), ct.eval('settlingTime(VT("/out") 0.02)'))
check("overshoot of a monotonic response is 0", abs(ct.eval('overshoot(VT("/out"))')) < 1e-6)
# (the real delay test is below, once the pulse train exists)
check("integ ends at the integral", near(float(calc.FUNCTIONS["integ"](Wave(t, vs)).y[-1]), float(np.trapezoid(vs, t)) if hasattr(np, "trapezoid") else 0.0, 1e-9))
check("average of the step response", near(ct.eval('average(VT("/out"))'), 1 - 1e-9 / 20e-9 * (1 - math.exp(-20)), 0.01))
check("slew rate = initial slope 1 V/ns", near(ct.eval('slewRate(VT("/out"))'), 1e9, 0.02), ct.eval('slewRate(VT("/out"))'))

# pulse train: 100 MHz, 30 % duty, 0..1 V; and a sine for rms/thd
tp = np.linspace(0, 100e-9, 100001)
pw = ((tp % 10e-9) < 3e-9).astype(float)
trp = Plot("Transient Analysis", names=["time", "v(p)"], points=len(tp))
trp.data = {"time": tp, "v(p)": pw}
cp = Calc({"tran": trp}, default="tran")
trp.names.append("v(q)")
trp.data["v(q)"] = (((tp - 1e-9) % 10e-9) < 3e-9).astype(float) * (tp >= 1e-9)
check("delay between two edges = the 1 ns shift", near(cp.eval('delay(VT("/p") 0.5 "rising" VT("/q") 0.5 "rising")'), 1e-9, 0.02), cp.eval('delay(VT("/p") 0.5 "rising" VT("/q") 0.5 "rising")'))
check("frequency 100 MHz", near(cp.eval('frequency(VT("/p"))'), 1e8, 0.01), cp.eval('frequency(VT("/p"))'))
check("duty cycle 30 %", near(cp.eval('dutyCycle(VT("/p"))'), 30.0, 0.02), cp.eval('dutyCycle(VT("/p"))'))
ts = np.linspace(0, 10e-6, 200001)
vsn = 0.5 * np.sin(2 * math.pi * 1e6 * ts)
trs = Plot("Transient Analysis", names=["time", "v(s)"], points=len(ts))
trs.data = {"time": ts, "v(s)": vsn}
cs = Calc({"tran": trs}, default="tran")
check("rms of a 0.5 V sine = 0.3536", near(cs.eval('rms(VT("/s"))'), 0.5 / math.sqrt(2), 0.01), cs.eval('rms(VT("/s"))'))
check("THD of a pure sine is tiny", cs.eval('thd(VT("/s") 1e6 5)') < 0.05, cs.eval('thd(VT("/s") 1e6 5)'))
d = 0.5 * np.sin(2 * math.pi * 1e6 * ts) + 0.05 * np.sin(2 * math.pi * 3e6 * ts)
trd = Plot("Transient Analysis", names=["time", "v(d)"], points=len(ts))
trd.data = {"time": ts, "v(d)": d}
check("THD of sine + 10 % third harmonic = 10 %", near(Calc({"tran": trd}, default="tran").eval('thd(VT("/d") 1e6 5)'), 10.0, 0.05), Calc({"tran": trd}, default="tran").eval('thd(VT("/d") 1e6 5)'))

# --- errors are clear, not crashes
for expr, why in (('VF("/nosuch")', "unknown signal"), ('VT("/out")', "analysis not present"), ('ymax(VF("/out"))', "complex to real function")):
    try:
        c.eval(expr)
        check("error for " + why, False, "no error")
    except CalcError as exc:
        check("error for " + why, bool(str(exc)), str(exc))
amb = Calc({"ac": ac, "tran": tr})
try:
    amb.eval('v("/out")')
    check("ambiguous analysis is reported", False)
except CalcError as exc:
    check("ambiguous analysis is reported", "ambiguous" in str(exc), str(exc))
check("operating point returns a number", Calc({"op": Plot("Operating Point", names=["v(a)"], points=1, data={"v(a)": np.array([1.8])})}, default="op").eval('v("/a")') == 1.8)

print(f"{fails} failed")
sys.exit(1 if fails else 0)
