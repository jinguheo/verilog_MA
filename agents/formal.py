from .base import Agent, AgentResult


class FormalAgent(Agent):
    name = "formal-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        return AgentResult(self.name,
            summary=f"{module} formal property 후보를 생성했습니다.",
            artifacts=[{"kind": "formal-plan", "module_name": module,
                        "engine": "symbiyosys", "properties": [
                            "reset establishes legal state", "no illegal state transition",
                            "protocol response eventually occurs"]}],
            confidence=0.55, next_steps=["run symbiyosys", "review counterexamples"])
