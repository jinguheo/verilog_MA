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
    "yosys": {"commands": ["yosys.exe", "yosys"], "purpose": "RTL synthesis", "category": "synthesis"},
    "sby": {"commands": ["sby_windows.cmd", "sby.exe", "sby"], "purpose": "formal verification", "category": "formal"},
    "verible": {"commands": ["verible-verilog-lint", "verible-verilog-syntax"], "purpose": "SystemVerilog style and syntax lint", "category": "analysis"},
    "slang": {"commands": ["slang.exe", "slang"], "purpose": "SystemVerilog parsing and elaboration", "category": "analysis"},
    "pyslang": {"commands": [], "purpose": "Python SystemVerilog parsing and elaboration", "category": "analysis"},
    "docker": {"commands": ["docker"], "purpose": "isolated EDA runtime", "category": "runtime"},
}

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
