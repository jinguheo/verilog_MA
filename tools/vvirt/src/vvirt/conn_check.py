"""Netlist-versus-placement connectivity check: does the routed/placed DEF connect the same instance pins as the netlist?

Nets are compared by the set of (instance, pin) they join, not by net name, so renamed or escaped net names do not matter.
Per DEF net with two or more terms:
  equal  - the same pin set exists in the netlist
  open   - the DEF net holds only part of a netlist net (pins the netlist joins are missing from it)
  short  - the DEF net joins pins the netlist keeps on different nets
Instances are compared by name and master. Physical-only cells (tap, decap, fill) are expected to be absent from a logical
netlist and are counted, not flagged.

Scope, stated in every result: signal nets only (power/ground, constants and top-level ports are not compared); this is a
bookkeeping comparison of two descriptions, not LVS: nothing here looks at geometry, so a DEF that says two pins are joined
may still be unrouted or shorted in metal.
"""
from __future__ import annotations

import re

from .netlist import FlatNetlist
from .pnr_est import Design

PHYSICAL_ONLY = re.compile(r"__(tap|tapvpwrvgnd|decap|fill|fillcap)(_|$)")
SCOPE = ["signal nets only (no power, constants or top-level ports)", "by instance/pin sets, not net names",
         "description-level, not geometry: not LVS"]


def _n(s: str) -> str:
    return s.replace("\\", "").strip()


def _pins(terms, n: int = 6) -> list:
    return [list(t) for t in sorted(terms)[:n]]


def check(d: Design, nl: FlatNetlist, limit: int = 20) -> dict:
    def_inst = {_n(c.name): c.master for c in d.comps.values()}
    nl_inst = {_n(i): cell for i, (cell, _p) in nl.insts.items()}
    physical = sum(1 for m in def_inst.values() if PHYSICAL_ONLY.search(m))
    only_nl = sorted(set(nl_inst) - set(def_inst))
    only_def = sorted(i for i in set(def_inst) - set(nl_inst) if not PHYSICAL_ONLY.search(def_inst[i]))
    master_diff = sorted((i, nl_inst[i], def_inst[i]) for i in set(nl_inst) & set(def_inst) if nl_inst[i] != def_inst[i])

    nl_sets = [frozenset((_n(i), _n(p)) for i, p in terms) for terms in nl.nets.values() if len(terms) >= 2]
    nl_of: dict[tuple[str, str], frozenset] = {t: s for s in nl_sets for t in s}
    def_sets = [(net.name, frozenset((_n(a), _n(b)) for a, b in net.terms)) for net in d.nets.values() if not net.special]
    def_sets = [(n, s) for n, s in def_sets if len(s) >= 2]
    def_of: dict[tuple[str, str], frozenset] = {t: s for _n_, s in def_sets for t in s}

    equal = 0
    opens: list[dict] = []
    shorts: list[dict] = []
    unknown = 0
    for name, terms in def_sets:
        targets = {nl_of.get(t) for t in terms}
        if None in targets:
            unknown += 1          # a pin the netlist does not know (instance or pin missing)
            targets.discard(None)
        if len(targets) > 1:
            shorts.append({"net": name, "pins": _pins(terms), "joins_netlist_nets": len(targets)})
        elif len(targets) == 1:
            (s,) = targets
            if terms == s:
                equal += 1
            elif terms < s:
                opens.append({"net": name, "have": len(terms), "netlist_has": len(s), "missing_pins": _pins(s - terms)})
    missing = [_pins(s, 4) for s in nl_sets if not any(t in def_of for t in s)]
    return {"instances": {"netlist": len(nl_inst), "def": len(def_inst), "physical_only_in_def": physical,
                          "only_in_netlist": only_nl[:limit], "only_in_netlist_count": len(only_nl),
                          "only_in_def": only_def[:limit], "only_in_def_count": len(only_def),
                          "master_mismatch": [list(x) for x in master_diff[:limit]], "master_mismatch_count": len(master_diff)},
            "nets": {"def_checked": len(def_sets), "equal": equal, "open": len(opens), "short": len(shorts), "unknown_pins": unknown,
                     "netlist_nets_absent_from_def": len(missing)},
            "examples": {"open": opens[:limit], "short": shorts[:limit], "absent": missing[:limit]},
            "clean": not (only_nl or only_def or master_diff or opens or shorts or unknown or missing),
            "scope": SCOPE}
