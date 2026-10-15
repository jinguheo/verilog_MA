"""SKILL functions for design rules, designer habits (profiles), rule checking and rule-aware placement/routing."""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from . import layers, rules as R
from .records import rec
from .odb import CellView, Database, Instance, Shape, Via, _pt, transform_point
from .skill_lang import Interp, SkillError

PROFILE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "profiles")


class Habits:
    def __init__(self, directions: dict | None = None) -> None:
        self.name = "none"
        self.description = "no profile loaded: minimum rules only"
        self.directions: dict[str, str] = dict(directions or {"met1": "H", "met2": "V", "met3": "H", "met4": "V", "met5": "H"})
        self.width_multiple: dict[str, float] = {}
        self.space_multiple = 1.0
        self.vias = 1
        self.snap = 0.005
        self.cell_gap = 0.0
        self.flip_rows = False
        self.tap: str | None = None
        self.tap_ends = False

    def rows(self) -> list:
        return [["name", self.name], ["directions", " ".join(f"{k}:{v}" for k, v in sorted(self.directions.items()))],
                ["widthMultiple", " ".join(f"{k}:{v:g}" for k, v in sorted(self.width_multiple.items())) or "all 1"],
                ["spaceMultiple", self.space_multiple], ["viasPerConnection", self.vias], ["snapGrid", self.snap],
                ["cellGap", self.cell_gap], ["alternateRowFlip", True if self.flip_rows else None],
                ["tapCell", self.tap], ["tapEnds", True if self.tap_ends else None]]


