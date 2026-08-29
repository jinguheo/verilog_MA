"""Safe discovery and execution boundary for external RTL/EDA tools."""
from __future__ import annotations

import shutil
import subprocess
import importlib.util
import os
from pathlib import Path
from typing import Any, Dict, Optional


TOOLS = {
    "verilator": {"commands": ["verilator_bin.exe", "verilator"], "purpose": "lint and cycle simulation", "category": "simulator"},
    "iverilog": {"commands": ["iverilog"], "purpose": "basic Verilog/SystemVerilog simulation", "category": "simulator"},
    "vvp": {"commands": ["vvp"], "purpose": "Icarus simulation runtime", "category": "simulator"},
    "cocotb": {"commands": [], "purpose": "Python RTL verification", "category": "verification"},
    "yosys": {"commands": ["yosys.exe", "yosys"], "purpose": "RTL synthesis (Windows, oss-cad-suite)", "category": "synthesis"},
    "sby": {"commands": ["sby_windows.cmd", "sby.exe", "sby"], "purpose": "formal verification", "category": "formal"},
    "verible": {"commands": ["verible-verilog-lint", "verible-verilog-syntax"], "purpose": "SystemVerilog style and syntax lint", "category": "analysis"},
    "slang": {"commands": ["slang.exe", "slang"], "purpose": "SystemVerilog parsing and elaboration", "category": "analysis"},
    "pyslang": {"commands": [], "purpose": "Python SystemVerilog parsing and elaboration", "category": "analysis"},
    "docker": {"commands": ["docker"], "purpose": "isolated EDA runtime", "category": "runtime"},
}

# WSL-side ASIC flow tools. Not on Windows PATH and not Windows executables, so
# they cannot be found by shutil.which() - the general TOOLS loop above cannot
# see them, which is why OpenLane/OpenROAD/the sky130 PDK previously always
# reported "not detected" regardless of whether they were actually installed.
#
# Checked by fixed path rather than a filesystem search: OpenLane's own run
# script (tools/wsl/80_run_openlane.sh) resolves the nix-store OpenROAD/yosys/
# sta/magic/klayout/netgen binaries once per run and symlinks them into
# ~/.cache/openlane-tools/bin/ under stable names - checking that shim
# directory is one cheap stat per tool instead of a slow /nix/store scan, and
# it reflects the exact binaries the flow actually resolved and ran with, not
# just "a copy exists somewhere."
WSL_DISTRO = "Ubuntu"
WSL_ASIC_TOOLS = {
    "openlane": {
        "wsl_path": "$HOME/.venvs/openlane312/bin/openlane",
        "purpose": "RTL-to-GDS flow orchestration (synthesis -> floorplan -> place -> CTS -> route -> signoff)",
        "category": "physical-implementation",
    },
    "openroad_asic": {
        "wsl_path": "$HOME/.cache/openlane-tools/bin/openroad",
        "purpose": "placement, CTS, routing, static timing analysis (used by the OpenLane flow)",
        "category": "physical-implementation",
    },
    "sky130_pdk": {
        "wsl_path": "$HOME/.volare",
        "purpose": "SkyWater sky130 open-source PDK (standard cells, LEF/LIB, DRC/LVS decks)",
        "category": "pdk",
    },
    "wsl_ubuntu": {
        "wsl_path": "$HOME",
        "purpose": "Ubuntu 26.04 distro (D:\\WSL\\Ubuntu) - runs OpenLane natively in a Python venv, not inside Docker",
        "category": "runtime",
    },
}


def _wsl_check_paths(paths: Dict[str, str], timeout: float = 3.0) -> Dict[str, Optional[str]]:
    """Check whether each of `paths` (WSL-side, may use $HOME) exists and is
    executable/readable inside one distro, in a single wsl.exe invocation.
    Returns {key: resolved_path_or_None}. Never raises - WSL being absent,
    slow, or misconfigured degrades to "not detected" rather than breaking the
    whole toolchain report."""
    result = {key: None for key in paths}
    wsl_exe = shutil.which("wsl") or shutil.which("wsl.exe")
    if not wsl_exe:
        return result
    # One shell, one test per path, each on its own marked output line, so a
    # single process spawn (the expensive part, ~0.2s) answers every query.
    script = "; ".join(f'test -e "{p}" && echo FOUND:{k}:"{p}"' for k, p in paths.items())
    try:
        completed = subprocess.run(
            [wsl_exe, "-d", WSL_DISTRO, "--", "bash", "-lc", script],
            capture_output=True, text=True, timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError):
        return result
    for line in completed.stdout.splitlines():
        if line.startswith("FOUND:"):
            _, key, resolved = line.split(":", 2)
            if key in result:
                result[key] = resolved
    return result

