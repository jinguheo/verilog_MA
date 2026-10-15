"""Expand a Maestro setup into simulation points, run them in parallel with ngspice, evaluate outputs and specs, store the history.

Points: for each enabled test, for each enabled corner (or one nominal point when there is no enabled corner), the cartesian product of
every variable that holds a list ("1p,100f" or "from:step:to"). Variable precedence: corner > test > parameters > global.
In Monte Carlo mode each (test, corner) gets `points` samples; variables with a distribution are perturbed, the rest stay nominal.
"""
from __future__ import annotations

import itertools
import os
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import calc, deck, engine, results as R, units
from .calc import Calc, CalcError, Wave
from .deck import DeckError, PointSpec
from .schematic import Store as SchStore, find_master
from .setup import Setup, SetupError, TEMP_VARS, Test


class RunError(Exception):
    pass


@dataclass
class PointPlan:
    id: int
    test: str
    corner: str | None
    vars: dict[str, str]
    sweep_index: int = 0
    mc_index: int | None = None


@dataclass
class Job:
    history: str
    total: int = 0
    done: int = 0
    status: str = "running"            # running | done | failed | cancelled
    error: str = ""
    started: float = field(default_factory=time.time)
    finished: float = 0.0
    cancel_flag: bool = False
    thread: threading.Thread | None = None
    callback: str | None = None
    summary: dict | None = None

    def cancel(self) -> None:
        self.cancel_flag = True


# ----------------------------------------------------------------------------------------------- planning
def _merged_vars(setup: Setup, test: Test, corner: str | None) -> dict[str, str]:
    v: dict[str, str] = {}
    v.update(setup.vars)
    v.update(setup.parameters)
    v.update(test.vars)
    if corner:
        v.update(setup.corners[corner].vars)
    return v


def _sample(setup: Setup, nominal: dict[str, str], rng: np.random.RandomState) -> dict[str, str]:
    out = dict(nominal)
    for name, d in setup.monte_carlo.dists.items():
        base = d.get("mean", nominal.get(name))
        if base is None:
            raise RunError(f"Monte Carlo variable {name!r} has no value and no mean")
        mean = units.si(base)
        kind = str(d.get("dist", "gaussian")).lower()

        def spread(key: str) -> float:
            raw = str(d.get(key, "0"))
            return abs(mean) * float(raw.rstrip("% ")) / 100.0 if raw.strip().endswith("%") else abs(units.si(raw))
        if kind in ("gaussian", "normal", "gauss"):
            val = rng.normal(mean, spread("sigma"))
        elif kind == "uniform":
            if "lo" in d and "hi" in d:
                val = rng.uniform(units.si(d["lo"]), units.si(d["hi"]))
            else:
                tol = spread("tol")
                val = rng.uniform(mean - tol, mean + tol)
        else:
            raise RunError(f"Monte Carlo distribution {kind!r} is not supported (gaussian, uniform)")
        out[name] = repr(float(val))
    return out


def plan(setup: Setup, only_tests: list[str] | None = None) -> list[PointPlan]:
    plans: list[PointPlan] = []
    n = 0
    tests = [t for t in setup.tests.values() if t.enabled and (not only_tests or t.name in only_tests)]
    if not tests:
        raise RunError("no enabled test to run")
    mc = setup.run_mode == "Monte Carlo Sampling"
    enabled_corners = [c.name for c in setup.corners.values() if c.enabled]
    for t in tests:
        corners: list[str | None] = [c for c in enabled_corners if t.name not in setup.corners[c].disable_tests] or ([] if enabled_corners else [None])
        if enabled_corners and not corners:
            continue
        for cn in corners:
            merged = _merged_vars(setup, t, cn)
            if mc:
                rng = np.random.RandomState(setup.monte_carlo.seed + 7919 * (len(plans) + 1))
                lists = {k: units.split_values(v) for k, v in merged.items()}
                nominal = {k: (vals[0] if vals else v) for (k, vals), v in zip(lists.items(), merged.values())}
                for i in range(setup.monte_carlo.points):
                    n += 1
                    plans.append(PointPlan(n, t.name, cn, _sample(setup, nominal, rng), 0, i + 1))
                continue
            names = sorted(merged)
            lists = [units.split_values(merged[k]) or [merged[k]] for k in names]
            for k, combo in enumerate(itertools.product(*lists) if names else [()]):
                n += 1
                plans.append(PointPlan(n, t.name, cn, dict(zip(names, combo)), k))
    if not plans:
        raise RunError("nothing to run: every enabled corner is disabled for the enabled tests")
    return plans


