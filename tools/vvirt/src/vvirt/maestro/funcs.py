"""SKILL functions of vvirt Maestro: mae* / asi* / axl* (Cadence names, working subset) and vvSch* / vvMae* (vvirt additions).

Design notes
  * A session holds an in-memory copy of the setup; edits reach disk only at maeSaveSetup (closing without saving drops them).
  * maeRunSimulation snapshots the setup and runs in a background thread; maeWaitUntilDone joins it. ?callback is called by
    maeWaitUntilDone on the calling thread (the interpreter is not re-entered from the run thread).
  * Files read or written through SKILL are confined to the workspace, /tmp and the PDK.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading
from typing import Any

from .. import records
from ..skill_lang import Interp, SkillError
from . import deck as deckmod, engine, results as R, runner, schematic as S, units
from .calc import Calc, CalcError, Wave
from .setup import Setup, SetupError, SetupStore


def _opts(v: Any) -> dict[str, Any]:
    """?options '(("start" "1") ("stop" "10G")) -> {"start": "1", ...}"""
    if v is None:
        return {}
    if isinstance(v, dict):
        return dict(v)
    out: dict[str, Any] = {}
    for item in v:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            out[str(item[0])] = item[1] if len(item) == 2 else list(item[1:])
        else:
            raise SkillError("*Error* options must be a list of (\"name\" value) pairs", v)
    return out


def _pairs(v: Any) -> dict[str, str]:
    return {str(k): ("nil" if x is None else str(x)) for k, x in _opts(v).items()}


def _str(v: Any) -> str:
    return str(v)


class OutputObj:
    """What maeGetTestOutputs returns: attribute access with ~>name ~>outputType ~>signalName ~>expr."""

    def __init__(self, o) -> None:
        self.o = o

    def skill_get(self, name: str):
        return {"name": self.o.name, "outputType": self.o.otype, "signalName": self.o.signal or None, "expr": self.o.expr or None,
                "testName": self.o.test, "plot": True if self.o.plot else None}.get(name)

    def __repr__(self) -> str:
        return f"<output {self.o.name}>"


class Session:
    def __init__(self, sid: str, setup: Setup, mode: str, existed: bool) -> None:
        self.id, self.setup, self.mode, self.existed = sid, setup, mode, existed
        self.dirty = not existed


class Service:
    def __init__(self, interp: Interp, workspace: str, out_dir: str, extra_roots: list[str]) -> None:
        self.interp = interp
        self.root = os.path.join(workspace, "maestro")
        self.sch = S.Store(self.root)
        self.sets = SetupStore(self.root)
        self.workspace, self.out_dir = workspace, out_dir
        self.roots = [os.path.realpath(r) for r in ("/tmp", workspace, out_dir, *extra_roots) if r]
        self.sessions: dict[str, Session] = {}
        self.current: str | None = None
        self.counter = 0
        self.jobs: dict[str, runner.Job] = {}
        self.res_ptr: dict[str, str | None] = {"history": None}
        self.handles: dict[int, tuple] = {}
        self.hcount = 7900
        self.lock = threading.Lock()

    # ---- helpers ------------------------------------------------------------------------
    def allowed(self, path: str) -> bool:
        p = os.path.realpath(path)
        return any(p == r or p.startswith(r + os.sep) for r in self.roots)

    def need_path(self, fn: str, path: str, write: bool = False) -> str:
        p = str(path)
        if not self.allowed(p):
            raise SkillError(f"*Error* {fn}: {p} is outside the allowed directories (workspace, /tmp, PDK)")
        return p

    def sess(self, fn: str, sid: Any = None, edit: bool = False) -> Session:
        sid = str(sid) if sid else self.current
        if not sid or sid not in self.sessions:
            raise SkillError(f"*Error* {fn}: no maestro session is open" + (f" ({sid} not found)" if sid else "") + "; call maeOpenSetup first")
        s = self.sessions[sid]
        if edit and s.mode == "r":
            raise SkillError(f"*Error* {fn}: session {sid} is read-only; reopen with ?mode \"a\" or call maeMakeEditable")
        self.current = sid
        return s

    def wrap(self, fn: str, f):
        def g(*a, **kw):
            try:
                return f(*a, **kw)
            except (SetupError, S.SchError, deckmod.DeckError, runner.RunError, R.ResultError, CalcError) as exc:
                raise SkillError(f"*Error* {fn}: {exc}")
        g.__name__ = fn
        return g

    def hist(self, s: Session) -> R.HistoryStore:
        return R.HistoryStore(self.sets.results_dir(s.setup.lib, s.setup.cell))

    def handle(self, kind: tuple) -> int:
        self.hcount += 18
        self.handles[self.hcount] = kind
        return self.hcount

    def snapshot(self, setup: Setup) -> Setup:
        return Setup.from_json(setup.to_json())