# Ordered RTL front-end gate: fast executable lint first, then style/syntax,
# then the deeper SystemVerilog parse and elaboration check.
STATIC_ANALYSIS_ORDER = ("verilator", "verible", "slang")


def detect_toolchain() -> Dict[str, Any]:
    roots = [os.environ.get("OSS_CAD_ROOT"), r"D:\MyWork\Veriolg_MA\oss-cad-suite"]
    suite_bin = next((Path(x) / "bin" for x in roots if x and (Path(x) / "bin").exists()), None)
    verible_roots = [Path(r"D:\MyWork\Veriolg_MA\third_party\verible")]
    verible_bin = next((p.parent for root in verible_roots for p in root.rglob("verible-verilog-lint.exe")), None)
    detected = {}
    for name, meta in TOOLS.items():
        if name in ("cocotb", "pyslang"):
            path = f"python module:{name}" if importlib.util.find_spec(name) else None
        else:
            path = next((shutil.which(c) for c in meta["commands"] if shutil.which(c)), None)
            if not path and suite_bin:
                path = next((str(suite_bin / c) for c in meta["commands"] if (suite_bin / c).exists()), None)
            if not path and name == "verible" and verible_bin:
                path = str(verible_bin / "verible-verilog-lint.exe")
            if not path and name == "docker":
                docker_candidate = Path(os.environ.get("LOCALAPPDATA", r"C:\Users\oem\AppData\Local")) / "Programs" / "DockerDesktop" / "resources" / "bin" / "docker.exe"
                if docker_candidate.exists(): path = str(docker_candidate)
        detected[name] = {**meta, "available": bool(path), "path": path}

    wsl_paths = {k: v["wsl_path"] for k, v in WSL_ASIC_TOOLS.items()}
    wsl_found = _wsl_check_paths(wsl_paths)
    for name, meta in WSL_ASIC_TOOLS.items():
        path = wsl_found.get(name)
        detected[name] = {**meta, "available": bool(path), "path": (f"wsl:{path}" if path else None)}

    return {"tools": detected, "available": sum(x["available"] for x in detected.values()),
            "total": len(detected), "simulator_ready": any(detected[x]["available"] for x in ("verilator", "iverilog"))}


def run_simulator(simulator: str, rtl_file: str, top: Optional[str] = None,
                  testbench: Optional[str] = None, workdir: Optional[str] = None,
                  timeout: int = 120) -> Dict[str, Any]:
    """Run only an allow-listed simulator with bounded execution time."""
    if simulator not in ("verilator", "iverilog"):
        return {"status": "blocked", "reason": "simulator is not allow-listed"}
    binary = detect_toolchain()["tools"][simulator]["path"]
    if not binary:
        return {"status": "external-required", "simulator": simulator,
                "reason": f"{simulator} is not installed"}
    rtl = Path(rtl_file)
    if not rtl.exists():
        return {"status": "blocked", "reason": f"RTL file not found: {rtl_file}"}
    command = [binary]
    env = os.environ.copy()
    if simulator == "verilator":
        command += ["--lint-only", "--Wall"]
        if top: command += ["--top-module", top]
        command += [str(rtl)]
        share_root = Path(binary).parent.parent / "share" / "verilator"
        if share_root.exists():
            env["VERILATOR_ROOT"] = str(share_root)
    else:
        output = Path(workdir or rtl.parent) / "sim.out"
        command += ["-g2012", "-o", str(output), str(rtl)]
        if testbench: command.append(testbench)
    try:
        completed = subprocess.run(command, cwd=workdir, capture_output=True, text=True, timeout=timeout, env=env)
        return {"status": "passed" if completed.returncode == 0 else "failed", "simulator": simulator,
                "command": command, "exit_code": completed.returncode,
                "stdout": completed.stdout[-12000:], "stderr": completed.stderr[-12000:]}
    except subprocess.TimeoutExpired as exc:
        return {"status": "timeout", "simulator": simulator, "command": command,
                "stdout": (exc.stdout or "")[-12000:], "stderr": (exc.stderr or "")[-12000:]}