def install(interp: Interp, db: Database) -> dict:
    F = interp.funcs
    rs = R.RuleSet()
    hb = Habits(rs.directions)
    st = {"rules": rs, "habits": hb}

    def sync_viadefs() -> None:
        """Draw vias with the PDK's cut size and the larger enclosure side so they pass the tech-LEF enclosure rule."""
        for name, vd in db.viadefs.items():
            e = rs.cut_enc.get(vd.spec["cut"])
            if e:
                vd.spec["cut_size"] = e[2] or vd.spec["cut_size"]
                vd.spec["enc_bot"], vd.spec["enc_top"] = e[0], e[1]

    sync_viadefs()

    def canon(layer: Any, fn: str) -> str:
        c = layers.canonical(str(layer))
        if c is None:
            raise SkillError(f"*Error* {fn}: layer {layer} is not defined in the technology (sky130A). Valid layers: " + " ".join(sorted(layers.LPP)))
        return c

    def snap(v: float) -> float:
        return round(round(v / hb.snap) * hb.snap, 4) if hb.snap else v

    # ------------------------------------------------------------------ rules + profiles
    def v_rules(*layer):
        rows = rs.as_list()
        if layer:
            rows = [r for r in rows if r[0] == canon(layer[0], "vvRules")]
        return rows or None

    def v_set_rule(layer, kind, value):
        try:
            rs.set(canon(layer, "vvSetRule"), str(kind), float(value))
        except ValueError as exc:
            raise SkillError(f"*Error* vvSetRule: {exc}")
        return rs.get(canon(layer, "vvSetRule"), str(kind))

    def v_load_profile(name):
        path = str(name)
        if not os.path.isabs(path):
            path = os.path.join(PROFILE_DIR, path if path.endswith(".json") else path + ".json")
        if not os.path.isfile(path):
            avail = sorted(f[:-5] for f in os.listdir(PROFILE_DIR) if f.endswith(".json"))
            raise SkillError(f"*Error* vvLoadProfile: profile {name} not found. Available: " + " ".join(avail))
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        rs.__init__()
        sync_viadefs()
        for layer, kinds in d.get("rules", {}).items():
            for k, v in kinds.items():
                rs.set(canon(layer, "vvLoadProfile"), k, v)
        h = d.get("habits", {})
        hb.__init__(rs.directions)
        hb.name, hb.description = d.get("name", os.path.basename(path)), d.get("description", "")
        hb.directions.update(h.get("directions", {}))
        hb.width_multiple = {canon(k, "vvLoadProfile"): float(v) for k, v in h.get("widthMultiple", {}).items()}
        hb.space_multiple = float(h.get("spaceMultiple", 1.0))
        hb.vias = int(h.get("viasPerConnection", 1))
        hb.snap = float(h.get("snapGrid", 0.005))
        hb.cell_gap = float(h.get("cellGap", 0.0))
        hb.flip_rows = bool(h.get("alternateRowFlip", False))
        hb.tap = h.get("tapCell")
        hb.tap_ends = bool(h.get("tapEnds", False))
        return f"{hb.name}: {hb.description}"

    F["vvRules"] = v_rules
    F["vvSetRule"] = v_set_rule
    F["vvLoadProfile"] = v_load_profile
    F["vvProfile"] = lambda: hb.rows()
    F["vvPitch"] = lambda layer: rs.pitch(canon(layer, "vvPitch"))
    F["vvRuleSource"] = lambda: rs.source
    F["vvDirections"] = lambda: [[k, v] for k, v in sorted(hb.directions.items())] or None

    # ------------------------------------------------------------------ geometry helpers
    def flat_polys(cv: CellView, only_instances: bool = False) -> list[tuple[str, list[tuple[float, float]]]]:
        src = cv
        if only_instances:
            src = CellView(db, cv.lib, cv.cell, cv.view)
            src.instances = cv.instances
        return [(l, pts) for l, p, pts in db.flatten(src) if p == "drawing"]

    def obstacles(cv: CellView, layer: str) -> list[tuple]:
        out = []
        for l, pts in flat_polys(cv):
            if l == layer:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                out.append((min(xs), min(ys), max(xs), max(ys)))
        return out

    def wire_params(layer: str) -> tuple[float, float]:
        w0 = rs.get(layer, "minWidth")
        if w0 is None or rs.get(layer, "minSpace") is None:
            raise SkillError(f"*Error* vvRoute: no width/space rule for layer {layer}; set one with vvSetRule")
        w = round(w0 * hb.width_multiple.get(layer, 1.0), 4)
        return w, round(rs.space_for(layer, w) * hb.space_multiple, 4)

    # ------------------------------------------------------------------ checking
    def new_violations(cv: CellView, want: set[str] | None, name: str) -> tuple[list[dict], int]:
        """Violations of the drawn geometry, minus those already present in the placed library cells alone."""
        try:
            now = R.check(flat_polys(cv), rs, want)
            base = R.check(flat_polys(cv, True), rs, want)
        except RuntimeError as exc:
            raise SkillError(f"*Error* {name}: {exc}")
        key = lambda v: (v["layer"], v["rule"], tuple(round(c, 3) for xy in v["bbox"] for c in xy))  # noqa: E731
        known = {key(v) for v in base}
        new = [v for v in now if key(v) not in known]
        return new, len(now) - len(new)

    def v_check(cv, *only):
        if not isinstance(cv, CellView):
            raise SkillError("*Error* vvCheckRules: argument #1 should be a cellview", cv)
        want = {canon(x, "vvCheckRules") for x in (only[0] if only and isinstance(only[0], list) else only)} or None
        new, _excluded = new_violations(cv, want, "vvCheckRules")
        # nil means "no violation found in the covered rules" only; vvCheckReport states what was covered
        return [[v["layer"], v["rule"], v["required"], v["bbox"]] for v in new] or None

    F["vvCheckRules"] = v_check

    # What no check here looks at. Reported with every result: "no violations" only ever means "none found in this scope".
    NOT_CHECKED = [
        "wide-wire spacing (SPACINGTABLE width>3um) and parallel-run-length / end-of-line spacing",
        "layers without a rule in the tech LEF (nwell, pwell, diff, tap, implants, poly, licon): present but not checked",
        "connectivity: shorts/opens between nets, same-net spacing exceptions (touching shapes are merged)",
        "density, antenna, off-grid, seal ring, LVS, parasitic extraction",
    ]

    def rule_kinds(layer: str) -> list[str]:
        return [k for k in ("minWidth", "minSpace", "minArea") if rs.get(layer, k) is not None]

    def check_report(cv: CellView, want: set[str] | None) -> list:
        """vvCheckRules with its scope stated: status is 'violations' or 'clean_in_scope' (never plain 'clean')."""
        flat = flat_polys(cv)
        order = {n: i for i, n in enumerate(layers.DRAW_ORDER)}
        present = sorted({l for l, _ in flat if want is None or l in want}, key=lambda n: order.get(n, 99))
        checked = [rec(("layer", l), ("rules", rule_kinds(l))) for l in present if rule_kinds(l)]
        no_rule = [l for l in present if not rule_kinds(l)]
        encl = [rec(("cut", c), ("metal", m)) for c, m, _e in rs.enclosures if c in present and m in present]
        new, base_n = new_violations(cv, want, "vvCheckReport") if checked else ([], 0)
        viol = [rec(("layer", v["layer"]), ("rule", v["rule"]), ("required", v["required"]), ("bbox", v["bbox"])) for v in new] or None
        status = "nothing_checked" if not checked else ("violations" if viol else "clean_in_scope")
        return [["status", status], ["checkedLayers", checked or None], ["enclosureChecks", encl or None],
                ["presentWithoutRule", no_rule or None], ["notChecked", NOT_CHECKED],
                ["excludedBecauseInPlacedCells", base_n], ["ruleSource", rs.source], ["profile", hb.name],
                ["ruleOverrides", [rec(("rule", k), ("value", v)) for k, v in sorted(rs.overrides.items())] or None], ["violations", viol]]

    def v_check_report(cv, *only):
        if not isinstance(cv, CellView):
            raise SkillError("*Error* vvCheckReport: argument #1 should be a cellview", cv)
        want = {canon(x, "vvCheckReport") for x in (only[0] if only and isinstance(only[0], list) else only)} or None
        return check_report(cv, want)

    F["vvCheckReport"] = v_check_report

    # ------------------------------------------------------------------ official sky130A DRC deck (independent signoff-style check)
    def official_new(cv, opts, name: str) -> tuple[list, str, bool, int]:
        """(new violations as [rule, count], deck path, feol run?, count left out because they exist in the placed cells alone)"""
        from . import export as E

        if not isinstance(cv, CellView):
            raise SkillError(f"*Error* {name}: argument #1 should be a cellview", cv)
        deck = R.find_deck(db.stdlib.root)
        if deck is None:
            raise SkillError(f"*Error* {name}: sky130A_mr.drc not found in the PDK")
        feol = any(str(o) == "feol" for o in opts)
        import tempfile

        with tempfile.TemporaryDirectory(prefix="vvgds_") as td:
            g1 = os.path.join(td, "full.gds")
            E.export_gds(db, cv, g1)
            base = CellView(db, cv.lib, "vv_instances_only", cv.view)
            base.instances = cv.instances
            g0 = os.path.join(td, "base.gds")
            E.export_gds(db, base, g0)
            try:
                now = R.official_drc(g1, cv.cell, deck, beol=True, feol=feol)
                ref = R.official_drc(g0, "vv_instances_only", deck, beol=True, feol=feol)
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                raise SkillError(f"*Error* {name}: {exc}")
        new = [[k, n - ref.get(k, 0)] for k, n in sorted(now.items()) if n - ref.get(k, 0) > 0]
        return new, deck, feol, sum(min(n, ref.get(k, 0)) for k, n in now.items())

    def v_official(cv, *opts):
        new, _deck, _feol, _left_out = official_new(cv, opts, "vvOfficialDrc")
        return new or None  # nil = no violation in the deck groups that ran; vvOfficialDrcReport names them

    def v_official_report(cv, *opts):
        new, deck, feol, left_out = official_new(cv, opts, "vvOfficialDrcReport")
        ran = ["beol (met1-met5, li1, vias, mcon)"] + (["feol (poly, diff, wells, implants, licon)"] if feol else [])
        not_ran = ([] if feol else ["feol (poly, diff, wells, implants, licon): pass 'feol' to run"]) + [
            "offgrid, seal ring, floating-metal checks (deck groups left off)", "density rules", "LVS and extraction"]
        return [["status", "violations" if new else "clean_in_scope"], ["deck", os.path.basename(deck)], ["deckRelease", R.deck_release(deck)],
                ["groupsRun", ran], ["notRun", not_ran], ["excludedBecauseInPlacedCells", left_out],
                ["violations", [rec(("rule", k), ("count", n)) for k, n in new] or None]]

    F["vvOfficialDrc"] = v_official
    F["vvOfficialDrcReport"] = v_official_report

    # ------------------------------------------------------------------ rule-aware routing
    ROUTE_LIMITS = ["checked only against shapes already in this cellview, as bounding boxes (conservative)",
                    "single layer, no via insertion; no net/connectivity awareness",
                    "result is legal for the width/space rules in force, not a DRC-clean guarantee: run vvCheckReport"]

    def v_route(cv, layer, p0, p1, *rest, **kw):
        if not isinstance(cv, CellView) or cv.readonly:
            raise SkillError("*Error* vvRoute: argument #1 should be a cellview open for edit")
        layer = canon(layer, "vvRoute")
        w, s = wire_params(layer)
        a, b = _pt(p0), _pt(p1)
        a, b = (snap(a[0]), snap(a[1])), (snap(b[0]), snap(b[1]))
        res = R.route(a, b, w, s, obstacles(cv, layer), prefer=hb.directions.get(layer), snap=hb.snap)
        if res is None:
            raise SkillError(f"*Error* vvRoute: no legal {layer} route found from {list(a)} to {list(b)} with width {w:g} and space {s:g} among "
                             "straight/L/Z/S candidates. This is not proof that none exists (obstacles are judged by their bounding boxes, "
                             "which is conservative for non-rectangular shapes); try another layer, move an endpoint, or move the blocking shapes")
        pts, how = res
        sh = Shape(cv, "path", layer, "drawing", [(x, y) for x, y in pts], w, style="truncateExtend")
        cv.shapes.append(sh)
        cv.dirty = True
        points = [[x, y] for x, y in pts]
        if kw.get("positional"):
            return [how, w, s, points, ROUTE_LIMITS]
        return rec(("how", how), ("width", w), ("space", s), ("points", points), ("limitations", ROUTE_LIMITS))

    F["vvRoute"] = v_route

    # ------------------------------------------------------------------ via stacks with the "N vias" habit
    def v_via_stack(cv, xy, lower, upper):
        if not isinstance(cv, CellView) or cv.readonly:
            raise SkillError("*Error* vvViaStack: argument #1 should be a cellview open for edit")
        lo, up = canon(lower, "vvViaStack"), canon(upper, "vvViaStack")
        chain = ["li1", "met1", "met2", "met3", "met4", "met5"]
        if lo not in chain or up not in chain or chain.index(lo) >= chain.index(up):
            raise SkillError("*Error* vvViaStack: need lower < upper in li1 met1 met2 met3 met4 met5")
        names = {("li1", "met1"): "mcon", ("met1", "met2"): "via", ("met2", "met3"): "via2", ("met3", "met4"): "via3", ("met4", "met5"): "via4"}
        x, y = _pt(xy)
        made = []
        for a, b in zip(chain[chain.index(lo):], chain[chain.index(lo) + 1:chain.index(up) + 1]):
            vd = db.viadefs[names[(a, b)]]
            cols = max(1, hb.vias)
            pitch = vd.spec["cut_size"] + (rs.get(vd.spec["cut"], "minSpace") or 0.2) * hb.space_multiple
            v = Via(cv, vd, (snap(x), snap(y)), "R0", 1, cols, pitch)
            cv.vias.append(v)
            made.append(vd.name)
        cv.dirty = True
        return made

    F["vvViaStack"] = v_via_stack

    # ------------------------------------------------------------------ habit-aware row placement
    def v_place_row(cv, prefix, cells, xy, row_index=0, **kw):
        if not isinstance(cv, CellView) or cv.readonly:
            raise SkillError("*Error* vvPlaceRow: argument #1 should be a cellview open for edit")
        std = db.std_name
        x, y = _pt(xy)
        names = list(cells) if isinstance(cells, list) else [cells]
        seq = ([hb.tap] if hb.tap and hb.tap_ends else []) + [n if n.startswith(std) else f"{std}__{n}" for n in names] + ([hb.tap] if hb.tap and hb.tap_ends else [])
        flip = hb.flip_rows and int(row_index) % 2 == 1
        out = []
        for k, cname in enumerate(seq):
            m = db.stdlib.masters.get(cname)
            if m is None:
                raise SkillError(f"*Error* vvPlaceRow: no such standard cell {cname}")
            master = db.open_cv(std, cname, "layout", None, "r")
            nm = f"{prefix}_TAP{0 if k == 0 else 1}" if cname == hb.tap and hb.tap_ends and k in (0, len(seq) - 1) else f"{prefix}{k}"
            orient = "MX" if flip else "R0"
            inst = Instance(cv, master, nm, (snap(x), snap(y + (m.height if flip else 0.0))), orient)
            cv.instances.append(inst)
            out.append([nm, cname.replace(std + "__", ""), snap(x), orient] if kw.get("positional")
                       else rec(("name", nm), ("cell", cname.replace(std + "__", "")), ("x", snap(x)), ("orient", orient)))
            x += m.width + (hb.cell_gap if k < len(seq) - 1 else 0.0)
        cv.dirty = True
        return out

    F["vvPlaceRow"] = v_place_row

    def v_pin_xy(cv, inst_name, pin):
        inst = next((i for i in cv.instances if i.name == str(inst_name)), None)
        if inst is None:
            raise SkillError(f"*Error* vvPinXY: no instance {inst_name} in {cv.cell}")
        sl = db.std.get(inst.master.lib)
        m = sl.masters.get(inst.master.cell) if sl else None
        if m is None or str(pin) not in m.pins or not m.pins[str(pin)].rects:
            raise SkillError(f"*Error* vvPinXY: cell {inst.master.cell} has no pin {pin}")
        lay, x0, y0, x1, y1 = m.pins[str(pin)].rects[0]
        x, y = transform_point(((x0 + x1) / 2.0, (y0 + y1) / 2.0), inst.origin, inst.orient)
        return [round(x, 4), round(y, 4)]

    F["vvPinXY"] = v_pin_xy
    return st
