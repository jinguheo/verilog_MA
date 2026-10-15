"""Run results on disk: one folder per history, one subfolder per simulated point, plus summary.json.

<results>/<history>/summary.json
<results>/<history>/<test>/<point>/{deck.cir, ngspice.log, plots.npz, outputs.npz}
plots.npz keeps every simulator plot (so expressions can be re-evaluated later without re-simulating); outputs.npz keeps waveform outputs.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import time
from typing import Any

import numpy as np

from .rawfile import Plot
from .calc import Wave


class ResultError(Exception):
    pass


def save_plots(path: str, plots: list[Plot]) -> None:
    arrays: dict[str, np.ndarray] = {}
    meta = []
    for i, p in enumerate(plots):
        meta.append({"name": p.name, "title": p.title, "complex": p.complex, "names": p.names, "types": p.types, "points": p.points})
        for nm in p.names:
            arrays[f"p{i}|{nm}"] = p.data[nm]
    arrays["__meta__"] = np.frombuffer(json.dumps(meta).encode("utf-8"), dtype=np.uint8)
    np.savez_compressed(path, **arrays)


def load_plots(path: str) -> dict[str, Plot]:
    if not os.path.isfile(path):
        raise ResultError(f"no saved waveforms at {path}")
    z = np.load(path, allow_pickle=False)
    meta = json.loads(bytes(z["__meta__"]).decode("utf-8"))
    out: dict[str, Plot] = {}
    for i, m in enumerate(meta):
        p = Plot(m["name"], m["title"], m["complex"], list(m["names"]), list(m["types"]), {}, m["points"])
        for nm in p.names:
            p.data[nm] = z[f"p{i}|{nm}"]
        out[p.kind()] = p
    return out


def save_waves(path: str, waves: dict[str, Wave]) -> None:
    arrays: dict[str, np.ndarray] = {}
    meta = {}
    for name, w in waves.items():
        key = re.sub(r"[^A-Za-z0-9_]", "_", name)
        arrays[f"{key}|x"], arrays[f"{key}|y"] = w.x, w.y
        meta[key] = {"name": name, "xname": w.xname, "yname": w.yname, "logx": w.logx}
    arrays["__meta__"] = np.frombuffer(json.dumps(meta).encode("utf-8"), dtype=np.uint8)
    np.savez_compressed(path, **arrays)


def load_waves(path: str) -> dict[str, Wave]:
    if not os.path.isfile(path):
        return {}
    z = np.load(path, allow_pickle=False)
    meta = json.loads(bytes(z["__meta__"]).decode("utf-8"))
    return {m["name"]: Wave(z[f"{k}|x"], z[f"{k}|y"], m["xname"], m["yname"], m["logx"]) for k, m in meta.items()}


class HistoryStore:
    def __init__(self, results_dir: str) -> None:
        self.root = results_dir

    def path(self, history: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", history) or history in (".", ".."):
            raise ResultError(f"bad history name {history!r}")
        return os.path.join(self.root, history)

    def point_dir(self, history: str, test: str, point: int) -> str:
        return os.path.join(self.path(history), test, f"point{point}")

    def exists(self, history: str) -> bool:
        return os.path.isfile(os.path.join(self.path(history), "summary.json"))

    def names(self) -> list[str]:
        if not os.path.isdir(self.root):
            return []
        out = [d for d in os.listdir(self.root) if os.path.isfile(os.path.join(self.root, d, "summary.json"))]

        def key(n: str):
            m = re.fullmatch(r"Interactive\.(\d+)", n)
            return (0, int(m.group(1)), n) if m else (1, 0, n)
        return sorted(out, key=key)

    def read(self, history: str) -> dict:
        p = os.path.join(self.path(history), "summary.json")
        if not os.path.isfile(p):
            raise ResultError(f"history {history!r} does not exist; histories: {', '.join(self.names()) or 'none'}")
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)

    def write(self, history: str, summary: dict) -> None:
        os.makedirs(self.path(history), exist_ok=True)
        p = os.path.join(self.path(history), "summary.json")
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(summary, fh, indent=1, default=_jsonable)
        os.replace(tmp, p)

    def delete(self, history: str) -> None:
        shutil.rmtree(self.path(history), ignore_errors=True)


def _jsonable(o: Any):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    if isinstance(o, complex):
        return {"re": o.real, "im": o.imag}
    raise TypeError(f"{type(o).__name__} is not JSON serializable")


# ----------------------------------------------------------------------------------------------- queries
def points(summary: dict, test: str | None = None, corner: str | None = None) -> list[dict]:
    out = summary.get("points", [])
    if test is not None:
        out = [p for p in out if p["test"] == test]
    if corner is not None:
        out = [p for p in out if (p.get("corner") or "") == corner]
    return out


def point_status(point: dict) -> str:
    """"error" if the simulation failed, "fail" if any spec failed, "pass" if all specs passed, "none" if no spec applies."""
    if not point.get("ok", False):
        return "error"
    states = [o.get("spec_status") for o in point.get("outputs", {}).values() if o.get("spec_status")]
    if not states:
        return "none"
    return "fail" if "fail" in states else "pass"


def overall(summary: dict) -> dict:
    ps = summary.get("points", [])
    st = [point_status(p) for p in ps]
    n = len(ps)
    judged = st.count("pass") + st.count("fail") + st.count("error")
    return {"points": n, "pass": st.count("pass"), "fail": st.count("fail"), "error": st.count("error"), "none": st.count("none"),
            "yield": (st.count("pass") / judged * 100.0) if judged else None,
            "status": "error" if "error" in st else ("fail" if "fail" in st else ("pass" if "pass" in st else "none"))}


def output_stats(summary: dict, test: str, output: str) -> dict | None:
    vals = [p["outputs"][output]["value"] for p in points(summary, test) if output in p.get("outputs", {}) and p["outputs"][output].get("kind") == "scalar"]
    if not vals:
        return None
    a = np.array(vals, dtype=float)
    return {"n": int(a.size), "mean": float(a.mean()), "std": float(a.std(ddof=1)) if a.size > 1 else 0.0, "min": float(a.min()), "max": float(a.max()), "median": float(np.median(a))}


def to_csv(summary: dict, view: str = "Detail") -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    if view.lower() == "summary":
        w.writerow(["Test", "Output", "Nominal/Min", "Max", "Mean", "Std", "Spec", "Pass/Fail"])
        tests = sorted({p["test"] for p in summary.get("points", [])})
        for t in tests:
            names = []
            for p in points(summary, t):
                for n in p.get("outputs", {}):
                    if n not in names:
                        names.append(n)
            for n in names:
                st = output_stats(summary, t, n)
                ps = [p["outputs"][n] for p in points(summary, t) if n in p.get("outputs", {})]
                spec = next((o.get("spec") for o in ps if o.get("spec")), "")
                stat = [o.get("spec_status") for o in ps if o.get("spec_status")]
                w.writerow([t, n] + ([st["min"], st["max"], st["mean"], st["std"]] if st else ["", "", "", ""]) + [spec, ("fail" if "fail" in stat else "pass") if stat else ""])
        return buf.getvalue()
    var_names = sorted({k for p in summary.get("points", []) for k in p.get("vars", {})})
    w.writerow(["Point", "Test", "Corner"] + var_names + ["Output", "Value", "Spec", "Pass/Fail"])
    for p in summary.get("points", []):
        base = [p["id"], p["test"], p.get("corner") or ""] + [p.get("vars", {}).get(k, "") for k in var_names]
        if not p.get("ok", False):
            w.writerow(base + ["", "ERROR: " + "; ".join(p.get("errors", [])[:2]), "", "error"])
            continue
        for n, o in p.get("outputs", {}).items():
            v = o.get("value") if o.get("kind") == "scalar" else ("<waveform>" if o.get("kind") == "wave" else (o.get("error") or o.get("text") or "nil"))
            w.writerow(base + [n, v, o.get("spec", ""), o.get("spec_status", "")])
    return buf.getvalue()


def new_history_name(existing: list[str], counter: int) -> str:
    n = counter
    while f"Interactive.{n}" in existing:
        n += 1
    return f"Interactive.{n}"


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")
