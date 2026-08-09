# Sample Test 2 — prim_fifo_sync verification results

Run date: 2026-08-08 (Width=8, Depth=4, OpenTitan `prim_fifo_sync`)

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File samples\sample_test_2\uvm\run_verilator_uvm.ps1 -Jobs 12
powershell -ExecutionPolicy Bypass -File samples\sample_test_2\uvm\run_verilator_uvm.ps1 -Jobs 12 -Mutant
sby -f samples\sample_test_2\formal\prim_fifo_sync.sby
sby -f samples\sample_test_2\formal\prim_fifo_sync_MUTANT.sby
```

## Verification layers

| Layer | Result | Evidence |
| --- | --- | --- |
| Smoke (directed) | PASS | `fifo_smoke_seq` — 3 pushes then 3 pops, hardcoded data. |
| Directed requirement | PASS | `fifo_fill_drain_seq` — fill to full (4) then drain to empty; REQ-FIFO-001..004. |
| Negative / reject path | PASS | `fifo_negative_seq` — push-at-full and pop-at-empty both correctly refused; reject bins 2/2. |
| Randomized traffic | PASS | `fifo_random_seq` — 16..24 items, `$urandom` op mix and data, then drained to empty. |
| Functional coverage | PASS (4/4 reachable) | op × depth: `PUSH.mid=16 PUSH.full=7 POP.empty=4 POP.mid=19`. `PUSH.empty` and `POP.full` are structurally unreachable. |
| Formal (k-induction, depth 12) | PASS | 5 safety properties, basecase + induction both pass. |
| Scoreboard | PASS | `UVM FIFO PASS: 23 checked reads`, `UVM_ERROR: 0`, `UVM_FATAL: 0`. |

## Checker sanity (mutation testing)

`mutants/prim_fifo_sync_cnt_MUTANT_full_stuck_low.sv` is `prim_fifo_sync_cnt.sv` with
one line changed — `full_o` stuck at `1'b0`, so the FIFO silently overflows instead of
rejecting writes. Both harnesses were re-run unchanged against it to prove the checks
are not vacuous:

| Harness | Golden RTL | Mutant RTL |
| --- | --- | --- |
| UVM regression | `UVM_ERROR: 0` | `UVM_ERROR: 16` — REQ-FIFO-002 ×7, REQ-FIFO-004 ×4, REQ-FIFO-005 ×3, plus scoreboard `data mismatch got=de` and "did not close cleanly". |
| Formal (`prove`, depth 12) | `PASS` | `FAIL` with concrete counterexample (`formal/prim_fifo_sync_MUTANT/`: `trace.vcd`, `trace_induct.vcd`). |

The mutant is caught at the exact requirement it breaks (full flag / overflow), not just
by a downstream symptom, so the reject-path checks carry real signal.

## Known gaps

- **Constraint solver unavailable.** `fifo_random_seq` uses `$urandom`/`$urandom_range`
  rather than `randomize()`: Verilator's constraint solver shells out to an external
  SAT/SMT process and that handshake fails on this Windows + MinGW build
  ("Unable to communicate with SAT solver"). Stimulus is genuinely randomized, but
  there are no SV constraint blocks being solved.
- **DUT built-in SVA not connected.** `prim_fifo_assert.svh` is excluded from both the
  UVM and formal compile lists. The oss-cad-suite slang plugin cannot parse
  `prim_count`'s temporal operators (`|=>`, `$past`, `$stable`) under the `YOSYS` macro
  set, and hits "unsupported SVA feature" on `assert property (@(posedge clk)
  disable iff ...)` under the real-SVA macro set. Tooling gap, not fixable from this repo.
- **No commercial simulator run.** `run_questa.ps1` exists but has not been run against a
  licensed IEEE 1800.2 simulator.
