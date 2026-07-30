from .base import Agent, AgentResult


class ArchitectureAgent(Agent):
    name = "architecture-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        requirements = context.get("requirements", {}).get("artifacts", [])
        return AgentResult(self.name,
            summary=f"{module}의 마이크로아키텍처 검토 항목을 생성했습니다.",
            artifacts=[{"kind": "architecture-plan", "module_name": module,
                        "requirements": requirements,
                        "checks": ["interface", "clock/reset", "latency", "state-machine", "error behavior"]}],
            confidence=0.62, next_steps=["rtl-agent", "verification-agent"])
