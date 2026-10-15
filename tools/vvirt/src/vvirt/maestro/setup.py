"""Maestro setup model: tests, analyses, outputs, specs, variables, corners, run mode, Monte Carlo, histories. JSON on disk.

Layout under <store root>/<lib>/<cell>/maestro/ :
    setup.json                       the saved setup
    results/<history>/               one folder per run (see runner.py / results.py)
Changes made through a session stay in memory until saved (maeSaveSetup), like Maestro.
"""
from __future__ import annotations

import copy
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any

from . import units
from .deck import ANALYSES

SCHEMA = 1
RUN_MODES = ("Single Run, Sweeps and Corners", "Monte Carlo Sampling", "Global Optimization", "Local Optimization", "Improve Yield")
SUPPORTED_MODES = RUN_MODES[:2]
SPEC_KEYS = ("lt", "gt", "minimum", "maximum", "tolerance", "target")
ANALYSIS_ALIASES = {"dcop": "op", "dc": "dc", "ac": "ac", "tran": "tran", "noise": "noise", "tf": "tf", "op": "op"}
TEMP_VARS = ("temperature", "temp")


class SetupError(Exception):
    pass


def _s(v: Any) -> str:
    """Option/var values are kept as strings (t/nil become "t"/"nil"; lists keep their text)."""
    if v is None:
        return "nil"
    if v is True:
        return "t"
    if isinstance(v, float):
        return repr(v)
    return str(v)


@dataclass
class Output:
    name: str
    test: str
    otype: str = "point"            # "net" (a waveform) | "point" (an expression -> number) | "signal"
    expr: str = ""                  # expression for "point"
    signal: str = ""                # net name for "net"/"signal"
    plot: bool = True
    save: bool = True

    def expression(self) -> str:
        if self.otype in ("net", "signal"):
            return self.expr or f'v("{self.signal}")'
        return self.expr


@dataclass
class Spec:
    output: str
    test: str
    lt: str | None = None
    gt: str | None = None
    minimum: str | None = None
    maximum: str | None = None
    tolerance: str | None = None
    target: str | None = None

    def check(self, value: float) -> bool:
        ok = True
        if self.lt is not None:
            ok &= value < units.si(self.lt)
        if self.gt is not None:
            ok &= value > units.si(self.gt)
        if self.minimum is not None:
            ok &= value >= units.si(self.minimum)
        if self.maximum is not None:
            ok &= value <= units.si(self.maximum)
        if self.target is not None:
            tgt = units.si(self.target)
            tol = 0.0 if self.tolerance is None else (abs(tgt) * float(str(self.tolerance).rstrip("% ")) / 100.0 if str(self.tolerance).strip().endswith("%") else abs(units.si(self.tolerance)))
            ok &= abs(value - tgt) <= tol
        return bool(ok)

    def text(self) -> str:
        parts = []
        if self.lt is not None: parts.append(f"< {self.lt}")
        if self.gt is not None: parts.append(f"> {self.gt}")
        if self.minimum is not None: parts.append(f">= {self.minimum}")
        if self.maximum is not None: parts.append(f"<= {self.maximum}")
        if self.target is not None: parts.append(f"= {self.target}" + (f" +/- {self.tolerance}" if self.tolerance is not None else ""))
        return " and ".join(parts)

    def active(self) -> bool:
        return any(getattr(self, k) is not None for k in SPEC_KEYS)


@dataclass
class Test:
    name: str
    lib: str = ""
    cell: str = ""
    view: str = "schematic"
    simulator: str = "ngspice"
    enabled: bool = True
    analyses: dict[str, dict[str, Any]] = field(default_factory=dict)   # type -> {"enable": bool, "options": {k: v}}
    outputs: dict[str, Output] = field(default_factory=dict)
    vars: dict[str, str] = field(default_factory=dict)
    model_files: list[tuple[str, str]] = field(default_factory=list)
    sim_options: dict[str, str] = field(default_factory=dict)
    includes: list[str] = field(default_factory=list)
    initial: dict[str, str] = field(default_factory=dict)
    env: dict[str, Any] = field(default_factory=dict)

    def enabled_analyses(self) -> list[tuple[str, dict[str, str]]]:
        order = {"op": 0, "dc": 1, "tf": 2, "ac": 3, "noise": 4, "tran": 5}
        out = [(k, dict(v.get("options", {}))) for k, v in self.analyses.items() if v.get("enable", True)]
        return sorted(out, key=lambda kv: order.get(kv[0], 9))


