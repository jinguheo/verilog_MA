# Sample Test 3 — Data acquisition subsystem results

Run date: 2026-08-08

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File samples\sample_test_3\uvm\run_verilator_uvm.ps1 -Jobs 12 -ClockSweep 6
powershell -ExecutionPolicy Bypass -File samples\sample_test_3\uvm\run_verilator_uvm.ps1 -Jobs 12 -AssertionFailDemo
powershell -ExecutionPolicy Bypass -File samples\sample_test_3\formal\run_formal.ps1
powershell -ExecutionPolicy Bypass -File samples\sample_test_3\formal\run_formal.ps1 -Mutant
```

## Design scope

RTL is `rtl/daq_top.sv` (344 lines, 229 excluding comments and blanks) plus
`rtl/daq_if.sv`. Two modules: `daq_async_fifo` and `daq_top`.

- Three independent clocks: control, source, DMA. Half-periods default to 5/3/7 and are
  settable at runtime (`+CTRL_HP` / `+SRC_HP` / `+DMA_HP` / `+RANDOM_CLOCKS`).
- **Register file** with read and write paths: `CTRL`, `CMD`, `INTR_EN`,
  `INTR_STATE` (per-bit write-1-to-clear), `STATUS` (busy, byte_count), `ID`.
- **DMA FSM**, five states: `IDLE → ARMED → XFER → COMPLETE / ERROR`.
- **CRC-8** (polynomial 0x07, init 0x00) computed over the payload and compared against
  the value the source appends on the `eop` beat. The `crc_inject` bit corrupts the
  computed value so the comparison itself is what fails.
- Asynchronous FIFO, depth 8, Gray pointers with two-flop pointer synchronizers.
- DMA write port with AXI-style `valid`/`ready` and a write response, a 16-entry target
  memory, four sticky interrupt causes and an interrupt enable mask.
- Six simulation SVA properties.

### Clock-domain crossings

Every crossing is explicit. Single sticky bits use two-flop synchronizers. Anything
multi-bit uses a data+toggle handshake so the payload is stable before the receiver is
told to look at it — that covers the W1C mask and the `CMD` clear going into the DMA
domain, and `byte_count` coming back out.

The raw FSM encoding is deliberately **not** exposed in the register map: a 3-bit state
cannot cross a clock boundary coherently without its own handshake, and a debug register
does not justify one. `STATUS` exposes a single `busy` bit instead.

## UVM regression

`UVM_ERROR: 0`, `UVM_FATAL: 0`, exit code 0. Nine subtests, 21 individual checks.

| Subtest | Result | Evidence |
| --- | --- | --- |
| Nominal end-to-end | PASS | Payload `11 22 33 44` in memory in order; `done=1`, `irq=1`, no error bits. `STATUS` readback shows `byte_count=4`, `busy=0` — the CRC beat is not written to memory. |
| CRC mismatch | PASS | A corrupted transmitted CRC is caught by the DUT's own comparison: sticky `crc_error` and `irq`, payload still delivered. |
| CRC fault injection | PASS | The `crc_inject` bit corrupts the computed value instead, flagging a well-formed packet. Same comparator, opposite side. |
| DMA backpressure | PASS | 60% random `dma_wready` stalls; 8 bytes arrived in order, `fifo_overflow` and `crc_error` stayed clear. |
| Write-response error | PASS | `dma_wresp_err` on beat 1 moved the FSM to `ERROR`, latched sticky `bus_error` and `irq`, left `done` low, and issued no further beats over the next 30 cycles. |
| FIFO overflow stress | PASS | 12 bytes offered into an 8-deep FIFO with the DMA disabled: exactly 8 accepted, `src_ready` dropped, `fifo_overflow` set, no DMA writes while disabled, all 8 recovered in order after enabling. |
| Reset during traffic | PASS | Reset mid-packet cleared every status bit and returned the FIFO to empty; a full packet completed afterwards from address 0. |
| Register map | PASS | `ID` reads `0x0DA00001`. With every cause masked, `irq` stayed low while `INTR_STATE` still recorded the event; unmasking raised `irq`. W1C of the done bit left `crc_error` pending. |
| FSM recovery | PASS | `busy` dropped on completion; `CMD` clear reset the state and dropped `done`/`irq`; a second transfer then completed with `byte_count=3`. |

Every subtest is scoreboarded end to end: a source-side monitor records each payload byte
the DUT accepted and a DMA-side monitor records each byte it wrote out, and the two queues
must match exactly, in order, with sequential addresses. The `mem0..mem3` outputs only
expose the first four addresses, so they alone would not catch a loss past byte 4.

### Clock-ratio sweep

Replayed at seven clock configurations — the 5/3/7 default plus six randomized triples
(6/2/5, 7/3/5, 5/4/9, 11/9/10, 5/2/9, 8/5/6), covering source faster than DMA, slower
than DMA, and near-equal. All seven passed. No wait in the testbench is a fixed cycle
count; every one is a bounded poll on the condition it cares about, which is what makes
the sweep meaningful rather than incidental.

### Checker sanity

`-AssertionFailDemo` enables the deliberate IRQ-without-cause hook. Result: `%Error:
daq_top.sv:314: Assertion failed`, exit code 1 — `p_irq_has_cause` does fail when the
design breaks it.

## Formal

| Proof | Mode | Result | Properties |
| --- | --- | --- | --- |
| `formal/daq_status_sync.sby` | **prove (unbounded)**, single clock | **PASS by k-induction** (1 s) | Interrupt masking equality, per-bit W1C semantics, FSM encoding and transition legality, DMA write-port protocol, plus the FIFO pointer invariants needed to close induction. |
| `formal/daq_fifo.sby` | bmc, depth 40, multiclock | PASS (46 s) | Gray-code pointer invariants; occupancy never exceeds depth; `w_full`/`r_empty` pessimistic but never optimistic; no silent overflow or underflow. |
| `formal/daq_status.sby` | bmc, depth 40, multiclock | PASS | The same status/FSM/protocol properties with the three clocks left free. |

The two modes are complementary and neither alone covers the block:

- **`multiclock on`** lowers the design with `clk2fflogic`, leaving the three clocks as
  free inputs so the solver may interleave their edges arbitrarily. This is the only run
  that says anything about clock-domain crossing — but it is bounded.
- **The single-clock abstraction** ties the three domains together. That removes CDC from
  the picture entirely, and in exchange gives a genuine unbounded proof of the register
  file, FSM and DMA protocol.

### What formal caught that simulation did not

Twice, and both times the property was written stronger than the design contract while
the UVM regression was passing:

1. **Enable carve-out on the wrong side.** The first request-stability property put the
   "software disabled the block" exception in the antecedent rather than the consequent.
   The base case produced a counterexample in which software legitimately disables while
   a request is stalled.
2. **Enable low for a single cycle.** After the RTL expansion the base case failed again
   at step 9. The trace showed `enable_d2` low for exactly one cycle in `S_XFER` with a
   stalled request: the FSM aborted correctly on that, but the property read the
   *current* enable, which was already back high. The carve-out now applies on both sides
   of the edge — and **the same defect was present in the RTL's own `p_wvalid_held` SVA**,
   which was fixed to match. Simulation never produced that timing.

### Why the multiclock proofs cannot close induction

`mode prove` was attempted on the multiclock runs and its base case passes, but induction
fails. The counterexample was diagnosed rather than assumed:

- A `tick`/`p_tick` counter pair in the harness asserts only "one assertion evaluation is
  one clock edge later". It holds at the violating state, so the one-edge history model
  every property relies on is sound.
- The counterexample trace holds `tick` constant across all 40 timesteps and advances it
  exactly once, at the very end — **the whole trace contains a single clock edge**, and
  the violating state is the trace's arbitrary initial state, entered by no transition.

With free clock inputs, an induction trace of any depth may contain zero clock edges, so a
history-based property is simply evaluated against an arbitrary unreachable state. No
depth increase fixes it. **The counterexample is spurious — not a design defect.**
`formal/daq_status_prove.sby` keeps it reproducible in one command.

Tying the clocks together removes that degree of freedom, and with the FIFO pointer
invariants supplied as induction helpers, `daq_status_sync.sby` closes. Those helpers are
`assert`ed rather than `assume`d, so they are proof obligations too, and they are stated
only in the single-clock harness where the one-edge lag bounds genuinely hold. The
equivalent bounds are deliberately absent from `daq_fifo_formal.sv`, where they would be
false.

### Checker sanity (formal mutation)

`mutants/daq_top_MUTANT.sv` is `rtl/daq_top.sv` with two `ifdef`-selectable defects. Both
proofs were re-run against it unchanged:

| Mutant | Proof | Result | Caught by |
| --- | --- | --- | --- |
| `MUTANT_POP_IGNORES_READY` — FIFO popped on `dma_wvalid` alone, so a stalled memory silently loses data | `daq_status_sync_MUTANT.sby` | **FAIL** at step 8 | The no-pop-without-ready property |
| `MUTANT_FIFO_FULL_STUCK_LOW` — `w_full` tied to 0, so the FIFO silently overwrites unread entries | `daq_fifo_MUTANT.sby` | **FAIL** at step 19 | `w_full \|\| occ < DEPTH` — the "full flag is never optimistic" property |

Each mutant is caught by the property that states exactly the guarantee it breaks, not by
a downstream symptom. `run_formal.ps1 -Mutant` inverts the exit status, so a mutant that
passes is reported as the failure it is.

## Open items (deliberately not claimed as passing)

- **CDC coverage is bounded only.** The unbounded proof is the single-clock abstraction,
  which says nothing about clock-domain crossing. Everything proved about CDC comes from
  the depth-40 multiclock runs and the UVM clock-ratio sweep. Depth 40 is a cost
  trade-off, not a claim of sufficiency — solve time grows sharply, and step 50 of the
  FIFO proof took roughly 9 minutes on this machine, so depth 120 was abandoned.
- **No unbounded multiclock proof.** Closing one would need an inductive invariant that
  survives traces containing no clock edge, which the free-clock model makes awkward.
  Not attempted.
- **Not AXI4-Lite.** The CSR interface is a raw `we`/`re`/`addr`/`wdata`/`rdata` bus and
  the DMA port is AXI-*style* valid/ready with a one-bit response. There are no separate
  address/data/response channels, no bursts, no 4 KB boundary handling, and no
  SLVERR/DECERR modelling.
- **Not split into IPs.** The blueprint separates `csr_axil`, `packet_crc`, `dma_engine`
  and `irq_ctrl`; the implementation has them as sections of one file.
- **No descriptor path.** The FSM is armed by an enable bit and completed by the CRC beat.
  The blueprint's `FETCH_DESC` / `CHECK_DESC` stages do not exist.
- **`randomize()` is not used.** Verilator's constraint solver cannot reach an external
  SAT/SMT process on this Windows + MinGW build, so randomization is `$urandom`-based.
  See `samples/sample_test_2/RESULTS.md` for the same limitation.
- **No commercial simulator run.**
