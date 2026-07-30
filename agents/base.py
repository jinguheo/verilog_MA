from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List
import uuid

from contracts_validator import load_schema, validate

ISSUE_SCHEMA = load_schema("issue.schema.json")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AgentResult:
    agent: str
    status: str = "ok"
    summary: str = ""
    artifacts: List[Dict[str, Any]] = field(default_factory=list)
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    issues: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    next_steps: List[str] = field(default_factory=list)
    run_id: str = field(default_factory=lambda: f"run-{uuid.uuid4().hex[:12]}")

    def as_dict(self) -> Dict[str, Any]:
        return {"agent": self.agent, "status": self.status, "summary": self.summary,
                "artifacts": self.artifacts, "evidence": self.evidence,
                "issues": self.issues, "confidence": self.confidence,
                "next_steps": self.next_steps, "run_id": self.run_id, "created_at": now()}


class Agent:
    name = "agent"

    def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> AgentResult:
        raise NotImplementedError

    @staticmethod
    def issue(category: str, severity: str, finding: str, **extra: Any) -> Dict[str, Any]:
        result = {"issue_id": f"ISSUE-{uuid.uuid4().hex[:8].upper()}", "category": category,
                  "severity": severity, "finding": finding, "status": "open", **extra}
        errors = validate(ISSUE_SCHEMA, result)
        if errors:
            raise ValueError(f"issue violates contracts/issue.schema.json: {errors}")
        return result
