# Sample Test 1 — Results

- RTL analysis: PASS — Verilator, Verible, Slang.
- Simulation: PASS — reset, bypass, four-cycle high, four-cycle low.
- Formal: PASS — k-induction depth 8 with SymbiYosys/smtbmc/Yices.
- Synthesis: PASS — 5 ports, 13 wires, 6 generic cells.
- Physical signoff: BLOCKED — no PDK or OpenLane environment configured.

## Physical signoff

This gate remains blocked by environment, not by an RTL failure. It requires a
target technology PDK, standard-cell library, timing constraints, and a
physical implementation runtime.
