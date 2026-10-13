"""Fake Virtuoso process: plays the role of the Virtuoso/CIW side of virtuoso-bridge.

It "loads" the generated virtuoso_setup.il (reads the setShellEnvVar lines), starts the REAL bridge daemon exactly like
RBStart() does (same command line and environment), and then answers every request line the daemon forwards on its
stdout by evaluating the SKILL against the virtual design database (framing identical to RBIpcDataHandler).

    python3 -m vvirt.server --setup ~/.local/state/virtuoso_bridge/local/virtuoso_setup.il
"""
from __future__ import annotations

import argparse
import os
import re
import signal
import subprocess
import sys
import threading
import time
import traceback

from . import skill_funcs
from .odb import Database
from .skill_lang import Interp, SkillError, skill_repr
from .stdcell import StdCellLib

STX, NAK, RS = b"\x02", b"\x15", b"\x1e"


def parse_setup(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r'\s*setShellEnvVar\("([^"]+)"\s+"([^"]*)"\)', line)
            if m:
                env[m.group(1)] = m.group(2)
    return env


def boot_id() -> str:
    try:
        with open("/proc/sys/kernel/random/boot_id", encoding="utf-8") as fh:
            return fh.read().split()[0]
    except OSError:
        return ""


class FakeVirtuoso:
    def __init__(self, setup: str, workspace: str, verbose: bool = False) -> None:
        self.cfg = parse_setup(setup)
        for k in ("RB_DAEMON_PATH", "RB_PORT"):
            if k not in self.cfg:
                raise SystemExit(f"{setup}: missing {k}")
        self.workspace = os.path.abspath(workspace)
        self.out_dir = os.path.join(self.workspace, "_out")
        os.makedirs(self.out_dir, exist_ok=True)
        self.verbose = verbose
        self.db = Database(os.path.join(self.workspace, "libs"), StdCellLib())
        self.db.create_lib("testlib")
        self.interp = Interp()
        skill_funcs.install(self.interp, self.db, self.out_dir)
        self.proc: subprocess.Popen | None = None
        self.requests = 0
        self.errors = 0
        self.log_path = os.path.join(self.workspace, "vvirt-server.log")
        self.log_fh = open(self.log_path, "a", encoding="utf-8", buffering=1)

    def log(self, msg: str) -> None:
        line = time.strftime("%H:%M:%S ") + msg
        self.log_fh.write(line + "\n")
        if self.verbose:
            print(line, flush=True)

    # --------------------------------------------------------------------------------------------- daemon
    def start_daemon(self) -> None:
        host = "127.0.0.1" if self.cfg.get("RB_LISTEN_ALL", "0") != "1" else "0.0.0.0"
        py = self.cfg.get("RB_PYTHON_PATH", "python3")
        cmd = ["/usr/bin/env", "-u", "LD_LIBRARY_PATH", "-u", "LD_PRELOAD", f"RB_VIRTUOSO_PID={os.getpid()}",
               f"RB_VIRTUOSO_BOOT_ID={boot_id()}"]
        if shutil_which("stdbuf"):
            cmd += ["stdbuf", "-oL"]
        cmd += [py, "-u", self.cfg["RB_DAEMON_PATH"], host, self.cfg["RB_PORT"]]
        self.log("starting daemon: " + " ".join(cmd))
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        threading.Thread(target=self._stderr_loop, daemon=True).start()

    def _stderr_loop(self) -> None:
        assert self.proc and self.proc.stderr
        ident = {"host": "", "ip": "", "pid": "nil", "bind": ""}
        for raw in iter(self.proc.stderr.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip("\n")
            self.log("[daemon] " + line)
            if "[RB-banner]" in line:
                for tok in line.split():
                    if "=" in tok:
                        k, v = tok.split("=", 1)
                        if k in ident:
                            ident[k] = v
                self._write_identity(ident)

    def _write_identity(self, ident: dict) -> None:
        path = self.cfg.get("RB_IDENTITY_PATH", "")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("host=%s\nip=%s\npid=%s\nbind=%s\n" % (ident["host"], ident["ip"], ident["pid"], ident["bind"]))
        except OSError as exc:
            self.log(f"identity write failed: {exc}")

    # --------------------------------------------------------------------------------------------- evaluation
    def evaluate(self, code: str) -> bytes:
        """Return the framed reply for one request (success: STX %L RS, error: NAK %L RS)."""
        self.requests += 1
        self.interp.steps = 0
        self.interp.globals.vars["errset.errset"] = None
        try:
            result = self.interp.eval_text(code)
            text = skill_repr(result)
            if self.interp.output:
                self.log("[CIW] " + "".join(self.interp.output).rstrip())
                self.interp.output.clear()
            return STX + text.encode("utf-8", "replace") + RS
        except SkillError as exc:
            self.errors += 1
            info = [0, 0, 0, 0, [exc.message] + list(exc.extra)]
            self.log(f"[error] {exc.message}")
            return NAK + skill_repr(info).encode("utf-8", "replace") + RS
        except RecursionError:
            self.errors += 1
            return NAK + skill_repr([0, 0, 0, 0, ["*Error* recursion too deep"]]).encode() + RS
        except Exception as exc:  # interpreter bug: report to the caller instead of dying
            self.errors += 1
            self.log("[internal error] " + traceback.format_exc())
            return NAK + skill_repr([0, 0, 0, 0, [f"*Error* internal: {type(exc).__name__}: {exc}"]]).encode("utf-8", "replace") + RS

    def serve(self) -> int:
        assert self.proc and self.proc.stdout and self.proc.stdin
        self.log("serving requests")
        for raw in iter(self.proc.stdout.readline, b""):
            code = raw.decode("utf-8", "replace").rstrip("\r\n")
            if not code.strip():
                continue
            if self.verbose:
                self.log("[req] " + (code if len(code) < 300 else code[:300] + "..."))
            reply = self.evaluate(code)
            try:
                self.proc.stdin.write(reply)
                self.proc.stdin.flush()
            except (BrokenPipeError, OSError):
                break
        rc = self.proc.wait()
        self.log(f"daemon exited rc={rc}")
        return rc

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="virtual Virtuoso for virtuoso-bridge")
    ap.add_argument("--setup", default=os.path.expanduser("~/.local/state/virtuoso_bridge/local/virtuoso_setup.il"))
    ap.add_argument("--workspace", default=os.environ.get("VVIRT_WORKSPACE") or os.path.join(os.path.dirname(__file__), "..", "..", "workspace"))
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    srv = FakeVirtuoso(a.setup, a.workspace, a.verbose)
    signal.signal(signal.SIGTERM, lambda *_: (srv.stop(), sys.exit(0)))
    srv.start_daemon()
    try:
        return srv.serve()
    except KeyboardInterrupt:
        return 0
    finally:
        srv.stop()


if __name__ == "__main__":
    raise SystemExit(main())
