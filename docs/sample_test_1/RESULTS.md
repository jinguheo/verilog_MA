# Sample Test 1 — Execution Results

| Pipeline task | Result | Evidence |
| --- | --- | --- |
| Requirements / Architecture | PASS | REQ-001..005 are baselined in `SPEC.md`; reset, bypass, sample history and update logic reviewed. |
| RTL analysis | PASS | Verilator exit 0, Verible exit 0, Slang 0 errors / 0 warnings. |
| Simulation | PASS | Icarus/VVP completed reset, bypass, four-cycle high, and four-cycle low tests. |
| Formal | PASS | SymbiYosys / smtbmc / Yices proved the bypass invariant by k-induction to depth 8. |
| Synthesis | PASS | Yosys: 5 ports, 13 wires, 6 generic cells. |
| Physical signoff | BLOCKED | No PDK, standard-cell library, or OpenLane runtime configured. |

Run `samples/sample_test_1/run_pipeline.ps1` to repeat lint, parsing,
simulation, synthesis, and formal proof.
