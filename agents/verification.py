from .base import Agent, AgentResult
from toolchain import detect_toolchain, run_simulator


class VerificationAgent(Agent):
    name = "verification-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        reqs = context.get("requirements", {}).get("artifacts", [])
        tests = [{"test_id": f"TEST-{i:03d}", "requirement": r,
                  "framework": "cocotb", "simulator": "verilator"}
                 for i, r in enumerate(reqs, 1)]
        if not tests:
            tests = [{"test_id": "TEST-001", "requirement": "smoke behavior",
                      "framework": "cocotb", "simulator": "verilator"}]

        status = "ok"
        evidence = []
        next_steps = ["run verilator/cocotb", "uvm-scenario-agent", "formal-agent"]
        rtl_file = task.get("rtl_file")
        if rtl_file:
            available = detect_toolchain()["tools"]
            simulator = task.get("simulator") or next(
                (name for name in ("verilator", "iverilog") if available[name]["available"]), None)
            if simulator:
                run_result = run_simulator(simulator, rtl_file, top=task.get("top"),
                                            testbench=task.get("testbench"), workdir=task.get("workdir"))
            else:
                run_result = {"status": "external-required",
                              "reason": "no allow-listed simulator (verilator/iverilog) installed"}
            evidence.append({"type": "simulator-run", "simulator": simulator, "data": run_result})
            status = run_result["status"]
            if status == "passed":
                next_steps = ["uvm-scenario-agent", "formal-agent"]

        return AgentResult(self.name, status=status,
            summary=f"{module} 검증 계획과 {len(tests)}개 테스트 후보를 생성했습니다.",
            artifacts=[{"kind": "verification-plan", "module_name": module,
                        "tests": tests, "coverage_targets": ["line", "branch", "functional"]}],
            evidence=evidence,
            confidence=0.7, next_steps=next_steps)
