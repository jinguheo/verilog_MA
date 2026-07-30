from __future__ import annotations

from typing import Any, Dict
from adapters.verilog_kb import VerilogKnowledgeBase
from agents.requirements import RequirementsAgent
from agents.architecture import ArchitectureAgent
from agents.rtl import RTLAgent
from agents.verification import VerificationAgent
from agents.uvm_team import (
    UVMScenarioAgent,
    UVMEnvironmentAgent,
    UVMCoverageAgent,
    UVMRegressionAgent,
)
from agents.formal import FormalAgent
from agents.manufacturing import ManufacturingAgent
from agents.review import ReviewAgent
from agents.triage import TriageAgent
from capabilities import capability_report
from gap_detector import detect_gaps


class VeriolgMA:
    """Deterministic first version of the multi-agent workflow."""

    def __init__(self, knowledge_root: str = r"D:\MyWork\verilog"):
        self.kb = VerilogKnowledgeBase(knowledge_root)
        self.agents = [
            RequirementsAgent(), ArchitectureAgent(), RTLAgent(), VerificationAgent(),
            UVMScenarioAgent(), UVMEnvironmentAgent(), UVMCoverageAgent(), UVMRegressionAgent(),
            FormalAgent(), ManufacturingAgent(),
        ]

    def run(self, task: Dict[str, Any]) -> Dict[str, Any]:
        context: Dict[str, Any] = {"kb": self.kb, "results": []}
        for agent in self.agents:
            result = agent.run(task, context)
            data = result.as_dict()
            context["results"].append(data)
            if agent.name == "requirements-agent":
                context["requirements"] = data
        review = ReviewAgent().run(task, context).as_dict()
        context["results"].append(review)
        triage = TriageAgent().run(task, context).as_dict()
        return {"task": task, "knowledge_base": self.kb.health(),
                "agents": context["results"], "triage": triage,
                "capabilities": capability_report(),
                "gaps": detect_gaps(context["results"])}
