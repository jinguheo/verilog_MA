import unittest
from agents.rtl import RTLAgent


class RTLAgentTest(unittest.TestCase):
    def test_without_rtl_file_only_plans(self):
        result = RTLAgent().run({"module_name": "fifo"}, {"requirements": {}})
        data = result.as_dict()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(len(data["evidence"]), 1)
        self.assertEqual(data["evidence"][0]["type"], "knowledge-db")

    def test_with_missing_rtl_file_reports_blocked_or_external(self):
        result = RTLAgent().run(
            {"module_name": "fifo", "rtl_file": "does-not-exist.sv"},
            {"requirements": {}},
        )
        data = result.as_dict()
        self.assertEqual(len(data["evidence"]), 2)
        self.assertEqual(data["evidence"][1]["type"], "lint-run")
        self.assertIn(data["status"], ("blocked", "external-required"))


if __name__ == "__main__":
    unittest.main()
