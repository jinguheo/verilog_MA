"""vvirt readiness check ("doctor"): read-only. It changes nothing and only prints suggested repair commands.

Every check says which capability it gates, so a missing optional piece (e.g. KLayout) is reported as limiting rule
checks only, not as "vvirt is broken". Run it from the WSL shell:  bash tools/vvirt/scripts/doctor.sh [--json]
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]            # tools/vvirt
TOOLS = ROOT.parent                                    # tools/
CLONE = TOOLS / "virtuoso-bridge-lite"
HOME = Path(os.path.expanduser("~"))
BRIDGE_ENV = HOME / ".virtuoso-bridge" / ".env"
BRIDGE_TOKEN = HOME / ".virtuoso-bridge" / "bridge_token"
STATE_DIR = HOME / ".local" / "state" / "virtuoso_bridge" / "local"
SETUP_IL = STATE_DIR / "virtuoso_setup.il"

# capability -> what a user of it needs to know when it is blocked
CAPS = {
    "layout": "create/modify layouts through the bridge (placing PDK cells, shapes, vias, GDS/SVG export)",
    "rules": "rule checks (vvCheckRules / vvCheckReport need KLayout); rule-aware routing (vvRoute) does not",
    "official_drc": "official sky130A_mr.drc check (vvOfficialDrc / vvOfficialDrcReport)",
}


@dataclass
class Check:
    id: str
    title: str
    status: str                 # ok | warn | fail
    detail: str
    caps: list[str] = field(default_factory=list)   # capabilities this check gates
    fix: str | None = None
    ms: int = 0


def _run(cmd: list[str], timeout: int = 15) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, str(exc)


def _pin_from_readme() -> str | None:
    try:
        m = re.search(r"checkout\s+([0-9a-f]{40})", (ROOT / "README.md").read_text(encoding="utf-8"))
        return m.group(1) if m else None
    except OSError:
        return None


def _clone_head() -> str | None:
    rc, out = _run(["git", "-C", str(CLONE), "rev-parse", "HEAD"])
    if rc == 0 and re.fullmatch(r"[0-9a-f]{40}", out.strip()):
        return out.strip()
    try:  # no git binary: read .git/HEAD directly
        head = (CLONE / ".git" / "HEAD").read_text().strip()
        if head.startswith("ref:"):
            return (CLONE / ".git" / head.split(" ", 1)[1]).read_text().strip()
        return head
    except OSError:
        return None


def _setup_env() -> dict[str, str]:
    env: dict[str, str] = {}
    try:
        for line in SETUP_IL.read_text(encoding="utf-8").splitlines():
            m = re.match(r'\s*setShellEnvVar\("([^"]+)"\s+"([^"]*)"\)', line)
            if m:
                env[m.group(1)] = m.group(2)
    except OSError:
        pass
    return env


def run_checks(roundtrip: bool = True) -> list[Check]:
    out: list[Check] = []

    def add(id_: str, title: str, status: str, detail: str, caps: list[str], fix: str | None = None, t0: float | None = None) -> None:
        out.append(Check(id_, title, status, detail, caps, fix, int((time.time() - t0) * 1000) if t0 else 0))

    all_caps = ["layout", "rules", "official_drc"]

    # ---- platform
    t = time.time()
    v = sys.version_info
    add("python", "Python", "ok" if v >= (3, 9) else "fail", f"{v.major}.{v.minor}.{v.micro}", all_caps, "install python >= 3.9 in WSL", t)
    t = time.time()
    boot = Path("/proc/sys/kernel/random/boot_id")
    add("linux", "Linux (WSL) with boot_id", "ok" if boot.exists() else "fail",
        "boot_id readable (the bridge daemon's owner check needs it)" if boot.exists() else "not a Linux environment",
        ["layout"], "run this from the WSL Ubuntu shell, not Windows Python", t)

    # ---- storage: everything stays on D:
    t = time.time()
    ws = Path(os.environ.get("VVIRT_WORKSPACE") or ROOT / "workspace")
    try:
        ws.mkdir(parents=True, exist_ok=True)
        probe = ws / ".doctor_probe"
        probe.write_text("x")
        probe.unlink()
        free = shutil.disk_usage(ws).free / 1e9
        on_d = str(ws.resolve()).startswith("/mnt/d/")
        st = "ok" if on_d and free >= 5 else "warn"
        why = [] if on_d else ["workspace is not on the D: drive (/mnt/d) — this project keeps everything on D:"]
        if free < 5:
            why.append(f"only {free:.1f} GB free")
        add("storage", "Workspace writable, on D:", st, f"{ws} ({free:.0f} GB free)" + ("; " + "; ".join(why) if why else ""),
            ["layout"], "set VVIRT_WORKSPACE to a folder under /mnt/d" if why else None, t)
    except OSError as exc:
        add("storage", "Workspace writable, on D:", "fail", f"{ws}: {exc}", ["layout"], "fix permissions or set VVIRT_WORKSPACE", t)

    # ---- PDK
    t = time.time()
    sys.path.insert(0, str(ROOT / "src"))
    try:
        from vvirt import rules as R, stdcell, techlef
        root = stdcell.find_pdk_root()
        if not root:
            add("pdk", "sky130A PDK", "fail", "not found under ~/.volare", all_caps,
                "install the sky130A PDK with volare (see tools/wsl scripts) or set VVIRT_PDK_ROOT", t)
        else:
            need = {"LEF": f"libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef", "GDS": "libs.ref/sky130_fd_sc_hd/gds/sky130_fd_sc_hd.gds"}
            missing = [k for k, rel in need.items() if not (Path(root) / rel).is_file()]
            add("pdk", "sky130A PDK + standard-cell LEF/GDS", "fail" if missing else "ok",
                f"{root}" + (f"; missing {', '.join(missing)}" if missing else ""), all_caps, "reinstall the sky130A PDK" if missing else None, t)
        t = time.time()
        tl = techlef.find_tlef(root)
        rs = R.RuleSet()
        from_pdk = rs.source.startswith("PDK tech LEF")
        add("tlef", "Design rules from the PDK tech LEF", "ok" if from_pdk else "warn", rs.source if tl else "tech LEF not found",
            ["rules"], None if from_pdk else "rules fell back to built-in defaults: check that sky130_fd_sc_hd__nom.tlef exists in the PDK", t)
        t = time.time()
        deck = R.find_deck(root)
        add("deck", "Official DRC deck (sky130A_mr.drc)", "ok" if deck else "warn",
            f"{os.path.basename(deck)} release {R.deck_release(deck)}" if deck else "not found in the PDK", ["official_drc"],
            None if deck else "the PDK's libs.tech/klayout/drc/sky130A_mr.drc is missing; reinstall the PDK", t)
    except Exception as exc:  # the checks above must never crash the doctor
        add("pdk", "sky130A PDK", "fail", f"could not inspect: {exc}", all_caps, "see the traceback with: python3 -m vvirt.doctor --debug", t)

    # ---- KLayout (optional: gates rule checks only)
    t = time.time()
    kl = shutil.which("klayout")
    if kl:
        rc, ver = _run([kl, "-v"])
        add("klayout", "KLayout (klayout -b)", "ok" if rc == 0 else "warn", ver.splitlines()[0] if ver else kl,
            ["rules", "official_drc"], None if rc == 0 else "klayout is installed but does not start", t)
    else:
        add("klayout", "KLayout (klayout -b)", "warn", "not on PATH — placing and routing still work; rule checks cannot run",
            ["rules", "official_drc"], "install klayout in WSL (e.g. sudo apt install klayout)", t)

    # ---- bridge clone and dependencies
    t = time.time()
    if not CLONE.is_dir():
        add("clone", "virtuoso-bridge-lite source", "fail", f"{CLONE} is missing", ["layout"],
            "git clone https://github.com/Arcadia-1/virtuoso-bridge-lite.git tools/virtuoso-bridge-lite  (then check out the commit in tools/vvirt/README.md)", t)
    else:
        pin, head = _pin_from_readme(), _clone_head()
        if pin and head and pin != head:
            add("clone", "virtuoso-bridge-lite source", "warn", f"HEAD {head[:9]} differs from the pinned {pin[:9]} the tests were run against", ["layout"],
                f"git -C tools/virtuoso-bridge-lite checkout {pin}", t)
        else:
            add("clone", "virtuoso-bridge-lite source", "ok", f"HEAD {head[:9] if head else 'unknown'}" + (" (matches pin)" if pin and head == pin else ""), ["layout"], None, t)

    t = time.time()
    vendor = ROOT / "vendor"
    for p in (str(vendor), str(CLONE / "src")):
        if p not in sys.path:
            sys.path.insert(0, p)
    absent = []
    for mod in ("pydantic", "dotenv", "yaml", "markdownify"):
        try:
            __import__(mod)
        except Exception:
            absent.append(mod)
    add("deps", "Bridge client dependencies (vendor/)", "fail" if absent else "ok", ("missing: " + ", ".join(absent)) if absent else "pydantic, dotenv, yaml, markdownify import",
        ["layout"], "bash tools/vvirt/scripts/setup_env.sh" if absent else None, t)
    t = time.time()
    try:
        import virtuoso_bridge  # noqa: F401

        add("client", "virtuoso_bridge client", "ok", f"imported from {Path(virtuoso_bridge.__file__).parent}", ["layout"], None, t)
        client_ok = True
    except Exception as exc:
        add("client", "virtuoso_bridge client", "fail", f"import failed: {exc}", ["layout"], "fix dependencies first (deps check), then re-run", t)
        client_ok = False

    # ---- bridge configuration written by `virtuoso-bridge start`
    t = time.time()
    env_txt = BRIDGE_ENV.read_text(encoding="utf-8", errors="replace") if BRIDGE_ENV.is_file() else ""
    host = re.search(r"^\s*VB_REMOTE_HOST\s*=\s*(\S*)", env_txt, re.M)
    if not BRIDGE_ENV.is_file():
        add("bridge_env", "Bridge config (~/.virtuoso-bridge/.env)", "fail", "missing", ["layout"], "bash tools/vvirt/scripts/vb.sh init   (creates it; set VB_REMOTE_HOST=localhost)", t)
    elif not host or host.group(1) not in ("localhost", "127.0.0.1"):
        add("bridge_env", "Bridge config (~/.virtuoso-bridge/.env)", "warn",
            f"VB_REMOTE_HOST={host.group(1) if host else '(unset)'} — vvirt runs on this machine, so the client should use localhost", ["layout"],
            "set VB_REMOTE_HOST=localhost in ~/.virtuoso-bridge/.env", t)
    else:
        add("bridge_env", "Bridge config (~/.virtuoso-bridge/.env)", "ok", "VB_REMOTE_HOST=localhost (local mode, no SSH)", ["layout"], None, t)
    t = time.time()
    if BRIDGE_TOKEN.is_file():
        mode = BRIDGE_TOKEN.stat().st_mode & 0o777
        add("token", "Bridge auth token", "ok" if not (mode & 0o077) else "warn", f"present, mode {mode:o}" + ("" if not (mode & 0o077) else " (readable by others)"),
            ["layout"], None if not (mode & 0o077) else f"chmod 600 {BRIDGE_TOKEN}", t)
    else:
        add("token", "Bridge auth token", "warn", "not created yet (made on first `virtuoso-bridge start`)", ["layout"], "bash tools/vvirt/scripts/vb.sh start", t)

    t = time.time()
    senv = _setup_env()
    if not senv:
        add("setup_il", "Generated setup file (virtuoso_setup.il)", "fail", f"{SETUP_IL} missing or has no setShellEnvVar lines", ["layout"], "bash tools/vvirt/scripts/vb.sh start", t)
        port = None
    else:
        port = int(senv.get("RB_PORT", "0")) or None
        dpath = Path(senv.get("RB_DAEMON_PATH", ""))
        problems = []
        if not dpath.is_file():
            problems.append(f"daemon file {dpath} missing")
        elif (CLONE / "src/virtuoso_bridge/virtuoso/basic/resources" / dpath.name).is_file():
            a = hashlib.sha256(dpath.read_bytes()).hexdigest()
            b = hashlib.sha256((CLONE / "src/virtuoso_bridge/virtuoso/basic/resources" / dpath.name).read_bytes()).hexdigest()
            if a != b:
                problems.append("deployed daemon differs from the clone's copy (stale)")
        if not Path(senv.get("RB_PYTHON_PATH", "")).exists():
            problems.append(f"python {senv.get('RB_PYTHON_PATH')} missing")
        add("setup_il", "Generated setup file (virtuoso_setup.il)", "warn" if problems else "ok",
            ("; ".join(problems)) if problems else f"port {port}, daemon {dpath.name}", ["layout"],
            "bash tools/vvirt/scripts/vb.sh start   (regenerates and redeploys), then restart the server" if problems else None, t)

    # ---- the fake Virtuoso process
    t = time.time()
    pidf = ROOT / "workspace" / "server.pid"
    alive = False
    if pidf.is_file():
        try:
            os.kill(int(pidf.read_text().strip()), 0)
            alive = True
        except (OSError, ValueError):
            alive = False
    listening = False
    if port:
        with socket.socket() as s:
            s.settimeout(1.5)
            listening = s.connect_ex(("127.0.0.1", port)) == 0
    if alive and listening:
        add("server", "vvirt server + bridge daemon", "ok", f"running (pid {pidf.read_text().strip()}), daemon listening on 127.0.0.1:{port}", ["layout"], None, t)
    elif listening:
        add("server", "vvirt server + bridge daemon", "warn", f"something listens on :{port} but vvirt's pid file does not match — it may be another session's server",
            ["layout"], "bash tools/vvirt/scripts/vserver.sh status", t)
    else:
        add("server", "vvirt server + bridge daemon", "fail", "not running", ["layout"], "bash tools/vvirt/scripts/vserver.sh start", t)

    # ---- end to end through the real client
    t = time.time()
    if not roundtrip:
        pass
    elif not (client_ok and listening):
        add("roundtrip", "End-to-end eval through the real client", "fail", "skipped: needs the client importable and the daemon listening", ["layout"], "fix the failed checks above, then re-run", t)
    else:
        try:
            from virtuoso_bridge import VirtuosoClient

            r = VirtuosoClient.from_env().execute_skill("1+2", timeout=15)
            got = (r.output or "").strip()
            add("roundtrip", "End-to-end eval through the real client", "ok" if got == "3" else "fail", f"eval 1+2 -> {got!r}", ["layout"],
                None if got == "3" else "check `bash tools/vvirt/scripts/vserver.sh log` for the server's error", t)
        except Exception as exc:
            add("roundtrip", "End-to-end eval through the real client", "fail", f"{type(exc).__name__}: {exc}"[:200], ["layout"],
                "check the daemon identity/token: bash tools/vvirt/scripts/vb.sh status", t)
    return out


def summarize(checks: list[Check]) -> dict:
    blocked: dict[str, list[str]] = {}
    degraded: dict[str, list[str]] = {}
    for c in checks:
        for cap in c.caps:
            if c.status == "fail":
                blocked.setdefault(cap, []).append(c.id)
            elif c.status == "warn":
                degraded.setdefault(cap, []).append(c.id)
    for cap in ("rules", "official_drc"):  # both run through the same bridge/server, so they inherit what blocks or degrades layout
        for src, dst in ((blocked, blocked), (degraded, degraded)):
            for cid in src.get("layout", []):
                if cid not in dst.setdefault(cap, []):
                    dst[cap].append(cid)
    ready = [cap for cap in CAPS if cap not in blocked]
    return {"ok": sum(c.status == "ok" for c in checks), "warn": sum(c.status == "warn" for c in checks),
            "fail": sum(c.status == "fail" for c in checks), "ready": ready, "blocked": blocked, "degraded": degraded}


def render(checks: list[Check]) -> str:
    mark = {"ok": "[ OK ]", "warn": "[WARN]", "fail": "[FAIL]"}
    lines = ["vvirt doctor (read-only: nothing is changed)", ""]
    for c in checks:
        lines.append(f"{mark[c.status]} {c.title} — {c.detail}")
        if c.status != "ok":
            if c.fix:
                lines.append(f"         fix: {c.fix}")
            lines.append(f"         affects: {', '.join(c.caps)}")
    s = summarize(checks)
    lines += ["", f"{s['ok']} ok, {s['warn']} warn, {s['fail']} fail", ""]
    for cap, text in CAPS.items():
        if cap in s["blocked"]:
            state = "BLOCKED by " + ", ".join(s["blocked"][cap])
        elif cap in s["degraded"]:
            state = "usable, with warnings in " + ", ".join(s["degraded"][cap])
        else:
            state = "ready"
        lines.append(f"  {cap:13s} {state}: {text}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    a = list(argv if argv is not None else sys.argv[1:])
    checks = run_checks(roundtrip="--no-roundtrip" not in a)
    if "--json" in a:
        print(json.dumps({"checks": [asdict(c) for c in checks], "summary": summarize(checks), "capabilities": CAPS}, ensure_ascii=False, indent=1))
    else:
        print(render(checks))
    return 1 if any(c.status == "fail" for c in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
