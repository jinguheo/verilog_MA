"""UVM verification-team planning agents.

The team consumes the designer smoke-test plan and produces an explicit UVM
verification manifest.  It does not claim to run UVM until a SystemVerilog
UVM simulator and a concrete testbench are available.
"""

from .base import Agent, AgentResult


class UVMScenarioAgent(Agent):
    """Turn requirements into scenario-level UVM tests."""

    name = "uvm-scenario-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        requirements = context.get("requirements", {}).get("artifacts", [])
        items = []
        for artifact in requirements:
            for req in artifact.get("items", []):
                req_id = req.get("requirement_id", "REQ-UNKNOWN")
                text = req.get("text", "requirement behavior")
                items.append({
                    "scenario_id": f"UVM-SCEN-{len(items) + 1:03d}",
                    "requirement_id": req_id,
                    "name": f"nominal_{req_id.lower()}",
                    "kind": "nominal",
                    "stimulus": text,
                    "expected": req.get("acceptance_criteria", [text]),
                    "sequence": "uvm_sequence",
                })

        baseline = [
            ("reset_sequence", "reset", "apply reset, release reset, check legal state"),
            ("idle_to_active", "nominal", "drive a legal transaction from idle"),
            ("backpressure", "stress", "hold ready low and verify no data loss"),
            ("illegal_transaction", "negative", "drive an invalid transaction and check response"),
        ]
        existing_names = {item["name"] for item in items}
        for name, kind, stimulus in baseline:
            if name not in existing_names:
                items.append({
                    "scenario_id": f"UVM-SCEN-{len(items) + 1:03d}",
                    "requirement_id": None,
                    "name": name,
                    "kind": kind,
                    "stimulus": stimulus,
                    "expected": ["scoreboard reports no unexpected mismatch"],
                    "sequence": "uvm_sequence",
                })

        return AgentResult(
            self.name,
            status="planned",
            summary=f"{module} UVM 시나리오 {len(items)}개를 계획했습니다.",
            artifacts=[{
                "kind": "uvm-scenario-plan",
                "module_name": module,
                "simulator": task.get("uvm_simulator", "questa"),
                "scenarios": items,
            }],
            confidence=0.8,
            next_steps=["uvm-environment-agent", "uvm-coverage-agent"],
        )


class UVMEnvironmentAgent(Agent):
    """Define the reusable UVM testbench topology."""

    name = "uvm-environment-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        return AgentResult(
            self.name,
            status="planned",
            summary=f"{module} UVM testbench 구조를 정의했습니다.",
            artifacts=[{
                "kind": "uvm-environment-manifest",
                "module_name": module,
                "top": f"{module}_uvm_tb",
                "components": [
                    "uvm_test", "uvm_env", "uvm_agent", "uvm_sequencer",
                    "uvm_driver", "uvm_monitor", "uvm_scoreboard", "uvm_subscriber",
                ],
                "interfaces": [f"{module}_if"],
                "transaction": f"{module}_transaction",
                "dut_binding": module,
            }],
            confidence=0.85,
            next_steps=["implement SystemVerilog UVM components", "uvm-regression-agent"],
        )


class UVMCoverageAgent(Agent):
    """Define functional coverage and closure targets."""

    name = "uvm-coverage-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        return AgentResult(
            self.name,
            status="planned",
            summary=f"{module} 기능 커버리지 목표를 정의했습니다.",
            artifacts=[{
                "kind": "uvm-coverage-plan",
                "module_name": module,
                "covergroups": [
                    {"name": "cg_reset", "points": ["reset_asserted", "reset_released"]},
                    {"name": "cg_transaction", "points": ["opcode", "burst_length", "response"]},
                    {"name": "cg_protocol", "points": ["valid_ready", "backpressure", "error_response"]},
                ],
                "crosses": ["opcode_x_response", "backpressure_x_burst_length"],
                "closure_target": 100,
            }],
            confidence=0.78,
            next_steps=["implement covergroups", "run regression", "review uncovered bins"],
        )


class UVMRegressionAgent(Agent):
    """Define scenario matrix and pass/fail gates for regressions."""

    name = "uvm-regression-agent"

    def run(self, task, context):
        module = task.get("module_name", "generated_module")
        tests = [
            {"test": "reset_test", "tier": "smoke", "seeds": 1},
            {"test": "nominal_test", "tier": "feature", "seeds": 10},
            {"test": "negative_test", "tier": "feature", "seeds": 10},
            {"test": "stress_test", "tier": "nightly", "seeds": 100},
        ]
        return AgentResult(
            self.name,
            status="planned",
            summary=f"{module} UVM regression matrix를 정의했습니다.",
            artifacts=[{
                "kind": "uvm-regression-plan",
                "module_name": module,
                "tests": tests,
                "gates": [
                    "zero scoreboard mismatches",
                    "zero unexpected assertions",
                    "functional coverage target reached",
                ],
            }],
            confidence=0.8,
            next_steps=["implement simulator runner", "run smoke tier", "run full regression"],
        )
