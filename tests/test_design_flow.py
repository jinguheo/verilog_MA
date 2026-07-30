import unittest
from design_flow import readiness

EMPTY_TOOLCHAIN = {"tools": {}, "simulator_ready": False}


def gate_status(checks, gate):
    return next(c["status"] for c in checks if c["gate"] == gate)


class DesignFlowReadinessTest(unittest.TestCase):
    def test_rtl_gate_passes_when_agent_ran_without_lint_evidence(self):
        result = readiness([{"agent": "rtl-agent", "evidence": []}], EMPTY_TOOLCHAIN)
        self.assertEqual(gate_status(result["checks"], "rtl"), "pass")

    def test_rtl_gate_passes_when_lint_passed(self):
        results = [{"agent": "rtl-agent", "evidence": [
            {"type": "lint-run", "data": {"status": "passed"}}]}]
        result = readiness(results, EMPTY_TOOLCHAIN)
        self.assertEqual(gate_status(result["checks"], "rtl"), "pass")

    def test_rtl_gate_blocked_when_lint_failed(self):
        results = [{"agent": "rtl-agent", "evidence": [
            {"type": "lint-run", "data": {"status": "failed"}}]}]
        result = readiness(results, EMPTY_TOOLCHAIN)
        self.assertEqual(gate_status(result["checks"], "rtl"), "blocked")

    def test_simulation_gate_uses_actual_run_result(self):
        passing = [{"agent": "verification-agent", "evidence": [
            {"type": "simulator-run", "data": {"status": "passed"}}]}]
        result = readiness(passing, EMPTY_TOOLCHAIN)
        self.assertEqual(gate_status(result["checks"], "simulation"), "pass")

        failing = [{"agent": "verification-agent", "evidence": [
            {"type": "simulator-run", "data": {"status": "failed"}}]}]
        result = readiness(failing, {"tools": {}, "simulator_ready": True})
        self.assertEqual(gate_status(result["checks"], "simulation"), "blocked")

    def test_simulation_gate_falls_back_to_toolchain_when_no_run_evidence(self):
        result = readiness([{"agent": "verification-agent", "evidence": []}],
                            {"tools": {}, "simulator_ready": True})
        self.assertEqual(gate_status(result["checks"], "simulation"), "pass")


if __name__ == "__main__":
    unittest.main()
