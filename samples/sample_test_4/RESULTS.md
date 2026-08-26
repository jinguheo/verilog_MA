# Sample Test 4 — Results

Phases 1-3 done; phase 4 in progress (`dma_sched.sv` delivered and verified,
the rest of the DMA engine not started yet). See [PLAN.md](PLAN.md) for the
full six-phase plan and [PHASE_3_6_PLAN.md](PHASE_3_6_PLAN.md) for phases
3-6's own detail.

## Decisions settled this session (2026-08-09)

- **prim reuse is real, not aspirational.** Nine of the eleven planned
  `rtl/common/` modules are reused unmodified from OpenTitan's `hw/ip/prim`
  and `hw/ip/prim_generic`, consumed directly from `D:\MyWork\verilog` (same
  tree Sample Test 2 already depends on). The mapping is proven, not just
  documented: [`tb/prim_reuse_smoke.sv`](tb/prim_reuse_smoke.sv) instantiates
  every one of them at Sample Test 4's actual widths and is part of the lint
  gate. Only `skid_buffer.sv` and `cnt_sat.sv` are genuinely new — see the
  table in that file for the full mapping and why each reused primitive was
  chosen over writing one from scratch (e.g. `prim_count` was passed over for
  `cnt_sat` because its hardened duplicate-and-cross-check design pays for
  tamper detection nothing here needs).
- **Descriptor layout**: 128-bit, four 32-bit words (`daq_pkg::desc_t`), not a
  wider metadata-carrying format. Per-packet metadata can be added later as a
  second descriptor flavour without changing the ring walk.
- **ECC scope**: channel FIFO payload only. The descriptor path is protected
  by `daq_pkg::desc_check()` plus the AXI response, not ECC.
- **AXI read master question deferred to phase 4**: whether it is needed for
  anything beyond descriptor fetch is a phase-4 decision once `desc_fetch.sv`
  exists to make it concrete.

## Phase 1 — packages, common, build gate

Delivered:
- [`rtl/pkg/axi_pkg.sv`](rtl/pkg/axi_pkg.sv) — AXI4/AXI4-Lite encodings
  (burst, resp, size, prot, cache), boundary-split helpers. New; OpenTitan is
  TileLink-based so nothing here comes from prim.
- [`rtl/pkg/daq_pkg.sv`](rtl/pkg/daq_pkg.sv) — parameters (compile-time
  `DAQ_NUM_CH`/`DAQ_AXI_DW` defines, defaulting to 8/64), descriptor struct,
  channel-state enum, error codes, full register map, `desc_check()` shared
  between RTL and the future DV reference model.
- [`rtl/common/skid_buffer.sv`](rtl/common/skid_buffer.sv) — registered
  valid/ready pipeline stage, 2-beat capacity, full throughput.
- [`rtl/common/cnt_sat.sv`](rtl/common/cnt_sat.sv) — saturating statistics
  counter, parameterised increment width.
- [`filelist/`](filelist/) — `prim.f` (external prim dependency, `$OT_PRIM_ROOT`
  / `$OT_PRIM_GENERIC_ROOT`), `pkg.f`, `rtl_phase1.f`, `waivers.vlt`.
- [`scripts/run_lint.ps1`](scripts/run_lint.ps1) — lint-elaborates every
  phase-1 top across the parameter sweep.
- [`scripts/run_block_tb.ps1`](scripts/run_block_tb.ps1) — builds and runs the
  block testbenches; `-Mutant <DEFINE>` runs the mutation gate.
- Block testbenches: [`tb/tb_skid_buffer.sv`](tb/tb_skid_buffer.sv) (full-rate,
  randomised, capacity phases), [`tb/tb_cnt_sat.sv`](tb/tb_cnt_sat.sv)
  (saturation, clear-precedence, wide-increment, randomised, independent
  reference model).
- Mutants: [`mutants/skid_buffer_MUTANT.sv`](mutants/skid_buffer_MUTANT.sv)
  (`MUT_SKID_READY`, `MUT_SKID_BYPASS`, `MUT_SKID_DRAIN`),
  [`mutants/cnt_sat_MUTANT.sv`](mutants/cnt_sat_MUTANT.sv) (`MUT_CNT_WRAP`,
  `MUT_CNT_CLEAR_LOSE`).

### Lint gate — parameter sweep

`powershell -File scripts\run_lint.ps1` — all 18 configurations
(`NUM_CH` ∈ {1,2,8} × `AXI_DW` ∈ {32,64}, three tops each) clean under
`-Wall`.

### Block testbenches

```
[SKID_TB] accepted=2033 emitted=2033 max_occupancy=2
[SKID_TB] PASS
[CNT_TB] final cnt=138 wide_cnt=10893
[CNT_TB] PASS
```

