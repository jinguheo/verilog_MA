import unittest
from agents.verification import VerificationAgent


class VerificationAgentTest(unittest.TestCase):
    def test_without_rtl_file_only_plans(self):
        result = VerificationAgent().run({"module_name": "fifo"}, {"requirements": {"artifacts": []}})
        data = result.as_dict()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["evidence"], [])

    def test_with_missing_rtl_file_reports_blocked_or_external(self):
        result = VerificationAgent().run(
            {"module_name": "fifo", "rtl_file": "does-not-exist.sv"},
            {"requirements": {"artifacts": []}},
        )
        data = result.as_dict()
        self.assertEqual(len(data["evidence"]), 1)
        self.assertEqual(data["evidence"][0]["type"], "simulator-run")
        self.assertIn(data["status"], ("blocked", "external-required"))


if __name__ == "__main__":
    unittest.main()
