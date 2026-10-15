"""ngspice rawfile reader + runner on tiny decks (run in WSL: python3 tests/test_maestro_engine.py)."""
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt.maestro import engine  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


DECK = """rc
V0 in 0 dc 0 ac 1 pulse(0 1 0 1n 1n 50n 100n)
R0 in out 1k
C0 out 0 1p
.ac dec 10 1 10G
.tran 1n 200n
.op
.end
"""
check("ngspice found", engine.ngspice_path() is not None)
check("version string", bool(engine.version()), engine.version())
with tempfile.TemporaryDirectory() as td:
    r = engine.run(DECK, td, "rc")
    check("run ok", r.ok, (r.errors, r.log[-300:]))
    kinds = [p.kind() for p in r.plots]
    check("three plots: op, ac, tran", sorted(kinds) == ["ac", "op", "tran"], kinds)
    ac = next(p for p in r.plots if p.kind() == "ac")
    check("ac is complex with frequency axis", ac.complex and ac.x_name == "frequency", (ac.complex, ac.x_name))
    f = ac.data["frequency"].real
    vout = ac.data["v(out)"]
    # corner of the RC at 1/(2 pi R C) = 159.15 MHz: |H| = 1/sqrt(2)
    k = int(abs(f - 1 / (2 * math.pi * 1e3 * 1e-12)).argmin())
    check("ac magnitude near the corner is about -3 dB", abs(abs(vout[k]) - 1 / math.sqrt(2)) < 0.03, abs(vout[k]))
    tr = next(p for p in r.plots if p.kind() == "tran")
    check("tran time axis monotonic, ends at 200 ns", abs(tr.data["time"][-1] - 200e-9) < 1e-12 and (tr.data["time"][1:] >= tr.data["time"][:-1]).all())
    check("tran output settles to the pulse level (1 V) at 40 ns", abs(float(tr.data["v(out)"][abs(tr.data["time"] - 40e-9).argmin()]) - 1.0) < 0.01)
    op = next(p for p in r.plots if p.kind() == "op")
    check("op plot has one point", op.points == 1 and "v(out)" in op.data)

    bad = engine.run("bad\nV1 a 0 1\nX1 a b nosuchsub\n.op\n.end\n", td, "bad")
    check("bad deck reports an error instead of crashing", (not bad.ok) and bool(bad.errors), (bad.ok, bad.errors, bad.log[-300:]))

    rs = engine.run_many([(DECK, td, f"p{i}") for i in range(3)], workers=3)
    check("run_many keeps order and all succeed", len(rs) == 3 and all(x.ok for x in rs))

print(f"{fails} failed")
sys.exit(1 if fails else 0)
