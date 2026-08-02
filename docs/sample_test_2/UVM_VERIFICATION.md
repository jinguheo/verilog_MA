# Sample Test 2 — UVM Verification

## Implemented testbench

The UVM environment is in `samples/sample_test_2/uvm/`.

| Component | Responsibility |
| --- | --- |
| `prim_fifo_sync_if` | Clock, reset, write/read handshake and status signals |
| `fifo_item` | Reset, push and pop transaction object |
| `fifo_smoke_seq` | REQ-FIFO-003: pushes `3c/a5/5a` and ordered pops |
| `fifo_fill_drain_seq` | REQ-FIFO-002/004: fills to depth 4/full, then drains to empty |
| `fifo_driver` | Cycle-accurate DUT stimulus and read-data sampling |
| `fifo_monitor` | Independent accepted-read/write protocol counters |
| `fifo_scoreboard` | Reference queue; reports data/order mismatch and non-empty end state |
| `fifo_agent` / `fifo_env` | Sequencer, driver, monitor and scoreboard composition |
| `fifo_smoke_test` | Raises/drops UVM objections and launches the smoke sequence |

## Pass gate

The test passes only when the scoreboard reports zero mismatches, its expected
queue is empty at `check_phase`, depth checks succeed after each accepted
transfer, and UVM reports no errors. The requirements test executes
REQ-FIFO-001 through REQ-FIFO-004; REQ-FIFO-005 is covered by the separate
hierarchical Verilator elaboration gate.

## Run command

Use a full IEEE 1800.2/UVM simulator (Questa or ModelSim) and run:

```powershell
Set-Location D:\MyWork\Veriolg_MA
.\samples\sample_test_2\uvm\run_questa.ps1
```

The script compiles the bundled Accellera UVM library from
`third_party/uvm-core`, then compiles the OpenTitan FIFO hierarchy and starts
`fifo_smoke_test`.

## Current execution status

The existing Verilator smoke test is PASS. A standard UVM run is **ready but
not executed locally**, because `vlog` and `vsim` are not installed. Verilator
is not used as the UVM signoff simulator in this project; the full UVM library
requires a simulator with complete class, TLM and coverage support.
