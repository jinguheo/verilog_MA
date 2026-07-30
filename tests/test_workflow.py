import tempfile
import unittest
from pathlib import Path
from orchestrator import VeriolgMA
from adapters.verilog_kb import VerilogKnowledgeBase


class WorkflowTest(unittest.TestCase):
    def test_knowledge_base_audit_is_read_only(self):
        audit = VerilogKnowledgeBase(".").audit()
        self.assertTrue(audit["read_only"])
        self.assertIn("openlane_config", audit["missing"])

    def test_all_specialized_agents_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = VeriolgMA(knowledge_root=".").run({
                "module_name": "fifo",
                "requirements": "input is accepted\noutput preserves ordering",
                "issue_store_path": str(Path(tmp) / "issues.json"),
            })
        names = [x["agent"] for x in result["agents"]]
        self.assertIn("requirements-agent", names)
        self.assertIn("rtl-agent", names)
        self.assertIn("architecture-agent", names)
        self.assertIn("verification-agent", names)
        self.assertIn("uvm-scenario-agent", names)
        self.assertIn("uvm-environment-agent", names)
        self.assertIn("uvm-coverage-agent", names)
        self.assertIn("uvm-regression-agent", names)
        self.assertIn("formal-agent", names)
        self.assertIn("manufacturing-agent", names)
        self.assertEqual(result["triage"]["agent"], "triage-agent")
        self.assertEqual(result["capabilities"]["items"]["rtl-agent"]["status"], "partial")
        self.assertTrue(any(x["component"] == "manufacturing-agent" and
                            x["status"] == "external-required" for x in result["gaps"]))

        uvm = next(x for x in result["agents"] if x["agent"] == "uvm-environment-agent")
        self.assertEqual(uvm["status"], "planned")
        self.assertIn("uvm_scoreboard", uvm["artifacts"][0]["components"])


if __name__ == "__main__":
    unittest.main()