@dataclass
class Corner:
    name: str
    enabled: bool = True
    vars: dict[str, str] = field(default_factory=dict)
    models: list[dict[str, str]] = field(default_factory=list)      # {"file":..., "section":..., "test": "All"}
    disable_tests: list[str] = field(default_factory=list)


@dataclass
class MonteCarlo:
    points: int = 20
    seed: int = 1
    dists: dict[str, dict[str, Any]] = field(default_factory=dict)    # var -> {"dist": "gaussian"|"uniform", "mean": .., "sigma": .., "lo": .., "hi": ..}
    enabled: bool = False


@dataclass
class Setup:
    lib: str
    cell: str
    view: str = "maestro"
    tests: dict[str, Test] = field(default_factory=dict)
    vars: dict[str, str] = field(default_factory=dict)
    parameters: dict[str, str] = field(default_factory=dict)
    corners: dict[str, Corner] = field(default_factory=dict)
    specs: list[Spec] = field(default_factory=list)
    run_mode: str = RUN_MODES[0]
    monte_carlo: MonteCarlo = field(default_factory=MonteCarlo)
    job: dict[str, Any] = field(default_factory=lambda: {"maxJobs": 4, "controlMode": "Local", "policy": "default"})
    histories: dict[str, dict[str, Any]] = field(default_factory=dict)  # name -> {"locked": bool, "created": ..., "comment": ...}
    next_run: int = 1
    notes: dict[str, str] = field(default_factory=dict)

    # ---- tests ----
    def test(self, name: str) -> Test:
        if name not in self.tests:
            raise SetupError(f"test {name!r} does not exist; tests: {', '.join(self.tests) or 'none'}")
        return self.tests[name]

    def create_test(self, name: str, lib: str = "", cell: str = "", view: str = "schematic", simulator: str = "ngspice", source: str | None = None) -> Test:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise SetupError(f"bad test name {name!r}")
        if name in self.tests:
            raise SetupError(f"test {name!r} already exists")
        if source:
            t = copy.deepcopy(self.test(source))
            t.name = name
            for o in t.outputs.values():
                o.test = name
            self.tests[name] = t
            return t
        t = Test(name, lib or self.lib, cell or self.cell, view, simulator)
        self.tests[name] = t
        return t

    def delete_test(self, name: str) -> None:
        self.test(name)
        del self.tests[name]
        self.specs = [sp for sp in self.specs if sp.test != name]

    # ---- analyses ----
    def set_analysis(self, test: str, kind: str, enable: bool | None = None, options: dict[str, Any] | None = None) -> dict:
        t = self.test(test)
        k = ANALYSIS_ALIASES.get(kind.lower(), kind.lower())
        if k not in ANALYSES:
            raise SetupError(f"analysis {kind!r} is not supported (supported: {', '.join(ANALYSES)})")
        a = t.analyses.setdefault(k, {"enable": True, "options": {}})
        if enable is not None:
            a["enable"] = bool(enable)
        if options:
            for key, v in options.items():
                a["options"][str(key)] = _s(v)
        return a

    def get_analysis(self, test: str, kind: str) -> dict:
        t = self.test(test)
        k = ANALYSIS_ALIASES.get(kind.lower(), kind.lower())
        if k not in t.analyses:
            raise SetupError(f"test {test} has no {kind} analysis")
        return t.analyses[k]

    # ---- outputs and specs ----
    def add_output(self, name: str, test: str, otype: str = "point", expr: str = "", signal: str = "", plot: bool = True) -> Output:
        t = self.test(test)
        if otype not in ("net", "point", "signal"):
            raise SetupError(f'output type must be "net", "point" or "signal", not {otype!r}')
        if otype == "point" and not expr:
            raise SetupError("a point output needs an expression (?expr)")
        if otype in ("net", "signal") and not (signal or expr):
            raise SetupError("a net/signal output needs ?signalName")
        o = Output(name, test, otype, expr, signal, plot)
        t.outputs[name] = o
        return o

    def delete_output(self, name: str, test: str) -> None:
        t = self.test(test)
        if name not in t.outputs:
            raise SetupError(f"output {name!r} does not exist in test {test}")
        del t.outputs[name]
        self.specs = [sp for sp in self.specs if not (sp.test == test and sp.output == name)]

    def set_spec(self, name: str, test: str, **kw: Any) -> Spec:
        t = self.test(test)
        if name not in t.outputs:
            raise SetupError(f"output {name!r} does not exist in test {test}; outputs: {', '.join(t.outputs) or 'none'}")
        bad = [k for k in kw if k not in SPEC_KEYS]
        if bad:
            raise SetupError(f"unknown spec option(s) {', '.join(bad)}; use {', '.join('?' + k for k in SPEC_KEYS)}")
        for k, v in kw.items():
            if v is not None and not units.is_number(str(v).rstrip("%") if k == "tolerance" else v):
                raise SetupError(f"spec ?{k} must be a number, got {v!r}")
        sp = Spec(name, test, **{k: (None if v is None else _s(v)) for k, v in kw.items()})
        self.specs = [x for x in self.specs if not (x.test == test and x.output == name)]
        if sp.active():
            self.specs.append(sp)
        return sp

    def spec(self, test: str, output: str) -> Spec | None:
        for sp in self.specs:
            if sp.test == test and sp.output == output:
                return sp
        return None

    # ---- variables, corners ----
    def set_var(self, name: str, value: Any, scope: str = "global", scope_name: str | None = None) -> None:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise SetupError(f"variable name {name!r} is not a valid identifier")
        v = _s(value)
        if scope == "corner":
            if not scope_name or scope_name not in self.corners:
                raise SetupError(f"corner {scope_name!r} does not exist")
            self.corners[scope_name].vars[name] = v
        elif scope == "test":
            self.test(scope_name or "").vars[name] = v
        elif scope == "global":
            self.vars[name] = v
        else:
            raise SetupError(f"variable scope must be global, corner or test, not {scope!r}")

    def get_var(self, name: str, scope: str = "global", scope_name: str | None = None) -> str | None:
        if scope == "corner":
            return self.corners[scope_name].vars.get(name) if scope_name in self.corners else None
        if scope == "test":
            return self.test(scope_name or "").vars.get(name)
        return self.vars.get(name)

    def delete_var(self, name: str, scope: str = "global", scope_name: str | None = None) -> bool:
        d = self.corners[scope_name].vars if scope == "corner" and scope_name in self.corners else (self.test(scope_name or "").vars if scope == "test" else self.vars)
        return d.pop(name, None) is not None

    def set_corner(self, name: str, enabled: bool | None = None, disable_tests: list[str] | None = None) -> Corner:
        c = self.corners.setdefault(name, Corner(name))
        if enabled is not None:
            c.enabled = bool(enabled)
        if disable_tests is not None:
            c.disable_tests = list(disable_tests)
        return c

    def delete_corner(self, name: str) -> bool:
        return self.corners.pop(name, None) is not None

    def set_run_mode(self, mode: str) -> None:
        if mode not in RUN_MODES:
            raise SetupError(f"unknown run mode {mode!r}; modes: {', '.join(RUN_MODES)}")
        if mode not in SUPPORTED_MODES:
            raise SetupError(f"run mode {mode!r} is not supported by vvirt Maestro (supported: {', '.join(SUPPORTED_MODES)})")
        self.run_mode = mode

    # ---- persistence ----
    def to_json(self) -> dict:
        def test_json(t: Test) -> dict:
            return {"name": t.name, "lib": t.lib, "cell": t.cell, "view": t.view, "simulator": t.simulator, "enabled": t.enabled, "analyses": t.analyses,
                    "outputs": [{"name": o.name, "otype": o.otype, "expr": o.expr, "signal": o.signal, "plot": o.plot, "save": o.save} for o in t.outputs.values()],
                    "vars": t.vars, "model_files": [list(m) for m in t.model_files], "sim_options": t.sim_options, "includes": t.includes, "initial": t.initial, "env": t.env}
        return {"schema": SCHEMA, "lib": self.lib, "cell": self.cell, "view": self.view, "run_mode": self.run_mode,
                "tests": [test_json(t) for t in self.tests.values()], "vars": self.vars, "parameters": self.parameters,
                "specs": [{"test": sp.test, "output": sp.output, **{k: getattr(sp, k) for k in SPEC_KEYS if getattr(sp, k) is not None}} for sp in self.specs],
                "corners": [{"name": c.name, "enabled": c.enabled, "vars": c.vars, "models": c.models, "disable_tests": c.disable_tests} for c in self.corners.values()],
                "monte_carlo": {"points": self.monte_carlo.points, "seed": self.monte_carlo.seed, "dists": self.monte_carlo.dists, "enabled": self.monte_carlo.enabled},
                "job": self.job, "histories": self.histories, "next_run": self.next_run, "notes": self.notes}

    @staticmethod
    def from_json(d: dict) -> "Setup":
        s = Setup(d["lib"], d["cell"], d.get("view", "maestro"), vars=dict(d.get("vars", {})), parameters=dict(d.get("parameters", {})), run_mode=d.get("run_mode", RUN_MODES[0]),
                  job=dict(d.get("job", {})), histories=dict(d.get("histories", {})), next_run=int(d.get("next_run", 1)), notes=dict(d.get("notes", {})))
        for t in d.get("tests", []):
            tt = Test(t["name"], t.get("lib", ""), t.get("cell", ""), t.get("view", "schematic"), t.get("simulator", "ngspice"), t.get("enabled", True),
                      analyses=t.get("analyses", {}), vars=dict(t.get("vars", {})), model_files=[tuple(m) for m in t.get("model_files", [])],
                      sim_options=dict(t.get("sim_options", {})), includes=list(t.get("includes", [])), initial=dict(t.get("initial", {})), env=dict(t.get("env", {})))
            for o in t.get("outputs", []):
                tt.outputs[o["name"]] = Output(o["name"], tt.name, o.get("otype", "point"), o.get("expr", ""), o.get("signal", ""), o.get("plot", True), o.get("save", True))
            s.tests[tt.name] = tt
        for sp in d.get("specs", []):
            s.specs.append(Spec(sp["output"], sp["test"], **{k: sp.get(k) for k in SPEC_KEYS}))
        for c in d.get("corners", []):
            s.corners[c["name"]] = Corner(c["name"], c.get("enabled", True), dict(c.get("vars", {})), list(c.get("models", [])), list(c.get("disable_tests", [])))
        mc = d.get("monte_carlo", {})
        s.monte_carlo = MonteCarlo(int(mc.get("points", 20)), int(mc.get("seed", 1)), dict(mc.get("dists", {})), bool(mc.get("enabled", False)))
        return s


