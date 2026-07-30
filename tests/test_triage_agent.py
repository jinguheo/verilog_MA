import tempfile
import unittest
from pathlib import Path
from agents.triage import TriageAgent


class TriageAgentTest(unittest.TestCase):
    def test_persists_and_flags_repeat_issues_across_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            store_path = str(Path(tmp) / "issues.json")
            context = {"results": [{"issues": [
                {"issue_id": "ISSUE-1", "category": "requirements", "severity": "high",
                 "finding": "ambiguous phrase", "status": "open"},
            ]}]}

            first = TriageAgent().run({"issue_store_path": store_path}, context).as_dict()
            self.assertEqual(first["issues"][0]["occurrences"], 1)

            context["results"][0]["issues"][0]["issue_id"] = "ISSUE-2"
            second = TriageAgent().run({"issue_store_path": store_path}, context).as_dict()
            self.assertEqual(second["issues"][0]["occurrences"], 2)
            self.assertEqual(second["issues"][0]["duplicate_of"], "ISSUE-1")


if __name__ == "__main__":
    unittest.main()