# ----------------------------------------------------------------------------------------------- one point
def _point_spec(setup: Setup, t: Test, p: PointPlan) -> PointSpec:
    variables = dict(p.vars)
    temp = None
    for k in TEMP_VARS:
        if k in variables:
            temp = units.si(variables.pop(k))
    model_files = list(t.model_files)
    if p.corner and setup.corners[p.corner].models:
        cm = [(m["file"], m.get("section", "")) for m in setup.corners[p.corner].models if m.get("test", "All") in ("All", t.name)]
        if cm:
            model_files = cm
    return PointSpec(t.lib or setup.lib, t.cell or setup.cell, t.enabled_analyses(), variables, temp, model_files, dict(t.sim_options), list(t.includes),
                     title=f"{setup.lib}/{setup.cell} {t.name} point {p.id}", initial=dict(t.initial))


def _current_resolver(top, plots):
    def current(name: str, kind: str):
        parts = [x for x in str(name).strip().split("/") if x]
        inst = top.insts.get(parts[0]) if parts else None
        if inst is None:
            return None
        m = find_master(inst.lib, inst.cell)
        if m is None or m.build is None:
            return None
        sn = deck.spice_inst_name(m.prefix, inst.name).lower()
        p = plots.get(kind)
        if p is None:
            return None
        arr = p.data.get(f"i({sn})")
        if arr is None:
            arr = p.data.get(f"i(@{sn}[i])")
        if arr is None:
            return None
        pin = parts[1] if len(parts) > 1 else m.pins[0]
        sign = 1.0 if pin == m.pins[0] else (-1.0 if len(m.pins) > 1 and pin == m.pins[1] else None)
        if sign is None:
            return None
        if kind == "op":
            return float(np.real(arr[0])) * sign
        x = np.real(p.data[p.x_name])
        return Wave(x, arr * sign, p.x_name, f"i({name})", logx=(kind in ("ac", "noise")))
    return current


def evaluate_point(setup: Setup, t: Test, plots: dict, kinds: list[str], p: PointPlan, top) -> tuple[dict, dict[str, Wave]]:
    """Evaluate every output of the test against the saved plots. Returns ({output: record}, {output: Wave})."""
    default = kinds[0] if len(kinds) == 1 else None
    c = Calc(plots, default=default, current=_current_resolver(top, plots), params={k: units.si(v) for k, v in p.vars.items() if units.is_number(v)})
    outs: dict[str, dict] = {}
    waves: dict[str, Wave] = {}
    for name, o in t.outputs.items():
        rec: dict[str, Any] = {"expr": o.expression()}
        try:
            r = c.eval(o.expression())
        except CalcError as exc:
            rec.update(kind="error", error=str(exc))
            r = None
        else:
            if isinstance(r, Wave):
                rec["kind"] = "wave"
                waves[name] = r
                rec["points"] = int(len(r.x))
            elif isinstance(r, (list, str)):
                rec.update(kind="text", text=str(r))
            elif r is None:
                rec.update(kind="nil")
            else:
                v = calc.to_scalar(r)
                if v is None:
                    rec.update(kind="text", text=str(r))
                else:
                    rec.update(kind="scalar", value=v)
                    if isinstance(r, complex):
                        rec["complex"] = {"re": r.real, "im": r.imag}
        sp = setup.spec(t.name, name)
        if sp is not None:
            rec["spec"] = sp.text()
            if rec.get("kind") == "scalar":
                rec["spec_status"] = "pass" if sp.check(rec["value"]) else "fail"
            else:
                rec["spec_status"] = "fail"        # no number to compare: a spec cannot be met
        outs[name] = rec
    return outs, waves


