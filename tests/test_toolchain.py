import unittest
from toolchain import STATIC_ANALYSIS_ORDER, detect_toolchain, run_simulator


class ToolchainTest(unittest.TestCase):
    def test_detection_has_expected_tools(self):
        result = detect_toolchain()
        self.assertIn("verilator", result["tools"])
        self.assertIn("iverilog", result["tools"])
        self.assertIn("verible", result["tools"])
        self.assertIn("pyslang", result["tools"])
        self.assertEqual(result["total"], 10)

    def test_missing_simulator_is_explicit(self):
        result = run_simulator("verilator", "does-not-exist.sv")
        self.assertIn(result["status"], ("external-required", "blocked"))

    def test_static_analysis_order(self):
        self.assertEqual(STATIC_ANALYSIS_ORDER, ("verilator", "verible", "slang"))


if __name__ == "__main__":
    unittest.main()
