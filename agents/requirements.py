from .base import Agent, AgentResult
from contracts_validator import load_schema, validate

REQUIREMENT_SCHEMA = load_schema("requirement.schema.json")

AMBIGUOUS = ("fast", "simple", "high performance", "low power", "as needed", "etc", "soon")
NON_FUNCTIONAL = ("latency", "throughput", "frequency", "power", "area", "timing", "bandwidth", "reliability")
INTERFACE = ("clock", "reset", "input", "output", "interface", "axi", "apb", "ahb", "irq", "interrupt")


class RequirementsAgent(Agent):
    name = "requirements-agent"

    def run(self, task, context):
        text = task.get("requirements", task.get("prompt", "")).strip()
        if not text:
            return AgentResult(self.name, "blocked", "requirements 입력이 없습니다.", confidence=1.0)
        lines = [x.strip(" -•\t") for x in text.splitlines() if x.strip()]
        reqs = []
        for i, line in enumerate(lines, 1):
            lower = line.lower()
            kind = "non_functional" if any(x in lower for x in NON_FUNCTIONAL) else "interface" if any(x in lower for x in INTERFACE) else "functional"
            methods = ["simulation", "review"]
            if kind == "non_functional": methods += ["synthesis", "formal"]
            if kind == "interface": methods += ["assertion"]
            req = {"requirement_id": f"REQ-{i:03d}", "text": line, "type": kind,
                   "verification_methods": methods,
                   "acceptance_criteria": [f"{line} is demonstrated by a reproducible test or tool report"],
                   "source": task.get("source", "customer-input")}
            errors = validate(REQUIREMENT_SCHEMA, req)
            if errors:
                raise ValueError(f"requirement violates contracts/requirement.schema.json: {errors}")
            reqs.append(req)
        issues = []
        if len(lines) == 1 and len(text) < 30:
            issues.append(self.issue("requirements", "medium", "요구사항이 지나치게 짧아 모호할 수 있습니다."))
        for req in reqs:
            if any(word in req["text"].lower() for word in AMBIGUOUS):
                issues.append(self.issue("requirements", "high", f"모호한 표현: {req['text']}", requirement_ids=[req["requirement_id"]], requires_customer_clarification=True))
            if req["type"] == "non_functional" and not any(ch.isdigit() for ch in req["text"]):
                issues.append(self.issue("requirements", "high", f"수치 목표가 없는 비기능 요구사항: {req['text']}", requirement_ids=[req["requirement_id"]], requires_customer_clarification=True))
        return AgentResult(self.name, summary=f"{len(reqs)}개 요구사항을 추출했습니다.",
                           artifacts=[{"kind": "requirements", "items": reqs}],
                           issues=issues, confidence=0.72,
                           next_steps=["architecture-agent", "verification-agent"])
