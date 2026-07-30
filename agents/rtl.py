from .base import Agent, AgentResult
from toolchain import detect_toolchain, run_simulator


class RTLAgent(Agent):
    name = "rtl-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        kb = context.get("kb", {})
        matches = kb.module_context(module) if hasattr(kb, "module_context") else {}
        spec = context.get("requirements", {}).get("artifacts", [])

        evidence = [{"type": "knowledge-db", "data": matches}]
        status = "ok"
        rtl_file = task.get("rtl_file")
        if rtl_file:
            if detect_toolchain()["tools"]["verilator"]["available"]:
                lint_result = run_simulator("verilator", rtl_file, top=task.get("top"))
            else:
                lint_result = {"status": "external-required", "reason": "verilator is not installed"}
            evidence.append({"type": "lint-run", "tool": "verilator", "data": lint_result})
            status = lint_result["status"]

        return AgentResult(self.name, status=status,
            summary=f"{module} RTL 설계 계획을 생성했습니다.",
            artifacts=[{"kind": "rtl-plan", "module_name": module,
                        "language": "SystemVerilog", "reference_context": matches,
                        "requirements": spec}],
            evidence=evidence, confidence=0.65,
            next_steps=["verification-agent", "formal-agent", "manufacturing-agent"])