class SetupStore:
    def __init__(self, root: str) -> None:
        self.root = root

    def dir(self, lib: str, cell: str) -> str:
        for part in (lib, cell):
            if not re.fullmatch(r"[A-Za-z0-9_.$+-]+", part) or part in (".", ".."):
                raise SetupError(f"bad library/cell name {part!r}")
        return os.path.join(self.root, lib, cell, "maestro")

    def path(self, lib: str, cell: str) -> str:
        return os.path.join(self.dir(lib, cell), "setup.json")

    def exists(self, lib: str, cell: str) -> bool:
        return os.path.isfile(self.path(lib, cell))

    def load(self, lib: str, cell: str) -> Setup:
        p = self.path(lib, cell)
        if not os.path.isfile(p):
            raise SetupError(f"maestro view {lib}/{cell}/maestro does not exist")
        with open(p, encoding="utf-8") as fh:
            return Setup.from_json(json.load(fh))

    def save(self, s: Setup) -> str:
        os.makedirs(self.dir(s.lib, s.cell), exist_ok=True)
        p = self.path(s.lib, s.cell)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(s.to_json(), fh, indent=1)
        os.replace(tmp, p)
        return p

    def results_dir(self, lib: str, cell: str) -> str:
        return os.path.join(self.dir(lib, cell), "results")
