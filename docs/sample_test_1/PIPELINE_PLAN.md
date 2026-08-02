# Sample Test 1 — Executable Pipeline

| Task | Concrete work | Artifact / command |
| --- | --- | --- |
| Requirements | Baseline REQ-001..005 and acceptance criteria. | `SPEC.md` |
| Architecture | Inspect state vector, update condition, bypass mux and reset behavior. | `SPEC.md` |
| RTL | Copy licensed KG source and run static analysis. | Verilator, Verible, Slang |
| Verification | Execute reset, bypass, stable-high and stable-low scenarios. | `tb/prim_filter_tb.sv`, Icarus/VVP |
| Formal | Prove the bypass invariant for all input combinations. | `formal/prim_filter.sby` |
| Physical | Synthesize the selected parameter configuration and collect cell statistics. | Yosys |
| Review/Triage | Map all tool evidence to REQ-001..005 and note unproven gaps. | `RESULTS.md` |
