from .base import Agent, AgentResult
from issue_store import IssueStore


class TriageAgent(Agent):
    name = "triage-agent"

    def run(self, task, context):
        issues = []
        for result in context.get("results", []):
            issues.extend(result.get("issues", []))
        order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        issues.sort(key=lambda x: order.get(x.get("severity", "medium"), 2))

        store_path = task.get("issue_store_path")
        store = IssueStore(store_path) if store_path else IssueStore()
        annotated = store.record(issues)
        repeats = sum(1 for i in annotated if "duplicate_of" in i)

        return AgentResult(self.name, summary=f"{len(annotated)}개 이슈를 분류했습니다 ({repeats}개는 이전에도 발견됨).",
                           issues=annotated, confidence=0.8,
                           next_steps=["human approval for critical/high issues"])
