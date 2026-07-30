from .base import Agent, AgentResult


class ManufacturingAgent(Agent):
    name = "manufacturing-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        return AgentResult(self.name,
            summary=f"{module} 제조성/물리설계 검사 계획을 생성했습니다.",
            artifacts=[{"kind": "manufacturing-plan", "module_name": module,
                        "flow": ["verilator-lint", "yosys-synthesis", "openlane"],
                        "checks": ["synthesizable", "area", "timing", "clock-reset", "drc-lvs"]}],
            confidence=0.6, next_steps=["run yosys", "run openlane when PDK is configured"])