### Mutation — non-vacuous, 5/5 defects killed

| Defect | Module | Result |
| --- | --- | --- |
| `MUT_SKID_READY` | skid_buffer | killed |
| `MUT_SKID_BYPASS` | skid_buffer | killed |
| `MUT_SKID_DRAIN` | skid_buffer | killed |
| `MUT_CNT_WRAP` | cnt_sat | killed |
| `MUT_CNT_CLEAR_LOSE` | cnt_sat | killed |

**Two bugs were found and fixed while closing this gate, both in the
testbench, not the RTL:**

1. `MUT_SKID_ORDER` (swap the two arms of the output mux so a fresh beat wins
   over the skid register) was tried first and passed on the mutant. Root
   cause: it is an **equivalent mutant** — `ready_o = ~skid_valid_q` makes
   `skid_valid_q` and `valid_i && ready_o` mutually exclusive by construction,
   so the swapped arms can never both be reachable and the mutation changes
   nothing. Replaced with `MUT_SKID_BYPASS` (skid drain emits the live input
   instead of the stored beat) and `MUT_SKID_DRAIN` (skid clears without being
   consumed), both of which are reachable.
2. `MUT_SKID_BYPASS` then also passed on its first version of the driver. The
   driver decided whether to advance to a new `data_i` value by reading
   `ready_o` one delta late (at the *next* negedge rather than at the posedge
   it applies to), so once the skid filled, the driver kept re-presenting the
   just-accepted beat — making `data_i` identical to `skid_data_q` and hiding
   a bypass defect that swaps exactly those two signals. Fixed by sampling
   acceptance (`offer_taken`) synchronously at the posedge instead.

This is the same lesson Sample Test 3's formal work recorded twice: a
property (or here, a driver) that is not exercising the case it claims to
cover will pass right alongside a broken design, and a green run proves
nothing until a mutant is run through it.

## Phase 2 — AXI4-Lite CSR bridge and register file

Delivered:
- [`rtl/csr/axil_slave.sv`](rtl/csr/axil_slave.sv) — generic AXI4-Lite-to-regbus
  bridge (parameterised `Aw`/`Dw`, independent of the register map). One
  outstanding regbus transaction at a time; AW and W captured independently
  since a master may present them on different cycles; fixed write-over-read
  priority when both are ready the same cycle; `reg_error_i` maps to DECERR
  uniformly.
- [`rtl/csr/daq_csr.sv`](rtl/csr/daq_csr.sv) — the register file itself:
  global bank, `NumCh` per-channel banks, one shared address-decode block
  whose `sel_*` signals drive both the read mux and the write-commit process
  so the two paths cannot independently drift on which register an address
  hits.
- [`filelist/rtl_phase2.f`](filelist/rtl_phase2.f).
- Block testbenches: [`tb/tb_axil_slave.sv`](tb/tb_axil_slave.sv) (protocol
  only, against a small scoreboard regbus model — AW/W together, AW-before-W,
  W-before-AW, AW+W+AR contending the same idle cycle, DECERR, byte-strobe
  partial writes, 400-transaction randomised regression),
  [`tb/tb_daq_csr.sv`](tb/tb_daq_csr.sv) (axil_slave + daq_csr wired together,
  built at `NumCh=4`: ID/VERSION, GLOBAL_CTRL enable + soft_rst pulse,
  GLOBAL_STATUS, per-channel CTRL/DESC_BASE with byte-strobe partial writes,
  DESC_CTRL go pulse per-channel isolation, CH_IRQ_STATE W1C including the
  simultaneous hardware-set/software-clear race, IRQ_STATE live summary,
  `irq_o` gating, ERR_INJECT/AXI_CFG, RO counter readback + RO-write-is-a-
  no-op, three DECERR cases).
- Mutants: [`mutants/axil_slave_MUTANT.sv`](mutants/axil_slave_MUTANT.sv)
  (`MUT_AXIL_WPRIO`, `MUT_AXIL_NODECERR`),
  [`mutants/daq_csr_MUTANT.sv`](mutants/daq_csr_MUTANT.sv) (`MUT_CSR_IRQNOHW`,
  `MUT_CSR_NODECERR`, `MUT_CSR_GOALL`).

### Register-map correction (2026-08-09)

The plan's original sketch listed the global `IRQ_STATE` as W1C, mirroring
`CH_IRQ_STATE`. Built that way, clearing the global bit while the per-channel
cause it summarises is still pending would just have the bit reappear the
next cycle — a second, redundant latch with no state of its own, and a
misleading one (clearing it would not have deasserted anything). `IRQ_STATE`
is RO instead: `bit[ch]` is a live OR of `CH_IRQ_STATE[ch]` against that
channel's `CH_IRQ_ENABLE` mask. `CH_IRQ_STATE` is the actual latch that must
be cleared to deassert an interrupt, and keeps its planned W1C access. Full
rationale is in `daq_pkg.sv` next to `AddrIrqState`.

