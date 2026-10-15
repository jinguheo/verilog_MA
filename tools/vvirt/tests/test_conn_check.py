"""Netlist-versus-DEF connectivity check on small synthetic inputs (run: python3 tests/test_conn_check.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt import conn_check, netlist  # noqa: E402
from vvirt.pnr_est import Comp, Design, Net  # noqa: E402

fails = 0


def check(name, ok, got=None):
    global fails
    if not ok:
        fails += 1
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  got {got!r}"))


INV, TAP, MAC = "sky130_fd_sc_hd__inv_1", "sky130_fd_sc_hd__tapvpwrvgnd_1", "MAC"
NETLIST = """
module top (input a, output y);
  wire n1, n2;
  wire [1:0] bus;
  sky130_fd_sc_hd__inv_1 u1 (.A(a), .Y(n1));
  sky130_fd_sc_hd__inv_1 u2 (.A(n1), .Y(n2));
  sky130_fd_sc_hd__inv_1 u3 (.A(n2), .Y(bus[0]));
  sky130_fd_sc_hd__inv_1 u4 (.A(n2), .Y(bus[1]));
  MAC m (.d({bus[1], bus[0]}), .q(y));
endmodule
"""


def flat():
    return netlist.flatten(netlist.parse(NETLIST))


def design(nets, extra_comps=()):
    d = Design()
    for n, m in (("u1", INV), ("u2", INV), ("u3", INV), ("u4", INV), ("m", MAC), *extra_comps):
        d.comps[n] = Comp(n, m, 0.0, 0.0, "N")
    for name, terms in nets.items():
        d.nets[name] = Net(name, terms=terms)
    return d


GOOD = {"x1": [("u1", "Y"), ("u2", "A")], "x2": [("u2", "Y"), ("u3", "A"), ("u4", "A")],
        "b0": [("u3", "Y"), ("m", "d[0]")], "b1": [("u4", "Y"), ("m", "d[1]")]}

# bus concatenation on a leaf cell is msb first: {bus[1], bus[0]} -> d[1], d[0]
nl = flat()
check("leaf bus pin bit order (msb first list -> d[1], d[0])", nl.insts["m"][1].get("d[0]") == "bus[0]" and nl.insts["m"][1].get("d[1]") == "bus[1]", nl.insts["m"])

r = conn_check.check(design(GOOD, extra_comps=[("tap0", TAP)]), nl)
check("matching design is clean (physical-only cell not flagged)", r["clean"] and r["instances"]["physical_only_in_def"] == 1, r)
check("all four nets equal", r["nets"]["equal"] == 4 and r["nets"]["open"] == 0 and r["nets"]["short"] == 0, r["nets"])

# net names differ / are escaped: still equal, because pins are compared, not names
renamed = {("\\" + k + "\\[0\\]"): v for k, v in GOOD.items()}
check("net names do not matter", conn_check.check(design(renamed), nl)["clean"])

# swap the bus bits in the DEF (the bug found on a real run): both nets now join pins the netlist keeps apart
swapped = dict(GOOD, b0=[("u3", "Y"), ("m", "d[1]")], b1=[("u4", "Y"), ("m", "d[0]")])
r = conn_check.check(design(swapped), nl)
check("swapped bus bits are reported as shorts", r["nets"]["short"] == 2 and not r["clean"], r["nets"])

# a pin dropped from a net -> open
opened = dict(GOOD, x2=[("u2", "Y"), ("u3", "A")])
r = conn_check.check(design(opened), nl)
check("dropped pin is an open", r["nets"]["open"] == 1 and r["examples"]["open"][0]["missing_pins"] == [["u4", "A"]], r["examples"])

# two nets merged -> short
merged = {"x1": GOOD["x1"] + GOOD["x2"], "b0": GOOD["b0"], "b1": GOOD["b1"]}
r = conn_check.check(design(merged), nl)
check("merged nets are a short", r["nets"]["short"] == 1, r["nets"])

# missing instance, extra instance, wrong master
d = design(GOOD)
del d.comps["u4"]
d.comps["zz"] = Comp("zz", INV, 0.0, 0.0, "N")
d.comps["u3"].master = "sky130_fd_sc_hd__inv_2"
r = conn_check.check(d, nl)
i = r["instances"]
check("instance differences listed", i["only_in_netlist"] == ["u4"] and i["only_in_def"] == ["zz"] and i["master_mismatch"] == [["u3", INV, "sky130_fd_sc_hd__inv_2"]], i)
check("net absent from the DEF is counted", conn_check.check(design({k: v for k, v in GOOD.items() if k != "b1"}), nl)["nets"]["netlist_nets_absent_from_def"] == 1)
check("scope is stated", "not LVS" in " ".join(r["scope"]))

print(f"{fails} failed")
sys.exit(1 if fails else 0)