def run_point(setup: Setup, store: SchStore, hist: R.HistoryStore, history: str, p: PointPlan) -> dict:
    t = setup.test(p.test)
    pd = hist.point_dir(history, p.test, p.id)
    os.makedirs(pd, exist_ok=True)
    rec: dict[str, Any] = {"id": p.id, "test": p.test, "corner": p.corner, "vars": p.vars, "sweep_index": p.sweep_index, "mc_index": p.mc_index,
                           "ok": False, "errors": [], "warnings": [], "outputs": {}, "seconds": 0.0}
    try:
        top = store.load(t.lib or setup.lib, t.cell or setup.cell)
        d = deck.build(_point_spec(setup, t, p), store)
    except (DeckError, Exception) as exc:           # a broken setup fails that point, not the whole run
        rec["errors"].append(str(exc))
        return rec
    rec["notes"] = d.notes
    res = engine.run(d.text, pd, "ngspice", timeout=float(setup.job.get("timeout", 600)))
    rec["seconds"] = round(res.seconds, 3)
    rec["warnings"] = res.warnings[:5]
    if not res.ok:
        rec["errors"] = res.errors[:5] or ["ngspice produced no results"]
        return rec
    R.save_plots(os.path.join(pd, "plots.npz"), res.plots)
    plots = {pl.kind(): pl for pl in res.plots}
    try:
        outs, waves = evaluate_point(setup, t, plots, d.kinds, p, top)
    except Exception as exc:                          # evaluation bug must not look like a simulation failure
        rec["errors"].append(f"evaluating outputs: {exc}")
        rec["trace"] = traceback.format_exc(limit=3)
        return rec
    if waves:
        R.save_waves(os.path.join(pd, "outputs.npz"), waves)
    rec["outputs"] = outs
    rec["ok"] = True
    rec["dir"] = os.path.relpath(pd, hist.path(history)).replace(os.sep, "/")
    return rec


# ----------------------------------------------------------------------------------------------- whole run
def run(setup: Setup, store: SchStore, hist: R.HistoryStore, history: str, job: Job | None = None, only_tests: list[str] | None = None) -> dict:
    plans = plan(setup, only_tests)
    if job is not None:
        job.total = len(plans)
    summary: dict[str, Any] = {"history": history, "lib": setup.lib, "cell": setup.cell, "created": R.now(), "mode": setup.run_mode, "status": "running",
                               "simulator": f"ngspice {engine.version() or '?'}", "points": [], "tests": sorted({p.test for p in plans}), "total": len(plans),
                               "setup": setup.to_json()}
    hist.write(history, summary)
    workers = max(1, int(setup.job.get("maxJobs", 4)))
    done: list[dict] = []
    lock = threading.Lock()

    def work(p: PointPlan) -> dict:
        if job is not None and job.cancel_flag:
            return {"id": p.id, "test": p.test, "corner": p.corner, "vars": p.vars, "ok": False, "errors": ["cancelled"], "outputs": {}, "cancelled": True}
        r = run_point(setup, store, hist, history, p)
        with lock:
            done.append(r)
            if job is not None:
                job.done = len(done)
        return r

    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(work, plans))
    summary["points"] = sorted(results, key=lambda r: r["id"])
    cancelled = job is not None and job.cancel_flag
    summary["status"] = "cancelled" if cancelled else "done"
    summary["finished"] = R.now()
    summary["overall"] = R.overall(summary)
    summary["seconds"] = round(sum(r.get("seconds", 0.0) for r in results), 3)
    hist.write(history, summary)
    return summary


def reevaluate(setup: Setup, store: SchStore, hist: R.HistoryStore, history: str) -> dict:
    """Re-evaluate the current outputs and specs of `setup` on the saved waveforms of a finished run (no simulation)."""
    summary = hist.read(history)
    for rec in summary["points"]:
        if not rec.get("ok"):
            continue
        t = setup.tests.get(rec["test"])
        if t is None:
            continue
        pd = os.path.join(hist.path(history), rec["dir"])
        plots = R.load_plots(os.path.join(pd, "plots.npz"))
        top = store.load(t.lib or setup.lib, t.cell or setup.cell)
        kinds = [k for k in plots if k not in ("noise_int",)]
        p = PointPlan(rec["id"], rec["test"], rec.get("corner"), rec.get("vars", {}), rec.get("sweep_index", 0), rec.get("mc_index"))
        outs, waves = evaluate_point(setup, t, plots, kinds, p, top)
        rec["outputs"] = outs
        if waves:
            R.save_waves(os.path.join(pd, "outputs.npz"), waves)
    summary["overall"] = R.overall(summary)
    summary["reevaluated"] = R.now()
    hist.write(history, summary)
    return summary