### Lint gate — parameter sweep

`powershell -File scripts\run_lint.ps1` — all 30 configurations (5 tops ×
`NUM_CH` ∈ {1,2,8} × `AXI_DW` ∈ {32,64}) clean under `-Wall`. `axil_slave` and
`daq_csr` depend only on the fixed `AxilAw`/`AxilDw`, not `AXI_DW`, so those
two axes of the sweep are a no-op re-elaboration for them rather than a gap —
`NumCh` is what actually varies their footprint (register-file array sizes,
index widths).

### Block testbenches

```
[AXIL_TB] PASS
[DAQ_CSR_TB] PASS
```

### Mutation — non-vacuous, 5/5 defects killed

| Defect | Module | Result |
| --- | --- | --- |
| `MUT_AXIL_WPRIO` | axil_slave | killed |
| `MUT_AXIL_NODECERR` | axil_slave | killed |
| `MUT_CSR_IRQNOHW` | daq_csr | killed |
| `MUT_CSR_NODECERR` | daq_csr | killed |
| `MUT_CSR_GOALL` | daq_csr | killed |

**Three testbench bugs surfaced and got fixed while closing this gate — none
in the RTL:**

1. Both `tb_axil_slave.sv` and `tb_daq_csr.sv` originally polled
   `awvalid && awready` (etc.) directly, re-read one negedge *after* the
   accept edge. `awready` is combinational and drops on the **same** edge it
   accepts a transfer (the FSM leaves `Idle` that instant), so by the time the
   driver re-checked it, the accept had already happened and already stopped
   being visible. Worse, because `bready`/`rready` were asserted up front, the
   write's own (single) `BVALID` pulse silently drained while the driver was
   still stuck in that stale check — and the driver then hung forever waiting
   for a second `BVALID` that was never coming. `tb_axil_slave` reached
   `#1_000_000` and timed out on the very first transaction; nothing in phase
   1 had exposed this because those testbenches never drove an AXI-style
   channel whose ready signal changes on the accept edge itself. Fixed with
   the same technique `tb_skid_buffer.sv`'s `offer_taken` already used
   correctly: a monitor inside a posedge-triggered block samples
   `valid && ready` in the Active region, before the FSM's non-blocking
   update commits — the pre-edge value that actually decided the transfer,
   not the post-edge value the negedge-driven test code would otherwise see.
2. `MUT_AXIL_WPRIO` (read wins arbitration instead of write when both are
   ready the same cycle) survived the first mutation run: nothing in
   `tb_axil_slave` ever presented AW+W and AR in the same idle cycle. Added
   phase 2c, which does, and distinguishes the winner by which response
   (`BVALID` or `RVALID`) comes back first — not by the AW/AR accept edges
   themselves, since AR is captured into `arcap_q` on that same edge
   regardless of who wins the *issue* decision.
