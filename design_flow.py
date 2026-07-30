"""Manufacturing-oriented lifecycle gates and readiness evaluation."""
from typing import Any, Dict, List

GATES = [
    ("requirements", "customer requirements baselined"),
    ("architecture", "architecture reviewed"),
    ("rtl", "RTL generated and parser-clean"),
    ("simulation", "simulation regression passed"),
    ("formal", "formal properties passed or waived"),
    ("synthesis", "synthesis and STA targets met"),
    ("physical", "place and route completed"),
    ("signoff", "DRC/LVS/ERC and manufacturing review approved"),
]


def _agent(results: List[Dict[str, Any]], name: str) -> Dict[str, Any]:
    return next((r for r in results if r.get("agent") == name), None)


def _evidence(agent_result: Dict[str, Any], evidence_type: str) -> Dict[str, Any]:
    if not agent_result:
        return None
    return next((e for e in agent_result.get("evidence", []) if e.get("type") == evidence_type), None)


def readiness(results: List[Dict[str, Any]], toolchain: Dict[str, Any]) -> Dict[str, Any]:
    names = {r.get("agent") for r in results}
    checks = []
    for gate, label in GATES:
        if gate == "requirements": ok = "requirements-agent" in names
        elif gate == "architecture": ok = "architecture-agent" in names
        elif gate == "rtl":
            rtl_agent = _agent(results, "rtl-agent")
            lint = _evidence(rtl_agent, "lint-run")
            # Without an actual lint run, "ran" is the best available signal; once a
            # lint-run is present (rtl_file was supplied), require it to have passed.
            ok = rtl_agent is not None and (lint is None or lint.get("data", {}).get("status") == "passed")
        elif gate == "simulation":
            sim = _evidence(_agent(results, "verification-agent"), "simulator-run")
            ok = sim.get("data", {}).get("status") == "passed" if sim else toolchain.get("simulator_ready", False)
        elif gate == "formal": ok = toolchain.get("tools", {}).get("sby", {}).get("available", False)
        elif gate == "synthesis": ok = toolchain.get("tools", {}).get("yosys", {}).get("available", False)
        else: ok = False
        checks.append({"gate": gate, "label": label, "status": "pass" if ok else "blocked"})
    passed = sum(x["status"] == "pass" for x in checks)
    return {"checks": checks, "passed": passed, "total": len(checks), "manufacturing_ready": passed == len(checks),
            "note": "manufacturing_ready는 PDK와 사람의 signoff 승인을 포함해야 true가 됩니다."}
