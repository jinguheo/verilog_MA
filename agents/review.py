from .base import Agent, AgentResult


class ReviewAgent(Agent):
    name = "review-agent"

    def run(self, task, context):
        results = context.get("results", [])
        issues = []
        for result in results:
            for issue in result.get("issues", []):
                issues.append({**issue, "reviewed_by": self.name})
        return AgentResult(self.name,
            summary=f"{len(results)}개 agent 결과를 독립 검토했습니다.",
            issues=issues, evidence=[{"type": "agent-results", "count": len(results)}],
            confidence=0.6, next_steps=["triage-agent"])