3. `MUT_CSR_IRQNOHW` (software clear beats a same-cycle hardware set, instead
   of hardware winning) survived twice. First attempt: the hardware pulse was
   raised only *after* a `@(negedge clk)` inside a parallel fork branch, which
   lands one edge later than the actual regbus commit (which happens on
   `axil_write`'s first internal edge) — never simultaneous at all. Second
   attempt: held the pulse high for the *entire* `axil_write` call instead of
   exactly one edge; on every subsequent edge where it was still asserted but
   no write was committing, the ordinary (non-racing) hardware-set path just
   set the bit again, independent of what the mutant did at the real race
   edge — masking the defect. Fixed by pulsing the cause for exactly one edge,
   released at the first negedge in a fork running alongside `axil_write`.

Same lesson as phase 1, restated because it cost three separate fixes this
time instead of two: a driver that isn't exercising the exact case, on the
exact edge, that it claims to cover will pass right alongside a broken
design. Every one of these three bugs produced a clean PASS until the
specific mutant it was supposed to catch was run through it.

## Phase 3 — per-channel stream path (pkt_align, pkt_check, chan_ctrl, chan_top)

Delivered:
- [`rtl/stream/pkt_align.sv`](rtl/stream/pkt_align.sv) — packs the 8-bit
  source byte stream into `AxiDw`-wide beats with byte strobes for the
  partial last beat. Accumulation and output backpressure are deliberately
  separate (`skid_buffer` reused from phase 1), so a stalled downstream never
  blocks accepting bytes for the beat still being assembled.
- [`rtl/stream/pkt_check.sv`](rtl/stream/pkt_check.sv) — byte-enable-aware
  CRC-32 (a small hand-written bit-serial chain, not `prim_crc32` — see the
  file header for why `prim_crc32`'s fixed-width, padding-inclusive model
  gets a partial last beat's CRC wrong) plus length checking. Pure
  monitor: a packet's beats, including its own eop beat, are forwarded
  before the CRC/length result is known (documented store-and-forward
  tradeoff — this project has no bound on packet length to size a holding
  buffer against).
- [`rtl/stream/chan_ctrl.sv`](rtl/stream/chan_ctrl.sv) — per-channel FSM
  (`ChIdle`/`ChArmed`/`ChRunning`/`ChDraining`/`ChError`) gating whether the
  beat stream flows and turning `pkt_check`'s per-packet pulses into the
  cause bits `daq_csr` expects. `ChIdle` unconditionally drains and discards
  anything still in the pipe from a previous, since-disabled session — see
  the file header for the two-attempt history of getting that drain
  provably complete rather than racy.
- [`rtl/stream/chan_top.sv`](rtl/stream/chan_top.sv) — the per-channel
  wrapper and the one place in phase 3 that actually crosses a clock domain:
  `pkt_align` (`src_clk`) → async CDC FIFO (`prim_fifo_async`, reused) →
  `pkt_check`/`chan_ctrl` (`axi_clk`), with a `prim_rst_sync` per domain.
  The packed-beat layout (`daq_pkg::PktBeat*`) lets the CDC FIFO carry all
  five beat fields through one port instead of five.
- [`filelist/rtl_phase3.f`](filelist/rtl_phase3.f).
- Block testbenches: [`tb/tb_pkt_align.sv`](tb/tb_pkt_align.sv),
  [`tb/tb_pkt_check.sv`](tb/tb_pkt_check.sv),
  [`tb/tb_chan_ctrl.sv`](tb/tb_chan_ctrl.sv) (same-clock),
  [`tb/tb_chan_top.sv`](tb/tb_chan_top.sv) (the cross-clock integration of
  all four — non-integer `src_clk`/`axi_clk` ratio so nothing passes by
  accidentally aligning; independent posedge-monitor acceptance tracking on
  each domain's own clock).
- Mutants: [`mutants/pkt_align_MUTANT.sv`](mutants/pkt_align_MUTANT.sv)
  (`MUT_ALIGN_NOEOP`, `MUT_ALIGN_SOPFROZEN`, `MUT_ALIGN_NOCRC`),
  [`mutants/pkt_check_MUTANT.sv`](mutants/pkt_check_MUTANT.sv)
  (`MUT_CHECK_WRONGIDX`, `MUT_CHECK_NOSOPRESET`, `MUT_CHECK_NOLENERR`),
  [`mutants/chan_ctrl_MUTANT.sv`](mutants/chan_ctrl_MUTANT.sv)
  (`MUT_CTRL_NODRAIN`, `MUT_CTRL_NOABORT`, `MUT_CTRL_BUSYWRONG`).

### Lint gate — parameter sweep

`powershell -File scripts\run_lint.ps1` — `pkt_align`, `pkt_check`,
`chan_ctrl`, `chan_top` all clean across all 6 configurations
(`NUM_CH` ∈ {1,2,8} × `AXI_DW` ∈ {32,64}) under `-Wall`.

### Block testbenches

```
[PKT_ALIGN_TB] PASS
[PKT_CHECK_TB] PASS
[CHAN_CTRL_TB] PASS
[CHAN_TOP_TB] PASS
```

### Mutation — non-vacuous, 9/9 defects killed

| Defect | Module | Result |
| --- | --- | --- |
| `MUT_ALIGN_NOEOP` | pkt_align | killed |
| `MUT_ALIGN_SOPFROZEN` | pkt_align | killed |
| `MUT_ALIGN_NOCRC` | pkt_align | killed |
| `MUT_CHECK_WRONGIDX` | pkt_check | killed |
| `MUT_CHECK_NOSOPRESET` | pkt_check | killed |
| `MUT_CHECK_NOLENERR` | pkt_check | killed |
| `MUT_CTRL_NODRAIN` | chan_ctrl | killed |
| `MUT_CTRL_NOABORT` | chan_ctrl | killed |
| `MUT_CTRL_BUSYWRONG` | chan_ctrl | killed |

The `chan_ctrl` mutants were re-run against the final RTL after three
same-session bugfixes to `chan_ctrl.sv` (see below) rather than trusted
stale from before those fixes; still 3/3 - but re-running them surfaced a
second, more subtle problem than "did the mutant file exist": the mutant
file itself was stale. `mutants/chan_ctrl_MUTANT.sv` had been copied from
`chan_ctrl.sv` *before* the `idle_drain`/`drain_pending_q` ChIdle
drain-and-discard feature existed, so it was missing that entire feature,
not just carrying the one named defect each `MUT_CTRL_*` claims to inject.
Every one of the three mutant runs was therefore also failing
`tb_chan_ctrl`'s own idle-drain check (`phase8: Idle drains (accepts) a
stale beat`) for a reason that had nothing to do with the mutation being
tested - a "kill" that does not actually prove the intended defect was
caught, only that *some* difference from golden was caught. Regenerated
`mutants/chan_ctrl_MUTANT.sv` from the current golden file with the same
three defects re-applied as `ifdef` blocks at the corresponding lines, and
re-ran: each mutant now fails only the check(s) that name its own specific
defect (`MUT_CTRL_NODRAIN` → the Draining-path phases; `MUT_CTRL_NOABORT` →
the abort-from-Error phase; `MUT_CTRL_BUSYWRONG` → the busy-in-Armed check),
with no more spurious phase-8 failure riding along. The general lesson: a
mutant file is itself part of the golden RTL's dependency surface and goes
stale exactly like anything else copy-derived from a file that keeps
changing - "the mutant still gets killed" is not sufficient evidence that a
stale mutant file is still testing what its name says.

### `tb_chan_top.sv` bug found while closing the gate — a scoreboard gap, not an RTL bug

`tb_chan_top`'s phase 4 (randomised multi-packet, randomised backpressure on
both clocks) initially failed with packets reported as delivered several
bytes short — e.g. a 16-byte/2-beat packet "done" after what looked like
one beat. The RTL was not dropping data.

Root cause: phase 2's corrupted-CRC packet is sent with `track=1'b0` (not
added to the scoreboard's `exp_bytes`/`exp_pkt_count`), but `pkt_check.sv`
and `chan_ctrl.sv` both document, deliberately, that a packet's beats —
including its own eop beat — are forwarded to `beat_valid_o` *before* the
CRC result is known (store-and-forward would need unbounded buffering to
avoid this, which phase 3 does not build). So that untracked packet's 9
bytes and one `eop` really do land in `got_bytes`/`got_pkt_count`. From
that point on `got_pkt_count` sits one packet ahead of `exp_pkt_count`, and
every later `while (got_pkt_count < exp_pkt_count) @(negedge axi_clk);`
wait (phase 3b, then every phase-4 packet) is unreliable: several of them
found the condition already coincidentally true and moved on before the
packet actually being waited for had finished draining through the
pipeline, corrupting the next packet's byte-count comparison.

Fixed by tracking phase 2's packet too (`track=1'b1`) — its data bytes are
correct (only the CRC trailer is deliberately corrupted), and they really
are delivered, so the scoreboard should expect them. `tb_chan_top.sv`'s
phase 2 comment explains why. No RTL change was needed.

### Bugs found and fixed in `chan_ctrl.sv` itself this session

Three, all around the `ChIdle` drain-and-discard logic (see the file's own
header for the full narrative): a stale abandoned packet's tail beat could
be mistaken for a new session's sop when the CDC FIFO's read side presented
a momentary gap mid-packet. Fixed with a sticky `drain_pending_q` bit that
only clears on the drained packet's own observed eop, not on the mere
absence of `beat_valid_i` on a given cycle.

## Phase 4 (in progress) — DMA engine

`dma_sched.sv`, `desc_fetch.sv`, and `axi_rd_master.sv` done; `axi_wr_master.sv`
and `wr_track.sv` are not started.

Delivered:
- [`rtl/dma/dma_sched.sv`](rtl/dma/dma_sched.sv) - packet-granularity
  round-robin arbiter across all `NumCh` channels' gated beat streams
  (each channel's `chan_top` output), merging them into the one beat stream
  the not-yet-built `axi_wr_master` will issue AXI writes for. Arbitrates
  only at packet boundaries, not per beat: once a channel's sop beat is
  won, every other channel is excluded from arbitration - not merely
  deprioritised - until that same channel's own eop beat is accepted. Beat-
  level round-robin was the obvious first design and was rejected before
  being built: axi_wr_master/wr_track's outstanding-write bookkeeping is
  scoped to "the packet currently being written," and letting the winner
  change mid-packet would interleave two channels' bytes into what
  downstream believes is one contiguous transfer. Full tradeoff (one long
  packet can hold the shared write path while others with short packets
  wait) is in the file's own header, along with why idle-time arbitration
  itself (`prim_arbiter_tree`, reused - first use of it in this project)
  requests only on a channel's sop beat and is explicitly excluded from
  updating its own internal round-robin state while a channel is locked, so
  a locked-out channel's requests are not silently counted as "already had
  its turn" once idle arbitration resumes.
- [`filelist/rtl_phase4.f`](filelist/rtl_phase4.f).
- Block testbench: [`tb/tb_dma_sched.sv`](tb/tb_dma_sched.sv), built at
  `NumCh=4`. Six phases: single channel alone, two channels contending for
  sop the same cycle (a real tie), mid-packet contention (a second
  channel's sop appears while another is already locked several beats in),
  backpressure through a locked multi-beat packet, a single-beat packet's
  lock releasing the same cycle it is won (not lingering an idle cycle),
  and a randomised four-channel stress run. A continuously-running
  invariant (checked on every accepted output beat, not just in the phases
  aimed at it) asserts the merged output never switches channel between a
  channel's own sop and eop, and that `ch_ready_o` is never onehot0-
  violating. Run 5 additional times at fixed `-Seed` values to check phase
  6's randomised stress wasn't a lucky single run.
- Mutant: [`mutants/dma_sched_MUTANT.sv`](mutants/dma_sched_MUTANT.sv)
  (`MUT_SCHED_STICKYLOCK`, `MUT_SCHED_EARLYUNLOCK`, `MUT_SCHED_DBLREADY`).

### Lint gate — parameter sweep

`powershell -File scripts\run_lint.ps1` - `dma_sched` clean across all 6
configurations. `NumCh=1` needed its own guarded code path (see the file):
`prim_arbiter_tree`'s own `idx_o` is `[$clog2(N)-1:0]` with no `N==1` guard,
so at `N=1` that port is genuinely zero-width - a real width mismatch
against this module's own always-at-least-1-bit `ChIdxW` convention, caught
immediately by the sweep rather than only at `NumCh=8` (the phase-1 lesson
- "a module that only elaborates at the common case is not parameterised" -
holding again). Fixed by bypassing the tree entirely in a
`generate if (NumCh > 1)` for the single-channel case, rather than forcing
a width cast over the mismatch.

### Block testbench and mutation

```
[DMA_SCHED_TB] PASS
```

| Defect | Result |
| --- | --- |
| `MUT_SCHED_STICKYLOCK` | killed |
| `MUT_SCHED_EARLYUNLOCK` | killed |
| `MUT_SCHED_DBLREADY` | killed |

### `desc_fetch.sv` — descriptor ring walker

Delivered:
- [`rtl/dma/desc_fetch.sv`](rtl/dma/desc_fetch.sv) - one shared ring-walk
  engine for all `NumCh` channels (per PLAN.md's architecture diagram:
  `dma_sched -> desc_fetch -> axi_rd_master -> AXI4`, not a raw AXI port of
  its own). Only one descriptor fetch is ever outstanding across every
  channel - a second `prim_arbiter_tree` instance (this module's own, after
  `dma_sched`'s) picks which enabled, not-yet-loaded channel gets the shared
  fetch path next, with the same "gate the arbiter's request input to zero
  while busy, don't just ignore its output" discipline `dma_sched.sv`
  established. `daq_pkg::desc_check()` is reused as-is; `ch_desc_go_i`
  restarts a channel's ring from `ch_desc_base_i` and clears any halted/
  error state, and from there the walk is autonomous - `ctrl.last` halts it,
  `ctrl.link` redirects to `next_ptr` instead of the linear `+DescBytes`
  advance, and `ch_abort_i` halts and clears the error but requires a fresh
  go to actually resume (no silent restart from a stale pointer). The
  request/response protocol to `axi_rd_master` (not built yet) is
  deliberately a small abstraction, not raw AXI AR/R, matching the pkt_check/
  chan_ctrl split from phase 3 - one layer computes/validates, the next acts.
- Block testbench: [`tb/tb_desc_fetch.sv`](tb/tb_desc_fetch.sv), built at
  `NumCh=4`, standing in for `axi_rd_master` with an associative-array
  "memory" model. Six phases: one descriptor, a two-descriptor linear ring
  walk, a `ctrl.link` jump to a non-contiguous `next_ptr`, all four
  `desc_check()` failure modes plus an AXI-read-error injection (five error
  paths total, each checked for the right `err_e` code and that a failed
  fetch never presents as valid), abort mid-ring followed by a clean restart
  from the ring's own base (not wherever the abort caught it), and two
  channels contending for the single shared fetch path.
- Mutant: [`mutants/desc_fetch_MUTANT.sv`](mutants/desc_fetch_MUTANT.sv)
  (`MUT_DESC_NOLINK`, `MUT_DESC_NOHALT`, `MUT_DESC_NOCHECK`).

#### Lint gate — parameter sweep

Clean across all 6 configurations - same `NumCh==1` zero-width-arbiter-port
workaround as `dma_sched.sv` needed, caught by the sweep the same way. A
second, unrelated `NumCh==1` issue also surfaced: this module's own
`BeatCntW` local param name collided with an unrelated same-named `localparam`
already in `daq_pkg.sv` (AXI burst-length counting), a `VARHIDDEN` warning
under `-Wall` - renamed to `DescBeatCntW`.

#### Two real bugs found and fixed while closing this module's own gate

1. **A same-cycle stale-pointer race, in the RTL itself.** The first version
   computed `need_fetch` from `ch_enable_i` alone; on the very cycle
   `ch_desc_go_i` pulses, `ch_enable_i` is already high but `cur_ptr_q` has
   not yet been loaded with `ch_desc_base_i` (that load is itself registered,
   committing on this same edge, not before it) - so a fetch could be
   arbitrated and issued using the *previous* (at reset, zero) pointer, one
   cycle too early. `tb_desc_fetch.sv` caught it immediately: every single
   `go` produced a fetch to address zero. Fixed by also gating `need_fetch`
   on `~ch_desc_go_i`, deferring arbitration by exactly the one cycle the
   pointer load needs.
2. **A valid/ready handshake bug in the testbench's own memory-model stub**,
   the same class of mistake phase 2's `tb_axil_slave.sv`/`tb_daq_csr.sv`
   made and phase 3's `tb_chan_top.sv` avoided: the stub asserted a response
   beat's `valid`, waited one `negedge`, then checked `ready`'s *level* to
   decide whether that beat was accepted - but `rd_resp_ready_o` drops the
   same edge it accepts the *last* beat of a fetch, so checking it one
   negedge later routinely observed 0 and spun in `while (!ready)` waiting
   for a level that would never return on its own. It eventually "recovered"
   only because a *later, unrelated* fetch happened to drive `ready` back to
   1 again - by which point the stub had been holding `valid` (and stale
   data) asserted for many cycles, corrupting whatever fetch came next.
   Fixed with the same posedge-monitor acceptance pattern (`resp_taken =
   valid & ready`, latched at the posedge the DUT itself uses to decide
   acceptance) already used everywhere else in this project's testbenches -
   the module header on `tb_chan_top.sv`'s `offer_taken` explains why the
   pattern exists at all.

### `axi_rd_master.sv` — AXI4 read master

Delivered:
- [`rtl/dma/axi_rd_master.sv`](rtl/dma/axi_rd_master.sv) - the actual AXI4
  AR/R master, deliberately scoped to exactly what `desc_fetch.sv` needs and
  nothing more, answering PLAN.md's own open question about this module's
  scope now that `desc_fetch.sv` exists to make it concrete: `desc_fetch` is
  the only consumer, and it only ever has one fetch outstanding (a single
  shared request path across all channels - see `desc_fetch.sv`'s header),
  so this master is single-outstanding too, with a fixed ARID=0, not a
  general multi-ID design. Always issues full-`AxiDw`-width INCR bursts,
  never a narrow (sub-bus-width) transfer - the reason
  `daq_pkg::DescAlignBytes` was changed from a fixed 4 to `AxiDw/8` (see its
  own header): a request address aligned only to 4 bytes but read over a
  wider bus would force byte-lane extraction this module does not
  implement. It still has to split a fetch into two back-to-back bursts
  when the (small, fixed-size) read would straddle a 4 KB boundary -
  `axi_pkg::bytes_to_boundary()` (reused, the same helper `axi_wr_master`
  will need for its own, much larger splits) decides whether and where.
- **`daq_pkg::DescAlignBytes` changed from a fixed 4 to `AxiDw/8`** - a
  decision this module made concrete, not `desc_fetch.sv`'s to make on its
  own. Only actually changes behaviour at `AxiDw=64` (the default every
  block TB in this project builds at); `AxiDw=32` already had
  `DescAlignBytes=4`, unaffected. `tb_desc_fetch.sv`'s over-max-length error
  case needed a one-line fix to stay alignment-legal after this (it was
  adding a bare `+4` to an already-8-byte-aligned `DescMaxLength`, which at
  the new alignment tripped `ErrDescAlign` instead of the `ErrDescLength` it
  was meant to test) - fixed to add `DescAlignBytes` itself instead of a
  literal.
- Block testbench: [`tb/tb_axi_rd_master.sv`](tb/tb_axi_rd_master.sv),
  standing in for both desc_fetch (the request/response side) and memory (a
  small AXI4 slave stub) at once. Five phases: a single fetch comfortably
  inside a page (no split), a fetch straddling a 4 KB boundary (two ARs,
  `rd_resp_last_o` only on the overall final beat, not the first burst's own
  `rlast`), an RRESP error aligned to the specific beat that carried it,
  backpressure on both AXI `ready` signals and on the desc_fetch-side
  `rd_resp_ready_i` through a split fetch, and back-to-back fetches
  confirming `rd_req_ready_o` drops while one is active. Every AR is also
  checked for ARSIZE/ARBURST/ARID/ARCACHE/ARPROT correctness, not just
  address/length. Run 5 additional times at fixed `-Seed` values.
- Mutant: [`mutants/axi_rd_master_MUTANT.sv`](mutants/axi_rd_master_MUTANT.sv)
  (`MUT_RDM_NOSPLIT`, `MUT_RDM_LASTWRONG`, `MUT_RDM_ERRDROP`).

#### Lint gate — parameter sweep

Clean across all 6 configurations on the first attempt - no new pitfall this
time, just confirmation that the `DescAlignBytes` change and the reused
`bytes_to_boundary()` helper elaborate correctly across the sweep.

#### Two testbench races found and fixed while closing this module's own gate

Both the same class of bug the `desc_fetch.sv` gate had already found once
this session - a level-check of a DUT-driven `ready`/`valid` signal at a
negedge that can race a *different* negedge-triggered process's own update
of that same cycle, rather than latching the decision at the posedge the
DUT itself used to make it:

1. The AR/R memory-model stub's own R-beat driver waited a negedge after
   asserting `rvalid` then checked `rready`'s level, the exact same mistake
   `tb_desc_fetch.sv`'s stub made - fixed the same way, with a posedge-
   latched `r_taken`.
2. Phase 4 (backpressure through a split fetch) read `rd_resp_valid` live in
   its own negedge-driven backpressure loop, racing the AR/R responder
   task's own negedge-driven `rvalid` updates the same way. Rather than add
   a third latched monitor for this one site, the phase was rewritten to
   reuse `collect_resp` (which already uses the correctly-latched
   `resp_taken`) and confine the backpressure loop to *only* toggling
   `rd_resp_ready`, not also reading `rd_resp_valid` itself.

The general lesson repeating across two modules' gates in one session: in
this project's testbenches, a `valid`/`ready` pair should always be turned
into a posedge-latched `*_taken` signal before any negedge-driven code
branches on whether a beat was accepted - never read live at a negedge.

## Toolchain notes (new, on top of what Sample Test 2/3 already documented)

A fourth Windows toolchain issue, distinct from the three
`samples/sample_test_2/uvm/run_verilator_uvm.ps1` already fixed:
`VERILATOR_ROOT` is pasted verbatim into the generated Makefile, and one
recipe (`verilator_includer`) runs through `sh.exe`, which drops backslashes —
`D:\MyWork\Veriolg_MA\...` arrives as `MyWorkVeriolg_MA...` and the build dies
with a confusing `python3: can't open file` rather than a path error. Fixed by
setting `VERILATOR_ROOT` (and the file-list paths passed to Verilator) with
forward slashes throughout `scripts/run_lint.ps1` and
`scripts/run_block_tb.ps1`.

A fifth Windows toolchain issue, found during phase 3's `tb_chan_top`
debugging: a long-running sandboxed PowerShell tool session accumulates
memory pressure over many Verilator/g++ builds, eventually causing
`cc1plus.exe: out of memory` even with adequate OS-level free memory.
Workaround: spawn a fresh one-off `powershell.exe` process instead of
reusing the same long-lived session for the build/run commands.

## Not done yet

Phase 4 has `dma_sched.sv`, `desc_fetch.sv`, and `axi_rd_master.sv`;
`axi_wr_master.sv` and `wr_track.sv` remain - and until they exist,
`desc_fetch.sv`'s `ch_desc_valid_o`/`ch_desc_addr_o`/`ch_desc_maxlen_o`
outputs still have no real consumer, only block testbenches' stand-ins
(`axi_rd_master.sv` is now that real consumer for `desc_fetch.sv`'s
`rd_req_*`/`rd_resp_*` side, at least). Phases 5-6 (IRQ/perf/top integration,
integration UVM + formal + regression) are unstarted. `rtl/irq`, `rtl/stat`
do not exist yet. `daq_csr.sv`'s per-channel status, counter, and cause
inputs are currently driven directly by its block testbench; nothing
downstream consumes `ch_enable_o` yet, though `ch_desc_base_o`/
`ch_desc_go_o` now have a real (if not yet wired-up) consumer in
`desc_fetch.sv`'s `ch_desc_base_i`/`ch_desc_go_i`.
