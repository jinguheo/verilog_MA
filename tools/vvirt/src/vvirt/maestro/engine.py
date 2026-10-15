"""Run ngspice in batch mode on a deck and read back every plot it wrote."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from . import rawfile


class SimError(Exception):
    pass


@dataclass
class RunResult:
    ok: bool
    plots: list[rawfile.Plot] = field(default_factory=list)
    log: str = ""
    returncode: int = 0
    seconds: float = 0.0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    deck_path: str = ""
    raw_path: str = ""


def ngspice_path() -> str | None:
    return os.environ.get("VVIRT_NGSPICE") or shutil.which("ngspice")


def version() -> str | None:
    exe = ngspice_path()
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"ngspice-([0-9.]+)", out)
    return m.group(1) if m else (out.strip().splitlines() or [None])[0]


_ERR = re.compile(r"^(?:error|fatal)[: ]|^\s*Error:|Error on line|could not find|no such|unknown (?:subckt|model|device)|singular matrix|no convergence|timestep too small", re.I)
_WARN = re.compile(r"^warning", re.I)


def run(deck: str, workdir: str, name: str = "run", timeout: float = 300.0) -> RunResult:
    exe = ngspice_path()
    if not exe:
        raise SimError("ngspice not found (install it or set VVIRT_NGSPICE)")
    os.makedirs(workdir, exist_ok=True)
    deck_path = os.path.join(workdir, name + ".cir")
    raw_path = os.path.join(workdir, name + ".raw")
    log_path = os.path.join(workdir, name + ".log")
    for p in (raw_path, log_path):
        if os.path.exists(p):
            os.remove(p)
    with open(deck_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(deck)
    t0 = time.time()
    try:
        proc = subprocess.run([exe, "-b", "-r", raw_path, "-o", log_path, deck_path], capture_output=True, text=True, timeout=timeout, cwd=workdir)
        rc = proc.returncode
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired:
        return RunResult(False, log="", returncode=-1, seconds=time.time() - t0, errors=[f"ngspice timed out after {timeout:g}s"], deck_path=deck_path, raw_path=raw_path)
    log = ""
    if os.path.exists(log_path):
        with open(log_path, encoding="utf-8", errors="replace") as fh:
            log = fh.read()
    log += ("\n" + stderr) if stderr.strip() else ""
    errors = [ln.strip() for ln in log.splitlines() if _ERR.search(ln)]
    warnings = [ln.strip() for ln in log.splitlines() if _WARN.search(ln)]
    plots: list[rawfile.Plot] = []
    if os.path.exists(raw_path) and os.path.getsize(raw_path) > 0:
        try:
            plots = rawfile.load(raw_path)
        except rawfile.RawError as exc:
            errors.append(f"rawfile: {exc}")
    ok = bool(plots) and not any("no convergence" in e.lower() or "singular" in e.lower() or e.lower().startswith(("error", "fatal")) for e in errors)
    return RunResult(ok, plots, log, rc, time.time() - t0, errors, warnings, deck_path, raw_path)


def run_many(jobs: list[tuple[str, str, str]], workers: int = 4, timeout: float = 300.0) -> list[RunResult]:
    """jobs: (deck, workdir, name). Runs up to `workers` ngspice processes at once; keeps the input order."""
    if workers <= 1 or len(jobs) <= 1:
        return [run(d, w, n, timeout) for d, w, n in jobs]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(lambda j: run(j[0], j[1], j[2], timeout), jobs))
