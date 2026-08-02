# Sample Test 2 — Hierarchical Synchronous FIFO

## Design selected from Knowledge DB

- Top module: `prim_fifo_sync.sv` (OpenTitan, ~8KB)
- Submodule: `prim_fifo_sync_cnt.sv` — read/write pointer, wrap and depth logic
- Supporting package: `prim_util_pkg.sv` — parameter width calculations

## Experiment configuration

`Width=8`, `Depth=4`, `Pass=0`, `Secure=0`, `OutputZeroIfEmpty=1`.

## Key requirements

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| REQ-FIFO-001 | Reset makes the FIFO empty and clears observable output state. | `depth_o==0`, `rvalid_o==0` after reset release. |
| REQ-FIFO-002 | Accepted writes increment occupancy until full. | Four writes produce depth 4 and assert `full_o`. |
| REQ-FIFO-003 | Accepted reads return data in FIFO order and decrement occupancy. | Scoreboard observes `3c/a5/5a` in insertion order. |
| REQ-FIFO-004 | Empty/full and `depth_o` remain consistent with the pointer submodule. | Every accepted transfer matches expected depth; end state is empty. |
| REQ-FIFO-005 | The top and its required submodule/package elaborate together. | Hierarchical Verilator elaboration exits with code 0. |
| REQ-FIFO-006 | The FIFO never silently overflows or underflows, for all reachable states, not just the stimulus a directed/UVM test happens to apply. | Formal (SymbiYosys, `smtbmc`, k-induction depth 12) proves `depth_o<=4`, `full_o==(depth_o==4)`, `rvalid_o==(depth_o!=0)`, no accepted write while full, no valid read while empty. See `formal/prim_fifo_sync.sby`. |
