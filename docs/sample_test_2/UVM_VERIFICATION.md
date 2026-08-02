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

Two run paths exist:

**Verilator (`--timing`), bundled with `oss-cad-suite`, executed locally:**

```powershell
Set-Location D:\MyWork\Veriolg_MA
.\samples\sample_test_2\uvm\run_verilator_uvm.ps1
```

Builds `Vprim_fifo_sync_uvm_tb.exe` into `samples\sample_test_2\obj_uvm` and
runs it. `-LintOnly` runs elaboration only; `-OutDirName <name>` picks a
different build directory (useful if `obj_uvm` is locked by a stale process).

**Full IEEE 1800.2/UVM simulator (Questa or ModelSim), not executed locally:**

```powershell
Set-Location D:\MyWork\Veriolg_MA
.\samples\sample_test_2\uvm\run_questa.ps1
```

Both scripts compile the bundled Accellera UVM library from
`third_party/uvm-core`, then compile the OpenTitan FIFO hierarchy and start
`fifo_smoke_test`.

## Current execution status

**PASS (2026-08-02), via `run_verilator_uvm.ps1`:** `UVM_ERROR: 0`,
`UVM_FATAL: 0`, `[FIFO_SB] UVM FIFO PASS: 7 checked reads`, process exit code
0. This is a real UVM class-library run (sequencer, driver, monitor,
scoreboard, `uvm_test_top`) executing on Verilator's `--timing` scheduler, not
a plain Verilator smoke test. See `docs/session_notes/2026-08-02.md` for the
three Windows toolchain bugs that blocked this and how each was diagnosed and
fixed.

`run_questa.ps1` (a full IEEE 1800.2/UVM simulator run with complete class,
TLM and coverage support) is **ready but not executed locally**, because
`vlog`/`vsim` are not installed. Verilator's `--timing` UVM support is
sufficient for this FIFO smoke/requirements test but is not a substitute for
a signoff-grade UVM simulator on larger designs.

## Functional coverage

`fifo_driver` tracks an op × depth-bucket (empty/mid/full) hit matrix and
reports it in `report_phase` as `[FIFO_COV]`.

**Verilator 5.051 (devel) cannot parse a `covergroup` declared inside a class
when it is referenced as another member's data type** — confirmed with a
minimal standalone repro (`covergroup my_cg ... endgroup; my_cg cov;` inside
a `class` fails with `Expecting a data type`, while the identical covergroup
at module scope compiles clean). Since UVM components are classes, native
SystemVerilog covergroups are not usable for UVM functional coverage on this
toolchain. The hit-count matrix in `fifo_driver` reports the same bin
information without hitting that limitation.

Latest result (2026-08-02): `4/6 (66.7%)` —
`PUSH.empty=0 PUSH.mid=6 PUSH.full=1 POP.empty=2 POP.mid=5 POP.full=0`.
`PUSH.empty` and `POP.full` are **structurally unreachable** with the
current sampling design (it buckets the depth *after* the operation, and a
push can never leave depth at 0, nor a pop leave depth at 4) — this is not
a real coverage hole, it is a modeling artifact. The real gap the number is
masking: neither test sequence currently attempts a *blocked* push at
depth 4 or a *blocked* pop at depth 0. Fixing this properly means either (a)
bucketing depth *before* the operation instead of after, or (b) adding
explicit negative-path sequences that attempt a push while full / pop while
empty and confirm they are rejected. Tracked as a next-session item.

## Formal verification

`formal/prim_fifo_sync.sby` proves REQ-FIFO-006 (see `SPEC.md`) with
SymbiYosys, `smtbmc`, k-induction, `depth 12`. Properties in
`formal/prim_fifo_sync_formal.sv`: `depth_o<=4`; `full_o==(depth_o==4)`;
`rvalid_o==(depth_o!=0)`; no accepted write while full; no valid read while
empty. A three-cycle `assume` forces a real reset at the start of every
trace so k-induction's base case starts from a known-good state instead of
an arbitrary initial register value.

**Result (2026-08-02): PASS** — both basecase and induction report `passed`
(`DONE (PASS, rc=0)`).

Getting the read step to work required switching from `read -formal -sv`
(Yosys's built-in Verilog frontend) to `plugin -i slang; read_slang` — the
built-in frontend rejected `prim_fifo_sync.sv`'s embedded
`` `ASSERT(.... |-> ....) `` SVA property (from `prim_assert.sv`) with a bare
`syntax error, unexpected '>'`; the slang-based frontend parses it
correctly.

Run: `sby_windows.cmd -f formal\prim_fifo_sync.sby` (invoke from
`samples\sample_test_2`, after sourcing `start_windows_eda.ps1 -CheckOnly` to
put `yosys`/`sby` on `PATH` — `[files]` paths in the `.sby` resolve relative
to the invocation directory, not the `.sby` file's own location).