def install(interp: Interp, db: Any, out_dir: str) -> Service:
    extra = [db.stdlib.root] if getattr(db, "stdlib", None) and db.stdlib.root else []
    svc = Service(interp, os.path.dirname(os.path.abspath(out_dir)), out_dir, extra)
    F = interp.funcs

    def reg(name: str, f) -> None:
        F[name] = svc.wrap(name, f)

    # ======================================================================== sessions
    def open_setup(lib, cell, view="maestro", **kw):
        lib, cell = str(lib), str(cell)
        mode = str(kw.get("mode") or "r")
        existed = svc.sets.exists(lib, cell)
        if existed:
            setup = svc.sets.load(lib, cell)
        elif mode in ("a", "w"):
            setup = Setup(lib, cell)
        else:
            raise SkillError(f"*Error* maeOpenSetup: maestro view {lib}/{cell}/{view} does not exist (open with ?mode \"a\" to create it)")
        svc.counter += 1
        sid = f"fnxSession{svc.counter}"
        svc.sessions[sid] = Session(sid, setup, "a" if mode in ("a", "w") else "r", existed)
        svc.current = sid
        return sid

    def close_session(*a, **kw):
        sid = str(kw.get("session") or (a[0] if a else svc.current or ""))
        if sid not in svc.sessions:
            return None
        del svc.sessions[sid]
        if svc.current == sid:
            svc.current = next(reversed(svc.sessions), None)
        return True

    def save_setup(*a, **kw):
        s = svc.sess("maeSaveSetup", kw.get("session"))
        if s.mode == "r":
            raise SkillError("*Error* maeSaveSetup: session is read-only")
        svc.sets.save(s.setup)
        s.dirty, s.existed = False, True
        return True

    def make_editable(*a, **kw):
        s = svc.sess("maeMakeEditable", kw.get("session"))
        s.mode = "a"
        return True

    def get_sessions(*a, **kw):
        return list(svc.sessions) or None

    def current_session(*a, **kw):
        return svc.current

    reg("maeOpenSetup", open_setup)
    reg("maeCloseSession", close_session)
    reg("maeSaveSetup", save_setup)
    reg("maeMakeEditable", make_editable)
    reg("maeGetSessions", get_sessions)
    reg("asiGetSessionList", get_sessions)
    reg("asiGetCurrentSession", current_session)
    reg("asiCloseSession", close_session)

    def get_setup(*a, **kw):
        s = svc.sess("maeGetSetup", kw.get("session"))
        tn = str(kw.get("typeName") or "tests")
        if tn == "tests":
            return list(s.setup.tests) or None
        if tn == "corners":
            return list(s.setup.corners) or None
        if tn == "variables":
            return [[k, v] for k, v in s.setup.vars.items()] or None
        if tn == "parameters":
            return [[k, v] for k, v in s.setup.parameters.items()] or None
        raise SkillError(f"*Error* maeGetSetup: ?typeName {tn!r} is not supported (tests, corners, variables, parameters)")

    reg("maeGetSetup", get_setup)

    # ======================================================================== tests, analyses, outputs, specs
    def create_test(name, **kw):
        s = svc.sess("maeCreateTest", kw.get("session"), edit=True)
        s.setup.create_test(str(name), str(kw.get("lib") or ""), str(kw.get("cell") or ""), str(kw.get("view") or "schematic"), str(kw.get("simulator") or "ngspice"),
                            str(kw["sourceTest"]) if kw.get("sourceTest") else None)
        s.dirty = True
        return str(name)

    def delete_test(name, **kw):
        s = svc.sess("maeDeleteTest", kw.get("session"), edit=True)
        s.setup.delete_test(str(name))
        s.dirty = True
        return True

    def set_design(test, lib, cell, view="schematic", **kw):
        s = svc.sess("maeSetDesign", kw.get("session"), edit=True)
        t = s.setup.test(str(test))
        t.lib, t.cell, t.view = str(lib), str(cell), str(view)
        s.dirty = True
        return True

    def set_analysis(test, kind, **kw):
        s = svc.sess("maeSetAnalysis", kw.get("session"), edit=True)
        en = kw.get("enable")
        s.setup.set_analysis(str(test), str(kind), None if "enable" not in kw else (en is not None and en is not False), _opts(kw.get("options")))
        s.dirty = True
        return True

    def get_analysis(test, kind, **kw):
        s = svc.sess("maeGetAnalysis", kw.get("session"))
        a = s.setup.get_analysis(str(test), str(kind))
        return [["anaName", str(kind)]] + [[k, v] for k, v in a["options"].items()]

    def enabled_analysis(test, **kw):
        s = svc.sess("maeGetEnabledAnalysis", kw.get("session"))
        return [k for k, _o in s.setup.test(str(test)).enabled_analyses()] or None

    def add_output(name, test, **kw):
        s = svc.sess("maeAddOutput", kw.get("session"), edit=True)
        plot = kw.get("plot")
        s.setup.add_output(str(name), str(test), str(kw.get("outputType") or "point"), str(kw.get("expr") or ""), str(kw.get("signalName") or ""), plot is not False)
        s.dirty = True
        return str(name)

    def delete_output(name, test, **kw):
        s = svc.sess("maeDeleteOutput", kw.get("session"), edit=True)
        s.setup.delete_output(str(name), str(test))
        s.dirty = True
        return True

    def set_spec(name, test, **kw):
        s = svc.sess("maeSetSpec", kw.get("session"), edit=True)
        spec = {"lt": kw.get("lt"), "gt": kw.get("gt"), "minimum": kw.get("minimum"), "maximum": kw.get("maximum"),
                "tolerance": kw.get("tolerance", kw.get("tolerence")), "target": kw.get("target")}
        s.setup.set_spec(str(name), str(test), **{k: v for k, v in spec.items() if v is not None})
        s.dirty = True
        return True

    def get_spec(name, test, **kw):
        s = svc.sess("maeGetSpec", kw.get("session"))
        sp = s.setup.spec(str(test), str(name))
        return None if sp is None else sp.text()

    def test_outputs(test, **kw):
        s = svc.sess("maeGetTestOutputs", kw.get("session"))
        return [OutputObj(o) for o in s.setup.test(str(test)).outputs.values()] or None

    for n, f in (("maeCreateTest", create_test), ("maeDeleteTest", delete_test), ("maeSetDesign", set_design), ("maeSetAnalysis", set_analysis), ("maeGetAnalysis", get_analysis),
                 ("maeGetEnabledAnalysis", enabled_analysis), ("maeAddOutput", add_output), ("maeDeleteOutput", delete_output), ("maeSetSpec", set_spec), ("maeGetSpec", get_spec),
                 ("maeGetTestOutputs", test_outputs)):
        reg(n, f)

    # ======================================================================== variables, corners, environment
    def scope_of(kw):
        tn = kw.get("typeName")
        if tn is None:
            return "global", None
        tn = str(tn)
        tv = kw.get("typeValue")
        name = str(tv[0]) if isinstance(tv, (list, tuple)) and tv else (str(tv) if tv else None)
        if tn not in ("corner", "test", "global"):
            raise SkillError(f"*Error* ?typeName must be corner, test or global, not {tn!r}")
        return tn, name

    def set_var(name, value, **kw):
        s = svc.sess("maeSetVar", kw.get("session"), edit=True)
        sc, sn = scope_of(kw)
        s.setup.set_var(str(name), value, sc, sn)
        s.dirty = True
        return True

    def get_var(name, **kw):
        s = svc.sess("maeGetVar", kw.get("session"))
        sc, sn = scope_of(kw)
        return s.setup.get_var(str(name), sc, sn)

    def delete_var(name, **kw):
        s = svc.sess("maeDeleteVar", kw.get("session"), edit=True)
        sc, sn = scope_of(kw)
        s.dirty = True
        return True if s.setup.delete_var(str(name), sc, sn) else None

    def design_var_list(sid=None, **kw):
        s = svc.sess("asiGetDesignVarList", sid or kw.get("session"))
        return [[k, v] for k, v in s.setup.vars.items()] or None

    def set_parameter(name, value=None, **kw):
        s = svc.sess("maeSetParameter", kw.get("session"), edit=True)
        v = kw.get("value", value)
        if v is None:
            raise SkillError("*Error* maeSetParameter: ?value is required")
        s.setup.parameters[str(name)] = str(v)
        s.dirty = True
        return True

    def get_parameter(name, **kw):
        s = svc.sess("maeGetParameter", kw.get("session"))
        return s.setup.parameters.get(str(name))

    def set_corner(name, **kw):
        s = svc.sess("maeSetCorner", kw.get("session"), edit=True)
        dt = kw.get("disableTests")
        s.setup.set_corner(str(name), None if "enabled" not in kw else (kw["enabled"] is not None and kw["enabled"] is not False), None if dt is None else [str(x) for x in dt])
        s.dirty = True
        return str(name)

    def delete_corner(name, **kw):
        s = svc.sess("maeDeleteCorner", kw.get("session"), edit=True)
        s.dirty = True
        return True if s.setup.delete_corner(str(name)) else None

    def load_corners(path, **kw):
        """CSV: corner,var,value[,var,value...] or the Maestro corners export: header row 'Corner,Enabled,<vars...>'."""
        s = svc.sess("maeLoadCorners", kw.get("session"), edit=True)
        p = svc.need_path("maeLoadCorners", path)
        if not os.path.isfile(p):
            raise SkillError(f"*Error* maeLoadCorners: cannot read {p}")
        import csv
        with open(p, newline="", encoding="utf-8") as fh:
            rows = list(csv.reader(fh))
        n = 0
        if rows and rows[0] and rows[0][0].strip().lower() == "corner" and len(rows[0]) > 1 and rows[0][1].strip().lower() == "enabled":
            head = [h.strip() for h in rows[0]]
            for r in rows[1:]:
                if not r or not r[0].strip():
                    continue
                c = s.setup.set_corner(r[0].strip(), r[1].strip().lower() in ("1", "t", "true", "yes"))
                for h, v in zip(head[2:], r[2:]):
                    if v.strip():
                        s.setup.set_var(h, v.strip(), "corner", c.name)
                n += 1
        else:
            for r in rows:
                if not r or not r[0].strip() or r[0].startswith("#"):
                    continue
                c = s.setup.set_corner(r[0].strip(), True)
                for k in range(1, len(r) - 1, 2):
                    s.setup.set_var(r[k].strip(), r[k + 1].strip(), "corner", c.name)
                n += 1
        s.dirty = True
        return n

    def set_env_option(test, **kw):
        s = svc.sess("maeSetEnvOption", kw.get("session"), edit=True)
        t = s.setup.test(str(test))
        for k, v in _opts(kw.get("options")).items():
            if k == "modelFiles":
                mf = []
                for item in v:
                    path, sec = (item[0], item[1] if len(item) > 1 else "")
                    mf.append((svc.need_path("maeSetEnvOption", path), str(sec)))
                t.model_files = mf
            elif k == "simExecName":
                if str(v) not in ("ngspice", "spectre"):
                    raise SkillError("*Error* maeSetEnvOption: only the ngspice simulator is available")
                t.simulator = "ngspice"
            elif k == "includes":
                t.includes = [svc.need_path("maeSetEnvOption", x) for x in v]
            else:
                t.env[k] = v
        s.dirty = True
        return True

    def get_env_option(test, **kw):
        s = svc.sess("maeGetEnvOption", kw.get("session"))
        t = s.setup.test(str(test))
        opt = kw.get("option")
        full = {"modelFiles": [[p, sec] for p, sec in t.model_files], "simExecName": t.simulator, "includes": list(t.includes)}
        full.update(t.env)
        if opt is None:
            return [[k, v] for k, v in full.items()]
        return full.get(str(opt))

    def set_sim_option(test, **kw):
        s = svc.sess("maeSetSimOption", kw.get("session"), edit=True)
        t = s.setup.test(str(test))
        for k, v in _opts(kw.get("options")).items():
            t.sim_options[str(k)] = "" if v is True else str(v)
        s.dirty = True
        return True

    def set_run_mode(mode, **kw):
        s = svc.sess("maeSetCurrentRunMode", kw.get("session"), edit=True)
        s.setup.set_run_mode(str(mode))
        s.dirty = True
        return True

    def get_run_mode(**kw):
        return svc.sess("maeGetCurrentRunMode", kw.get("session")).setup.run_mode

    def set_job_control(mode, **kw):
        s = svc.sess("maeSetJobControlMode", kw.get("session"), edit=True)
        s.setup.job["controlMode"] = str(mode)
        s.dirty = True
        return True

    def set_job_policy(policy, **kw):
        s = svc.sess("maeSetJobPolicy", kw.get("session"), edit=True)
        s.setup.job["policy"] = str(policy)
        for k in ("maxJobs", "timeout"):
            if kw.get(k) is not None:
                s.setup.job[k] = int(units.si(kw[k]))
        s.dirty = True
        return True

    for n, f in (("maeSetVar", set_var), ("maeGetVar", get_var), ("maeDeleteVar", delete_var), ("asiGetDesignVarList", design_var_list), ("maeSetParameter", set_parameter),
                 ("maeGetParameter", get_parameter), ("maeSetCorner", set_corner), ("maeDeleteCorner", delete_corner), ("maeLoadCorners", load_corners),
                 ("maeSetEnvOption", set_env_option), ("maeGetEnvOption", get_env_option), ("maeSetSimOption", set_sim_option), ("maeSetCurrentRunMode", set_run_mode),
                 ("maeGetCurrentRunMode", get_run_mode), ("maeSetJobControlMode", set_job_control), ("maeSetJobPolicy", set_job_policy)):
        reg(n, f)

    # ---- axl* setup-database handles (the subset the bridge uses for corner models and variables) ----
    def axl_db(sid=None, **kw):
        s = svc.sess("axlGetMainSetupDB", sid)
        return svc.handle(("db", s.id))

    def axl_corner(h, name):
        k = svc.handles.get(h)
        if not k or k[0] != "db":
            raise SkillError("*Error* axlGetCorner: argument #1 should be a setup database handle")
        s = svc.sess("axlGetCorner", k[1], edit=True)
        s.setup.set_corner(str(name))
        return svc.handle(("corner", s.id, str(name)))

    def axl_put_model(h, name):
        k = svc.handles.get(h)
        if not k or k[0] != "corner":
            raise SkillError("*Error* axlPutModel: argument #1 should be a corner handle")
        s = svc.sess("axlPutModel", k[1], edit=True)
        c = s.setup.corners[k[2]]
        c.models.append({"file": "", "section": "", "test": "All", "label": str(name)})
        s.dirty = True
        return svc.handle(("model", s.id, k[2], len(c.models) - 1))

    def axl_model_set(field):
        def f(h, value):
            k = svc.handles.get(h)
            if not k or k[0] != "model":
                raise SkillError(f"*Error* axlSetModel{field.capitalize()}: argument #1 should be a model handle")
            s = svc.sess("axlSetModel", k[1], edit=True)
            m = s.setup.corners[k[2]].models[k[3]]
            m[field] = svc.need_path("axlSetModelFile", value) if field == "file" else str(value)
            s.dirty = True
            return True
        return f

    def axl_test(h, name):
        k = svc.handles.get(h)
        if not k or k[0] != "db":
            raise SkillError("*Error* axlGetTest: argument #1 should be a setup database handle")
        s = svc.sess("axlGetTest", k[1])
        s.setup.test(str(name))
        return svc.handle(("test", s.id, str(name)))

    def axl_var(h, name):
        k = svc.handles.get(h)
        if not k or k[0] not in ("db", "test"):
            raise SkillError("*Error* axlGetVar: argument #1 should be a setup database or test handle")
        s = svc.sess("axlGetVar", k[1])
        scope = ("global", None) if k[0] == "db" else ("test", k[2])
        if s.setup.get_var(str(name), *scope) is None:
            return None
        return svc.handle(("var", s.id, str(name), scope))

    def axl_remove(h):
        k = svc.handles.get(h)
        if not k or k[0] != "var":
            raise SkillError("*Error* axlRemoveElement: only variable handles can be removed here")
        s = svc.sess("axlRemoveElement", k[1], edit=True)
        s.dirty = True
        return True if s.setup.delete_var(k[2], *k[3]) else None

    def axl_current_history(h):
        k = svc.handles.get(h)
        s = svc.sess("axlGetCurrentHistory", k[1] if k else None)
        names = svc.hist(s).names()
        return names[-1] if names else None

    reg("axlGetMainSetupDB", axl_db)
    reg("axlGetCorner", axl_corner)
    reg("axlPutModel", axl_put_model)
    reg("axlSetModelFile", axl_model_set("file"))
    reg("axlSetModelSection", axl_model_set("section"))
    reg("axlGetTest", axl_test)
    reg("axlGetVar", axl_var)
    reg("axlRemoveElement", axl_remove)
    reg("axlGetCurrentHistory", axl_current_history)

    # ======================================================================== running
    def run_simulation(*a, **kw):
        s = svc.sess("maeRunSimulation", kw.get("session"))
        setup = svc.snapshot(s.setup)
        hist = svc.hist(s)
        name = str(kw.get("history") or R.new_history_name(hist.names() + list(svc.jobs), s.setup.next_run))
        if name in svc.jobs and svc.jobs[name].status == "running":
            raise SkillError(f"*Error* maeRunSimulation: history {name} is already running")
        if hist.exists(name) and (s.setup.histories.get(name, {}).get("locked")):
            raise SkillError(f"*Error* maeRunSimulation: history {name} is locked")
        s.setup.next_run = max(s.setup.next_run, int(name.split(".")[-1]) + 1 if name.startswith("Interactive.") and name.split(".")[-1].isdigit() else s.setup.next_run)
        job = runner.Job(name, callback=str(kw["callback"]) if kw.get("callback") else None)
        runner.plan(setup, None)         # validate before starting so errors surface in this call
        svc.jobs[name] = job

        def body() -> None:
            try:
                job.summary = runner.run(setup, svc.sch, hist, name, job)
                job.status = job.summary["status"]
            except Exception as exc:     # noqa: BLE001 - a crashed run must be visible, not silent
                job.status, job.error = "failed", f"{type(exc).__name__}: {exc}"
            finally:
                job.finished = __import__("time").time()

        job.thread = threading.Thread(target=body, daemon=True)
        job.thread.start()
        s.setup.histories.setdefault(name, {"locked": False})
        svc.res_ptr["history"] = name
        if kw.get("waitUntilDone") not in (None, False):
            wait_done(name)
        return name

    def wait_done(which=None, **kw):
        names = list(svc.jobs) if which in (None, "All") or str(which) == "All" else [str(which)]
        for n in names:
            j = svc.jobs.get(n)
            if j is None:
                raise SkillError(f"*Error* maeWaitUntilDone: no run named {n}")
            if j.thread is not None:
                j.thread.join()
            if j.callback and j.status == "done" and not getattr(j, "_called", False):
                j._called = True
                fn = F.get(j.callback) or interp.globals.vars.get(j.callback)
                if fn is not None:
                    interp.call(fn, [svc.current, n]) if hasattr(fn, "params") else fn(svc.current, n)
            if j.status == "failed":
                raise SkillError(f"*Error* maeWaitUntilDone: run {n} failed: {j.error}")
        return True

    def stop_simulation(*a, **kw):
        n = str(kw.get("history") or (a[0] if a else ""))
        for k, j in svc.jobs.items():
            if (not n or k == n) and j.status == "running":
                j.cancel()
        return True

    reg("maeRunSimulation", run_simulation)
    reg("maeWaitUntilDone", wait_done)
    reg("maeStopSimulation", stop_simulation)

    # ======================================================================== results
    def cur_hist(s: Session, history=None) -> tuple[R.HistoryStore, str]:
        h = str(history) if history else (svc.res_ptr.get("history") or None)
        store = svc.hist(s)
        if h is None:
            names = store.names()
            if not names:
                raise SkillError("*Error* no simulation history exists; run maeRunSimulation first")
            h = names[-1]
        return store, h

    def summary_of(s: Session, history=None) -> dict:
        store, h = cur_hist(s, history)
        j = svc.jobs.get(h)
        if j is not None and j.status == "running":
            raise SkillError(f"*Error* run {h} is still running; call maeWaitUntilDone first")
        return store.read(h)

    def open_results(*a, **kw):
        s = svc.sess("maeOpenResults", kw.get("session"))
        store = svc.hist(s)
        h = str(kw.get("history") or (store.names() or [None])[-1] or "")
        if not h or not store.exists(h):
            raise SkillError(f"*Error* maeOpenResults: history {h or '(none)'} does not exist; histories: {', '.join(store.names()) or 'none'}")
        svc.res_ptr["history"] = h
        return h

    def close_results(*a, **kw):
        svc.res_ptr["history"] = None
        return True

    def result_tests(*a, **kw):
        s = svc.sess("maeGetResultTests", kw.get("session"))
        return summary_of(s, kw.get("history"))["tests"] or None

    def result_outputs(*a, **kw):
        s = svc.sess("maeGetResultOutputs", kw.get("session"))
        sm = summary_of(s, kw.get("history"))
        tn = kw.get("testName")
        names: list[str] = []
        for p in R.points(sm, str(tn) if tn else None):
            for o in p.get("outputs", {}):
                if o not in names:
                    names.append(o)
        return names or None

    def find_point(sm: dict, test: str, kw: dict) -> dict:
        pts = R.points(sm, test, str(kw["cornerName"]) if kw.get("cornerName") else None)
        if kw.get("pointIndex") is not None:
            pts = [p for p in pts if p["id"] == int(kw["pointIndex"])] or []
        elif kw.get("sweepPoint") is not None:
            pts = [p for p in pts if p.get("sweep_index") == int(kw["sweepPoint"])] or []
        if not pts:
            raise SkillError(f"*Error* no result point for test {test}" + (f", corner {kw['cornerName']}" if kw.get("cornerName") else "") + " (check maeGetResultTests / vvMaeResults)")
        return pts[0]

    def output_value(out, test, **kw):
        s = svc.sess("maeGetOutputValue", kw.get("session"))
        sm = summary_of(s, kw.get("history"))
        p = find_point(sm, str(test), kw)
        o = p.get("outputs", {}).get(str(out))
        if o is None:
            raise SkillError(f"*Error* maeGetOutputValue: output {out} not found at point {p['id']}" + (f" (point failed: {p['errors'][0]})" if not p.get("ok") and p.get("errors") else ""))
        if o["kind"] == "scalar":
            return o["value"]
        if o["kind"] == "wave":
            return f"<waveform {o['points']} points; use vvMaeWaveCsv>"
        if o["kind"] == "error":
            raise SkillError(f"*Error* maeGetOutputValue: {o['error']}")
        return None if o["kind"] == "nil" else o.get("text")

    def spec_status(out, test, **kw):
        s = svc.sess("maeGetSpecStatus", kw.get("session"))
        sm = summary_of(s, kw.get("history"))
        p = find_point(sm, str(test), kw)
        o = p.get("outputs", {}).get(str(out))
        return (o or {}).get("spec_status") or "none"

    def overall_status(*a, **kw):
        s = svc.sess("maeGetOverallSpecStatus", kw.get("session"))
        return R.overall(summary_of(s, kw.get("history")))["status"]

    def overall_yield(*a, **kw):
        s = svc.sess("maeGetOverallYield", kw.get("session"))
        return R.overall(summary_of(s, kw.get("history")))["yield"]

    def export_view(*a, **kw):
        s = svc.sess("maeExportOutputView", kw.get("session"))
        text = R.to_csv(summary_of(s, kw.get("history")), str(kw.get("view") or "Detail"))
        fn = kw.get("fileName")
        if fn:
            p = svc.need_path("maeExportOutputView", fn)
            os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
            with open(p, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            return p
        return text

    for n, f in (("maeOpenResults", open_results), ("maeCloseResults", close_results), ("maeGetResultTests", result_tests), ("maeGetResultOutputs", result_outputs),
                 ("maeGetOutputValue", output_value), ("maeGetSpecStatus", spec_status), ("maeGetOverallSpecStatus", overall_status),
                 ("maeGetOverallYield", overall_yield), ("maeExportOutputView", export_view)):
        reg(n, f)

    # ---- history ----
    def set_history_lock(name, locked=True, **kw):
        s = svc.sess("maeSetHistoryLock", kw.get("session"), edit=True)
        s.setup.histories.setdefault(str(name), {})["locked"] = locked is not None and locked is not False
        s.dirty = True
        return True

    def get_history_lock(name, **kw):
        s = svc.sess("maeGetHistoryLock", kw.get("session"))
        return True if s.setup.histories.get(str(name), {}).get("locked") else None

    reg("maeSetHistoryLock", set_history_lock)
    reg("maeGetHistoryLock", get_history_lock)

    # ---- script and netlist export ----
    def write_script(fname, **kw):
        s = svc.sess("maeWriteScript", kw.get("session"))
        p = svc.need_path("maeWriteScript", fname)
        os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(script_text(s.setup))
        return p

    def script_text(st: Setup) -> str:
        q = lambda x: '"' + str(x).replace("\\", "\\\\").replace('"', '\\"') + '"'
        L = [f"; vvirt Maestro setup of {st.lib}/{st.cell} (regenerate with maeWriteScript)", f"sess = maeOpenSetup({q(st.lib)} {q(st.cell)} \"maestro\" ?mode \"a\")"]
        for t in st.tests.values():
            L.append(f"maeCreateTest({q(t.name)} ?lib {q(t.lib)} ?cell {q(t.cell)} ?view {q(t.view)} ?simulator {q(t.simulator)} ?session sess)")
            for k, a in t.analyses.items():
                opts = " ".join(f"({q(k2)} {q(v)})" for k2, v in a["options"].items())
                L.append(f"maeSetAnalysis({q(t.name)} {q(k)} ?enable {'t' if a.get('enable', True) else 'nil'} ?options `({opts}) ?session sess)")
            for o in t.outputs.values():
                extra = f" ?signalName {q(o.signal)}" if o.signal else ""
                extra += f" ?expr {q(o.expr)}" if o.expr else ""
                L.append(f"maeAddOutput({q(o.name)} {q(t.name)} ?outputType {q(o.otype)}{extra} ?session sess)")
                sp = st.spec(t.name, o.name)
                if sp is not None:
                    kws = " ".join(f"?{k} {q(getattr(sp, k))}" for k in ("lt", "gt", "minimum", "maximum", "tolerance", "target") if getattr(sp, k) is not None)
                    L.append(f"maeSetSpec({q(o.name)} {q(t.name)} {kws} ?session sess)")
            if t.model_files:
                L.append(f"maeSetEnvOption({q(t.name)} ?options `((\"modelFiles\" ({' '.join(f'({q(p)} {q(sec)})' for p, sec in t.model_files)}))) ?session sess)")
            for k, v in t.vars.items():
                L.append(f"maeSetVar({q(k)} {q(v)} ?typeName \"test\" ?typeValue '({q(t.name)}) ?session sess)")
        for k, v in st.vars.items():
            L.append(f"maeSetVar({q(k)} {q(v)} ?session sess)")
        for k, v in st.parameters.items():
            L.append(f"maeSetParameter({q(k)} ?value {q(v)} ?session sess)")
        for c in st.corners.values():
            L.append(f"maeSetCorner({q(c.name)} ?enabled {'t' if c.enabled else 'nil'} ?session sess)")
            for k, v in c.vars.items():
                L.append(f"maeSetVar({q(k)} {q(v)} ?typeName \"corner\" ?typeValue '({q(c.name)}) ?session sess)")
            for m in c.models:
                L.append(f"; corner model: {m.get('file')} section {m.get('section')} (restore with vvMaeSetModel({q(c.name)} {q(m.get('file'))} {q(m.get('section'))}))")
        L.append(f"maeSetCurrentRunMode({q(st.run_mode)} ?session sess)")
        L.append("maeSaveSetup(?session sess)")
        return "\n".join(L) + "\n"

    def netlist_for_corner(test, corner, dirpath, **kw):
        s = svc.sess("maeCreateNetlistForCorner", kw.get("session"))
        d = svc.need_path("maeCreateNetlistForCorner", dirpath)
        os.makedirs(d, exist_ok=True)
        setup = svc.snapshot(s.setup)
        pl = [p for p in runner.plan(setup, [str(test)]) if (p.corner or "") == (str(corner) if corner else "")]
        if not pl:
            raise SkillError(f"*Error* maeCreateNetlistForCorner: test {test} has no point for corner {corner!r}")
        dk = deckmod.build(runner._point_spec(setup, setup.test(str(test)), pl[0]), svc.sch)
        path = os.path.join(d, f"{test}_{corner or 'nominal'}.cir")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(dk.text)
        return path

    def unsupported(name: str, why: str):
        def f(*a, **kw):
            raise SkillError(f"*Error* {name}: {why}")
        return f

    reg("maeWriteScript", write_script)
    reg("maeCreateNetlistForCorner", netlist_for_corner)
    reg("maeMigrateADELStateToMaestro", unsupported("maeMigrateADELStateToMaestro", "ADE L state files are not supported by vvirt Maestro"))
    reg("maeMigrateADEXLToMaestro", unsupported("maeMigrateADEXLToMaestro", "ADE XL views are not supported by vvirt Maestro"))
    reg("maeRestoreHistory", unsupported("maeRestoreHistory", "restoring a history into the setup is not supported; read results with maeOpenResults / vvMaeResults"))

    # ======================================================================== vvSch*: build designs
    def sch_create(lib, cell):
        s = S.Schematic(str(lib), str(cell))
        svc.sch.save(s)
        return f"{lib}/{cell}"

    def load(lib, cell) -> S.Schematic:
        return svc.sch.load(str(lib), str(cell))

    def sch_add_inst(lib, cell, name, mlib, mcell, **kw):
        s = load(lib, cell)
        s.add_inst(str(name), str(mlib), str(mcell), _pairs(kw.get("conn")), _pairs(kw.get("params")))
        svc.sch.save(s)
        return str(name)

    def sch_connect(lib, cell, inst, pin, net):
        s = load(lib, cell)
        s.connect(str(inst), str(pin), str(net))
        svc.sch.save(s)
        return True

    def sch_set_param(lib, cell, inst, name, value):
        s = load(lib, cell)
        s.set_param(str(inst), str(name), value)
        svc.sch.save(s)
        return True

    def sch_add_pin(lib, cell, name, **kw):
        s = load(lib, cell)
        s.add_pin(str(name), str(kw.get("direction") or "inout"))
        svc.sch.save(s)
        return str(name)

    def sch_check(lib, cell):
        return load(lib, cell).check() or None

    def sch_list(*a, **kw):
        return [f"{l}/{c}" for l, c in svc.sch.cells(str(a[0]) if a else None)] or None

    def sch_delete(lib, cell):
        return True if svc.sch.delete(str(lib), str(cell)) else None

    def sch_masters(*a, **kw):
        lib = str(a[0]) if a else None
        return [records.rec(("library", m.lib), ("cell", m.name), ("pins", m.pins), ("parameters", [[k, v] for k, v in m.params.items()]), ("spice", m.prefix), ("doc", m.doc))
                for m in S.MASTERS.values() if lib is None or m.lib == lib]

    def sch_info(lib, cell):
        s = load(lib, cell)
        return records.rec(("library", s.lib), ("cell", s.cell), ("kind", s.kind), ("pins", [[k, v] for k, v in s.pins.items()]), ("nets", s.nets()),
                           ("instances", [records.rec(("name", i.name), ("master", f"{i.lib}/{i.cell}"), ("connections", [[k, v] for k, v in i.conns.items()]), ("parameters", [[k, v] for k, v in i.params.items()])) for i in s.insts.values()]),
                           ("problems", s.check() or None))

    def sch_netlist(lib, cell, **kw):
        s = load(lib, cell)
        spec = deckmod.PointSpec(s.lib, s.cell, [("op", {})], variables=_pairs(kw.get("variables")))
        return deckmod.build(spec, svc.sch).text

    def sch_from_spice(lib, cell, text, **kw):
        t = str(text)
        if "\n" not in t and not t.lstrip().startswith((".", "*", "R", "C", "L", "V", "I", "X", "M", "Q", "D", "E", "G")) or (os.path.sep in t and "\n" not in t and os.path.isfile(t)):
            p = svc.need_path("vvSchFromSpice", t)
            if not os.path.isfile(p):
                raise SkillError(f"*Error* vvSchFromSpice: cannot read {p}")
            with open(p, encoding="utf-8", errors="replace") as fh:
                t = fh.read()
        s = S.from_spice(str(lib), str(cell), t, str(kw["top"]) if kw.get("top") else None)
        svc.sch.save(s)
        return records.rec(("library", s.lib), ("cell", s.cell), ("subckt", s.top_subckt or None), ("pins", list(s.pins)))

    def sch_from_xschem(lib, cell, path, **kw):
        p = svc.need_path("vvSchFromXschem", path)
        exe = shutil.which("xschem")
        if exe is None:
            raise SkillError("*Error* vvSchFromXschem: xschem is not installed")
        if not os.path.isfile(p):
            raise SkillError(f"*Error* vvSchFromXschem: cannot read {p}")
        with tempfile.TemporaryDirectory() as td:
            r = subprocess.run([exe, "-q", "-n", "-s", "--no_x", "-o", td, "-N", "net.spice", p], capture_output=True, text=True, timeout=120, cwd=td)
            out = os.path.join(td, "net.spice")
            if not os.path.isfile(out):
                cands = [f for f in os.listdir(td) if f.endswith((".spice", ".cir"))]
                if not cands:
                    raise SkillError(f"*Error* vvSchFromXschem: xschem produced no netlist ({(r.stderr or r.stdout).strip()[:200]})")
                out = os.path.join(td, cands[0])
            with open(out, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        s = S.from_spice(str(lib), str(cell), text, str(kw["top"]) if kw.get("top") else None)
        s.source = "xschem:" + os.path.basename(p)
        svc.sch.save(s)
        return records.rec(("library", s.lib), ("cell", s.cell), ("subckt", s.top_subckt or None), ("pins", list(s.pins)), ("source", s.source))

    for n, f in (("vvSchCreate", sch_create), ("vvSchAddInst", sch_add_inst), ("vvSchConnect", sch_connect), ("vvSchSetParam", sch_set_param), ("vvSchAddPin", sch_add_pin),
                 ("vvSchCheck", sch_check), ("vvSchList", sch_list), ("vvSchDelete", sch_delete), ("vvSchMasters", sch_masters), ("vvSchInfo", sch_info),
                 ("vvSchNetlist", sch_netlist), ("vvSchFromSpice", sch_from_spice), ("vvSchFromXschem", sch_from_xschem)):
        reg(n, f)

    # ======================================================================== vvMae*: results, evaluation, reports
    def mae_results(*a, **kw):
        s = svc.sess("vvMaeResults", kw.get("session"))
        sm = summary_of(s, kw.get("history"))
        return records.rec(("history", sm["history"]), ("status", sm["status"]), ("simulator", sm.get("simulator")), ("seconds", sm.get("seconds")), ("overall", records.rec(*R.overall(sm).items())),
                           ("points", [records.rec(("id", p["id"]), ("test", p["test"]), ("corner", p.get("corner")), ("vars", [[k, v] for k, v in p.get("vars", {}).items()]),
                                                  ("status", R.point_status(p)), ("seconds", p.get("seconds")),
                                                  ("outputs", [records.rec(("name", n), ("kind", o["kind"]), ("value", o.get("value", o.get("text", o.get("error")))), ("spec", o.get("spec")), ("specStatus", o.get("spec_status")))
                                                               for n, o in p.get("outputs", {}).items()]), ("errors", p.get("errors") or None)) for p in sm["points"]]))

    def mae_histories(*a, **kw):
        s = svc.sess("vvMaeHistories", kw.get("session"))
        store = svc.hist(s)
        out = []
        for n in store.names():
            sm = store.read(n)
            out.append(records.rec(("history", n), ("status", sm.get("status")), ("points", len(sm.get("points", []))), ("created", sm.get("created")),
                                   ("locked", True if s.setup.histories.get(n, {}).get("locked") else None), ("overall", R.overall(sm)["status"])))
        for n, j in svc.jobs.items():
            if j.status == "running":
                out.append(records.rec(("history", n), ("status", "running"), ("points", j.total), ("done", j.done)))
        return out or None

    def mae_status(*a, **kw):
        return [records.rec(("history", n), ("status", j.status), ("done", j.done), ("total", j.total), ("error", j.error or None)) for n, j in svc.jobs.items()] or None

    def mae_delete_history(name, **kw):
        s = svc.sess("vvMaeDeleteHistory", kw.get("session"), edit=True)
        if s.setup.histories.get(str(name), {}).get("locked"):
            raise SkillError(f"*Error* vvMaeDeleteHistory: history {name} is locked")
        svc.hist(s).delete(str(name))
        s.setup.histories.pop(str(name), None)
        svc.jobs.pop(str(name), None)
        s.dirty = True
        return True

    def point_calc(s: Session, kw: dict):
        sm = summary_of(s, kw.get("history"))
        store, h = cur_hist(s, kw.get("history"))
        test = str(kw.get("test") or (sm["tests"][0] if sm["tests"] else ""))
        p = find_point(sm, test, kw)
        if not p.get("ok"):
            raise SkillError(f"*Error* point {p['id']} did not simulate: {(p.get('errors') or ['?'])[0]}")
        plots = R.load_plots(os.path.join(store.path(h), p["dir"], "plots.npz"))
        kinds = [k for k in plots if k != "noise_int"]
        t = s.setup.tests.get(test) or Setup.from_json(sm["setup"]).test(test)
        top = svc.sch.load(t.lib or s.setup.lib, t.cell or s.setup.cell)
        return Calc(plots, default=kinds[0] if len(kinds) == 1 else (kw.get("analysis") and str(kw["analysis"])) or None, current=runner._current_resolver(top, plots),
                    params={k: units.si(v) for k, v in p.get("vars", {}).items() if units.is_number(v)}), p

    def mae_eval(expr, **kw):
        s = svc.sess("vvMaeEval", kw.get("session"))
        c, p = point_calc(s, kw)
        r = c.eval(str(expr))
        if isinstance(r, Wave):
            return records.rec(("kind", "wave"), ("points", int(len(r.x))), ("xname", r.xname), ("xmin", float(r.x.min())), ("xmax", float(r.x.max())))
        return records.rec(("kind", "scalar" if isinstance(r, (int, float)) else "other"), ("value", r))

    def mae_wave_csv(expr, path=None, **kw):
        s = svc.sess("vvMaeWaveCsv", kw.get("session"))
        c, p = point_calc(s, kw)
        e = str(expr)
        o = None
        for t in s.setup.tests.values():
            if e in t.outputs:
                o = t.outputs[e].expression()
        r = c.eval(o or e)
        if not isinstance(r, Wave):
            raise SkillError(f"*Error* vvMaeWaveCsv: {expr} is not a waveform")
        lines = ["x,re,im" if (r.y.dtype.kind == "c") else "x,y"]
        for x, y in zip(r.x, r.y):
            lines.append(f"{x!r},{y.real!r},{y.imag!r}" if r.y.dtype.kind == "c" else f"{x!r},{float(y)!r}")
        text = "\n".join(lines) + "\n"
        if path:
            pth = svc.need_path("vvMaeWaveCsv", path)
            os.makedirs(os.path.dirname(os.path.abspath(pth)), exist_ok=True)
            with open(pth, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            return pth
        return text

    def mae_stats(out, test, **kw):
        s = svc.sess("vvMaeStats", kw.get("session"))
        st = R.output_stats(summary_of(s, kw.get("history")), str(test), str(out))
        if st is None:
            raise SkillError(f"*Error* vvMaeStats: no numeric values for {out} in test {test}")
        return records.rec(*st.items())

    def mae_deck(test, **kw):
        s = svc.sess("vvMaeDeck", kw.get("session"))
        setup = svc.snapshot(s.setup)
        pl = runner.plan(setup, [str(test)])
        if kw.get("corner"):
            pl = [p for p in pl if p.corner == str(kw["corner"])]
        k = int(kw.get("point") or 1) - 1
        if not pl or k >= len(pl):
            raise SkillError(f"*Error* vvMaeDeck: test {test} has {len(pl)} point(s)")
        return deckmod.build(runner._point_spec(setup, setup.test(str(test)), pl[k]), svc.sch).text

    def mae_reevaluate(**kw):
        s = svc.sess("vvMaeReevaluate", kw.get("session"))
        store, h = cur_hist(s, kw.get("history"))
        sm = runner.reevaluate(svc.snapshot(s.setup), svc.sch, store, h)
        return records.rec(("history", h), ("overall", sm["overall"]["status"]), ("yield", sm["overall"]["yield"]))

    def mae_set_model(corner, path, section="", **kw):
        s = svc.sess("vvMaeSetModel", kw.get("session"), edit=True)
        c = s.setup.set_corner(str(corner))
        c.models = [m for m in c.models if m.get("test", "All") != str(kw.get("test") or "All")]
        c.models.append({"file": svc.need_path("vvMaeSetModel", path), "section": str(section), "test": str(kw.get("test") or "All")})
        s.dirty = True
        return True

    def mae_sky130_corner(name, section="tt", temperature=27, **kw):
        s = svc.sess("vvMaeSky130Corner", kw.get("session"), edit=True)
        p = deckmod.sky130_lib_path()
        if p is None:
            raise SkillError("*Error* vvMaeSky130Corner: the sky130 ngspice model library was not found")
        c = s.setup.set_corner(str(name), True)
        c.models = [{"file": p, "section": str(section), "test": "All"}]
        c.vars["temperature"] = str(temperature)
        s.dirty = True
        return str(name)

    def mae_monte_carlo(**kw):
        s = svc.sess("vvMaeMonteCarlo", kw.get("session"), edit=True)
        mc = s.setup.monte_carlo
        if kw.get("points") is not None:
            mc.points = int(units.si(kw["points"]))
        if kw.get("seed") is not None:
            mc.seed = int(units.si(kw["seed"]))
        for item in (kw.get("dists") or []):
            name, spec = str(item[0]), _opts(item[1:] if len(item) > 2 else item[1])
            mc.dists[name] = {k: (v if not isinstance(v, str) else v) for k, v in spec.items()}
        if kw.get("clear") not in (None, False):
            mc.dists.clear()
        s.dirty = True
        return records.rec(("points", mc.points), ("seed", mc.seed), ("variables", [[k, v] for k, v in mc.dists.items()]))

    def mae_doctor(*a, **kw):
        sky = deckmod.sky130_lib_path()
        return records.rec(("ngspice", engine.version()), ("ngspicePath", engine.ngspice_path()), ("sky130Models", sky), ("xschem", shutil.which("xschem")),
                           ("workspace", svc.root), ("supportedAnalyses", list(deckmod.ANALYSES)), ("supportedRunModes", ["Single Run, Sweeps and Corners", "Monte Carlo Sampling"]))

    def mae_report(path=None, **kw):
        from . import report
        s = svc.sess("vvMaeReport", kw.get("session"))
        store, h = cur_hist(s, kw.get("history"))
        html = report.html(store, h, svc.sch)
        if path:
            pth = svc.need_path("vvMaeReport", path)
            os.makedirs(os.path.dirname(os.path.abspath(pth)), exist_ok=True)
            with open(pth, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(html)
            return pth
        return html

    for n, f in (("vvMaeResults", mae_results), ("vvMaeHistories", mae_histories), ("vvMaeStatus", mae_status), ("vvMaeDeleteHistory", mae_delete_history), ("vvMaeEval", mae_eval),
                 ("vvMaeWaveCsv", mae_wave_csv), ("vvMaeStats", mae_stats), ("vvMaeDeck", mae_deck), ("vvMaeReevaluate", mae_reevaluate), ("vvMaeSetModel", mae_set_model),
                 ("vvMaeSky130Corner", mae_sky130_corner), ("vvMaeMonteCarlo", mae_monte_carlo), ("vvMaeDoctor", mae_doctor), ("vvMaeReport", mae_report)):
        reg(n, f)
    return svc
