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

## Phase 4 — DMA engine

Complete: `dma_sched.sv`, `desc_fetch.sv`, `axi_rd_master.sv`,
`axi_wr_master.sv`, `wr_track.sv`.

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

### `axi_wr_master.sv` — AXI4 write master

Delivered:
- [`rtl/dma/axi_wr_master.sv`](rtl/dma/axi_wr_master.sv) - the actual AXI4
  AW/W/B master, consuming `dma_sched`'s single arbitrated beat stream (one
  channel's packet at a time, locked sop-to-eop) and `desc_fetch`'s
  per-channel destination address/length. Single-outstanding across the
  whole design, the same narrowing `axi_rd_master.sv` already applied to the
  read side - `dma_sched` never presents more than one channel's packet at a
  time, so there is never a reason for two AW/W bursts in flight together
  either. Unlike `axi_rd_master.sv` (a fixed, tiny 16-byte fetch), a DMA
  payload write can be up to `DescMaxLength` (1 MiB), so this module needs a
  second kind of splitting `axi_rd_master.sv` never did:
  `daq_pkg::MaxBurst` (16 beats) caps every burst, on top of the same 4 KB
  boundary check (`axi_pkg::bytes_to_boundary()`, reused) `axi_rd_master.sv`
  already established.
- **Burst sizing and transfer completion are deliberately two different
  signals, not one derived from the other.** Each burst's beat count comes
  from `ch_desc_maxlen_i` (latched at the packet's sop) against `MaxBurst`
  and the boundary - AXI requires committing to AWLEN before the first W
  beat, so this has to come from something known in advance. Whether the
  *whole transfer* is done is decided from `wr_eop_i`, observed directly on
  whichever W beat the stream actually marks last, not from the
  descriptor-length countdown reaching zero. If a descriptor's length and
  the packet's real byte count ever disagree (not cross-checked anywhere
  upstream), this split means a wrong burst size never also produces a
  wrong completion signal - full reasoning in the file's own header.
- Hands each finished burst off to `wr_track.sv` (not built yet) as a small
  completion event (`burst_done_valid_o`/`ch_o`/`err_o`/`last_o`) rather
  than deciding for itself what a completed transfer means for the channel
  - the same protocol/semantics split `desc_fetch.sv`'s header already
  describes between itself and `axi_rd_master.sv`.
- Block testbench: [`tb/tb_axi_wr_master.sv`](tb/tb_axi_wr_master.sv),
  standing in for dma_sched (the beat-stream side) and memory (a small AXI4
  slave stub) at once. Six phases: a single short burst under `MaxBurst`
  (with byte-strobe passthrough checked on a deliberately partial final
  beat), a packet longer than `MaxBurst` forcing a beat-count-only split, a
  destination address one beat before a 4 KB boundary forcing a
  boundary-only split, a BRESP error aligned to the burst that carried it,
  upstream backpressure mid-packet, and two channels back-to-back each
  keeping their own descriptor address. Every AW is also checked for
  AWSIZE/AWBURST/AWID/AWCACHE/AWPROT correctness. Run 10 additional times
  (5 at fixed `-Seed` values, 5 more at the default random seed) after the
  race described below was fixed, specifically because that bug was
  seed-dependent and had passed at least once before being caught.
- Mutant: [`mutants/axi_wr_master_MUTANT.sv`](mutants/axi_wr_master_MUTANT.sv)
  (`MUT_WRM_NOSPLIT`, `MUT_WRM_LASTWRONG`, `MUT_WRM_ERRDROP`).

#### Lint gate — parameter sweep

Clean across all 6 configurations, but only after one fix: `burst_beats_c`
(the live combinational burst-size decision) was originally declared a full
32 bits even though it is mathematically capped at `MaxBurst` (one of its
own three `min()` operands) and immediately narrowed to `BeatCntW` wherever
it's consumed - Verilator's `-Wall` correctly flagged the unused upper bits.
Fixed by declaring it `BeatCntW`-wide in the first place rather than
widening the consumer to match.

#### A real RTL bug: `awlen_o` read from the wrong copy of the burst size

The first version drove `awlen_o` from `burst_beats_q` - the *registered*
copy, latched only once `aw_accept` fires at the tail end of `WrAw`. That
copy is correct for the whole of the following `WrW` state (where it's
compared against `beat_cnt_q` for WLAST), but during `WrAw` itself, before
acceptance, `burst_beats_q` still holds whatever the *previous* burst's size
was - `awlen_o` was therefore stale for however many cycles `WrAw` spent
waiting on `awready_i`, i.e. exactly as long as AW-side backpressure held.
`tb_axi_wr_master.sv`'s own phase 1 caught it as a `wlast_o` mis-timing
report the very first time AW backpressure happened to stall for more than
a couple of cycles. Fixed by driving `awlen_o` from the live combinational
`burst_beats_c` instead - its own inputs (`addr_q`, `remain_beats_q`) are
already correct for the whole of `WrAw`, having last changed when the
*previous* burst's B was accepted - while still latching `burst_beats_q`
from it at `aw_accept` for `WrW`'s later use.

#### A testbench race, not an RTL bug: same-edge multi-block `_taken` consumption

The most time-consuming bug of this module's gate, and worth documenting in
detail because it is a genuinely different class from every previous
`valid`/`ready`-timing bug this project has found: `bd_taken` (a capture of
`burst_done_valid_o`/`ch_o`/`err_o`/`last_o`) was originally computed in one
`always @(posedge clk)` block and consumed by a *separate*
`always @(posedge clk)` block that pushed it into a bookkeeping queue -
mirroring `aw_taken`'s own capture-then-check split, which had worked fine
in `tb_axi_rd_master.sv`. Two same-edge-triggered blocks with no declared
data dependency between them have no guaranteed relative execution order
inside the same simulation delta cycle; the push block could - and, on one
otherwise-unremarkable run, did - read `bd_taken_last`'s *previous* cycle's
value, one delta before the capture block updated it for the current edge.
The symptom was exactly a hang, not a wrong-data corruption: phase 1's
single 4-beat burst pushed `last=0` for what should have been (and, per a
direct read of the DUT's own `burst_done_last_o` at that same instant, *was*
- confirmed with a temporary debug trace) the transfer's one and only,
final burst - so `wait_transfer_done()`'s `while` loop never saw the `last`
flag it was waiting for and spun forever. It reproduced intermittently
across otherwise-identical reruns (default random seeding, no `-Seed`
override), which is exactly what a same-edge scheduling-order race predicts
and what a data bug would not. Fixed by moving every "_taken" signal's
capture and its *same-edge* consumers (checks, queue pushes) into one
single always block each, so ordering is guaranteed by ordinary sequential
statement order instead of relying on the simulator's tie-break between
independent processes. Signals whose only consumer polls from a genuinely
later delta cycle - `up_taken`/`w_taken`/`b_taken`, all read from
`@(negedge clk)`-driven loops in a different process entirely - were left
as separate captures, since that pattern has an actual one-delta gap and is
not the same hazard. `tb_axi_rd_master.sv`'s own `ar_taken` split (capture
block + a single separate check block, no push consumer) carries the same
theoretical risk and was not touched here - it is already verified and
committed, and a second same-edge consumer appears to be what was needed to
expose the ordering ambiguity in practice.

### `wr_track.sv` — write completion tracking and error aggregation

Delivered:
- [`rtl/dma/wr_track.sv`](rtl/dma/wr_track.sv) - turns `axi_wr_master`'s
  per-burst completion events into the two things a channel actually needs:
  `xfer_done_o`/`xfer_done_ch_o` to `desc_fetch` (fires whenever
  `burst_done_last_i` does, telling it to advance the ring) and sticky
  per-channel `ch_err_o`/`ch_err_code_o` (set to `ErrAxiWrite` on any
  erroring burst, cleared only by `ch_abort_i` - the same convention
  `desc_fetch.sv`'s own `err_q`/`halted_q` already use). Deliberately a
  separate module from `axi_wr_master.sv` even though `axi_wr_master`'s
  single-outstanding design keeps its own bookkeeping trivial (a plain
  per-channel latch, not a real scoreboard) - see the file's header for why
  the protocol/semantics split is still worth keeping.
- **A documented gap, not a fix**: a write error does NOT halt a channel's
  ring walk the way a descriptor-fetch error already does. `xfer_done_o`
  fires regardless of `burst_done_err_i`, because `desc_fetch.sv`'s own
  `xfer_done_i` input has no "and it failed" qualifier - giving it one would
  mean touching `desc_fetch.sv` again, which is already built, verified,
  and committed. Left explicit in the file's header rather than worked
  around, the same way `chan_ctrl.sv`'s own header flagged what
  `ch_abort_i` mid-packet left unresolved for phase 4 to pick up later.
- Block testbench: [`tb/tb_wr_track.sv`](tb/tb_wr_track.sv), driving
  `burst_done_*` directly (no AXI or beat-stream protocol on either side of
  this module). Five phases: a single-burst transfer, a multi-burst
  transfer (`xfer_done_o` only on the one marked last), a burst erroring
  mid-transfer whose error survives past the transfer's own completion,
  `ch_abort_i` clearing a latched error, and two channels' errors staying
  independent (one channel's abort must not touch another's). A final loop
  reads every channel's `ch_err_o`/`ch_err_code_o` bit, not just the ones
  named in earlier phases, both as a real residual-state check and because
  Verilator's `-Wall` flags array bits a testbench never reads at all.
- Mutant: [`mutants/wr_track_MUTANT.sv`](mutants/wr_track_MUTANT.sv)
  (`MUT_TRACK_NOERR`, `MUT_TRACK_NOCLEAR`, `MUT_TRACK_WRONGCH`).

#### Lint gate — parameter sweep

Clean across all 6 configurations on the first attempt.

## Phase 5 — interrupt/perf aggregation and top-level integration

Complete: `irq_ctrl.sv`, `perf_cnt.sv`, `daq_subsystem.sv`, plus a smoke-
level integration testbench for `daq_subsystem.sv` itself (beyond what
PLAN.md's own phase 5 gate - "full elaboration, CDC audit" - strictly
requires; phase 6 is where the real integration UVM environment belongs,
but a lint-clean top that has never actually moved a byte end-to-end is a
weaker claim than this project has made for every other phase).

### `irq_ctrl.sv` — status/interrupt-cause aggregation

Delivered:
- [`rtl/irq/irq_ctrl.sv`](rtl/irq/irq_ctrl.sv) - reconciles three
  independent axi_clk-domain status sources (`chan_top`'s stream-level FSM,
  `desc_fetch`'s fetch errors, `wr_track`'s write errors/completions) into
  the single per-channel busy/err/cause shape `daq_csr.sv` (phase 2,
  already verified/committed) was built to consume - deliberately without
  duplicating any of daq_csr's own summary logic (its W1C `CH_IRQ_STATE`
  latch, the live `IRQ_STATE` OR-with-enable summary, `irq_o` itself).
  PHASE_3_6_PLAN.md flagged this exact overlap risk by name for `irq_ctrl.sv`.
- **`ch_cause_o[IrqCauseDone]` means the DOCUMENTED thing, not chan_ctrl's
  own per-packet completion.** `daq_pkg.sv`'s own comment on `IrqCauseDone`
  says "descriptor completed" - a DMA-level event. `chan_ctrl.sv`'s own
  Done cause (built in phase 3, before the DMA engine existed) actually
  fires on stream-level packet completion, before any payload write is
  even attempted. This module ignores chan_top's Done bit entirely and
  drives `IrqCauseDone` from `wr_track`'s `xfer_done_i`/`xfer_done_ch_i` -
  the first module positioned to make good on what the register map
  actually promised.
- **"Channel busy" is broader than "stream busy."** `chan_top`'s own
  `ch_busy_o` only reflects `ChRunning`/`ChDraining` - a channel holding a
  validated descriptor between packets reads as idle there. `ch_busy_o`
  here is `stream_busy_i | desc_valid_i` (from `desc_fetch`), the reading
  software polling `GLOBAL_STATUS`/`CH_STATUS` actually needs.
- **Sticky error levels become one-shot pulses before reaching daq_csr's
  W1C latch.** `desc_fetch`/`wr_track`'s `ch_err_o` are sticky (cleared
  only by `ch_abort_i`), which is correct for this module's own `ch_err_o`
  passthrough (also sticky) but wrong for `ch_cause_o[IrqCauseErr]`:
  daq_csr's `CH_IRQ_STATE` write-commit applies `| ch_cause_i[c]` every
  single cycle (see daq_csr.sv's own comment on why), so a sticky level
  there would mean a software W1C clear is re-set the very next cycle,
  for as long as the underlying condition persists. A rising-edge detector
  turns each into a genuine one-shot pulse first.
- Block testbench: [`tb/tb_irq_ctrl.sv`](tb/tb_irq_ctrl.sv). Five phases:
  `ch_busy_o`/`dma_busy_o` as an OR of both sources, `fetch_err_i` sticky
  producing exactly one pulse (not a continuous level) while `ch_err_o`
  stays sticky, the same for `wr_err_i`, `xfer_done_i`/`xfer_done_ch_i`
  routing to the correct channel only, and `stream_cause_i`'s Crc/FifoOvf
  bits passing through unmodified. A final loop confirms every untouched
  channel shows no residual state.
- Mutant: [`mutants/irq_ctrl_MUTANT.sv`](mutants/irq_ctrl_MUTANT.sv)
  (`MUT_IRQ_NOEDGE`, `MUT_IRQ_WRONGCH`, `MUT_IRQ_BUSYWRONG`).

#### Lint gate — parameter sweep

Clean across all 6 configurations, once `perf_cnt.sv`'s own unconnected
`cnt_sat` `saturated_o` pins were wrapped in `lint_off`/`lint_on
PINCONNECTEMPTY` (they surfaced while linting `irq_ctrl.sv`, since
Verilator elaborates every module in the sourced file list, not just the
named top).

#### A testbench-design lesson: driving a same-domain edge detector's input at the wrong clock phase

The one real debugging detour closing this gate, worth recording in detail
because it is a genuinely different class of bug from anything found in
phases 1-4: `fetch_err_i`/`wr_err_i` model a REGISTERED status output of
another same-clock-domain module (`desc_fetch`'s/`wr_track`'s own `err_q`),
so the edge-detector RTL (`fetch_err_q <= fetch_err_i; rise = fetch_err_i &
~fetch_err_q;`) expects its input to transition with that same timing
relationship. Driving the stimulus the way every other level/pulse input in
this project's testbenches is driven - a blocking assignment set early, at
a `negedge`, stable for the whole half-cycle before the next `posedge` -
does NOT reproduce that relationship: by the time the detector's own flop
first samples the input, it has already been stable, so the flop catches
the "new" value on its very first opportunity too, with zero lag relative
to the live signal - `fetch_err_rise` never sees a cycle where one is 1 and
the other is still 0, so no pulse ever appears. The fix was a non-blocking
assignment (`fetch_err[2] <= 1'b1;`) scheduled at the matching `posedge`
instead, which reproduces exactly what a real upstream register does:
everything triggered by that edge reads the OLD value of everything else
also triggered by it, giving the detector's own flop the one genuine cycle
of lag it needs. Full comment in `tb/tb_irq_ctrl.sv`'s phase 2.

### `perf_cnt.sv` — per-channel activity counters

Delivered:
- [`rtl/stat/perf_cnt.sv`](rtl/stat/perf_cnt.sv) - byte/packet/error/stall
  counters per channel, reusing `cnt_sat` (phase 1) five times per channel
  rather than hand-rolling counters from scratch.
- **Tapped at each channel's own gated beat stream (chan_top's output),
  not after dma_sched's arbitration mux.** A channel is stalled only when
  IT has a beat ready and IT is not being accepted - measuring downstream
  of the shared arbiter would conflate "this channel is backed up" with
  "some other channel currently holds the shared write path," which is not
  the same fault.
- **CH_ERR_CNT vs CH_CRC_STATUS is a genuine, previously-undocumented
  register-semantics decision, not a spec lookup.** Neither `daq_pkg.sv`
  nor PLAN.md's register-map sketch says more than the two names. Read
  here as: CH_ERR_CNT counts every error-class cause a channel has raised
  (reusing `irq_ctrl`'s already-computed per-channel cause vector rather
  than re-deriving the same edge detection twice), while CH_CRC_STATUS
  narrows that same stream to CRC-32 mismatches specifically.
- CH_ECC_STATUS is a constant zero - no ECC hardware exists anywhere in
  this design (the channel FIFO carries no SECDED encoding), so
  `ErrEccUncorr` is unreachable by construction. Same documented-gap
  treatment `chan_ctrl.sv`'s own header already gives
  `ch_cause_o[IrqCauseFifoOvf]`.
- Block testbench: [`tb/tb_perf_cnt.sv`](tb/tb_perf_cnt.sv). Six phases:
  full-strobe beats with packet count only on an accepted eop, a
  partial-strobe beat advancing byte count by popcount not full width,
  backpressure counted as stall without moving byte/pkt counts, each of
  the three error-class cause bits bumping CH_ERR_CNT with only
  IrqCauseCrc also bumping CH_CRC_STATUS, `ch_abort_i` clearing only the
  aborted channel's counters, and CH_ECC_STATUS reading zero on every
  channel.
- Mutant: [`mutants/perf_cnt_MUTANT.sv`](mutants/perf_cnt_MUTANT.sv)
  (`MUT_PERF_BYTEWRONG`, `MUT_PERF_NOSTALL`, `MUT_PERF_ERRMISS`).

#### Lint gate — parameter sweep

Clean across all 6 configurations on the first attempt.

### `daq_subsystem.sv` — top-level integration, and the CDC audit

Delivered:
- [`rtl/daq_subsystem.sv`](rtl/daq_subsystem.sv) - instantiates and wires
  every phase 1-5 block per PLAN.md's own architecture diagram.
- **The CDC audit's main finding: `reg_clk` and `axi_clk` are unified into
  one clock, a real deviation from PLAN.md's original sketch.** The plan's
  architecture has `axil_slave`/`daq_csr` on a separate `reg_clk`, with an
  explicit CDC boundary into `axi_clk`'s DMA engine. That is not what got
  built: `daq_csr.sv` (phase 2, already verified/committed) takes a single
  `clk_i` with no CDC awareness anywhere in its own interface - its
  write-commit logic reads `ch_busy_i`/`ch_cause_i`/etc. as plain
  same-cycle combinational inputs, which would be a genuine metastability
  hazard if those inputs actually crossed a real asynchronous boundary.
  Retrofitting a real crossing now would mean reopening an already-verified,
  committed module for a boundary its own concrete implementation never
  needed - a real DAQ card's register interface and DMA engine are
  routinely driven from the same PLL output in practice. Full reasoning in
  the file's own header.
- **Audit method and result: grepped every `rtl/*.sv` file for any
  clock-typed signal other than `clk_i` (a module's own generic clock
  port name) and `src_clk_i`/`src_clk_i[c]`.** Every module outside
  `chan_top.sv`/`daq_subsystem.sv` declares exactly one `clk_i` port and
  nothing else - no module anywhere in this design carries two clock
  ports or references a second clock signal internally. `chan_top.sv`
  remains the SOLE place a real clock domain is crossed
  (`prim_fifo_async` + `prim_rst_sync` per domain, already verified in
  phase 3); `daq_subsystem.sv` only ever passes each channel's
  `src_clk_i[c]` straight through to that one already-audited boundary,
  never touching it with any logic of its own. This is the audit PLAN.md's
  phase 5 gate calls for, and its conclusion is: given the reg_clk/axi_clk
  unification above, there is exactly one clock-domain crossing in the
  entire design, and it was already closed out in phase 3.
- `GLOBAL_CTRL.global_enable_o` ANDs with every channel's own `CH_CTRL`
  enable bit - a channel only runs when both are set. `soft_rst_pulse_o`
  derives a second, one-cycle-wide reset (`ctrl_rst_n`) covering every
  DMA-side block (chan_top, dma_sched, desc_fetch, both AXI masters,
  wr_track, irq_ctrl, perf_cnt) but NOT `axil_slave`/`daq_csr`, so software
  keeps its own register state readable through a soft reset instead of
  losing its own configuration along with the datapath it just reset.
- **Two register-map outputs are left genuinely unconnected - a
  pre-existing gap from phases 1-4, not something introduced here.**
  `err_inject_o` and `axi_max_burst_o`/`axi_outstanding_o` are read/write
  registers in `daq_csr.sv` with no consumer anywhere in the RTL: no
  fault-injection hook exists, and both AXI masters split bursts against
  `daq_pkg::MaxBurst`, a compile-time constant, not a runtime register.
  Making either real would mean changing the interface of already-verified
  modules, out of scope for a wiring-only phase.
- **Lint clean across all 6 parameter-sweep configurations** (`NumCh`
  1/2/8 × `AxiDw` 32/64) - the full design elaborates as one unit.

#### Smoke-level integration test

[`tb/tb_daq_subsystem.sv`](tb/tb_daq_subsystem.sv): one channel (`NumCh=1`
build), one descriptor, one packet, driven entirely over the two real
external interfaces - AXI4-Lite for configuration, the channel's own
`src_clk` stream for data (at a deliberately different period from `clk_i`,
non-integer ratio, so the one real CDC crossing is genuinely exercised) -
with a single shared AXI4 memory model answering both `axi_rd_master`'s
descriptor-fetch reads and `axi_wr_master`'s payload writes. Not the
integration UVM environment phase 6 calls for (no randomised traffic, no
scoreboard, a single channel) - it exists to prove the wiring in
`daq_subsystem.sv` is actually correct end-to-end, which the lint/
elaboration gate alone does not demonstrate.

Sequence and checks: configure over AXI4-Lite (`CH_DESC_BASE`, `CH_CTRL`,
`GLOBAL_CTRL`, `IRQ_ENABLE`/`CH_IRQ_ENABLE`, `CH_DESC_CTRL.go`), poll
`CH_STATUS.busy` until `desc_fetch` has validated the descriptor, send one
CRC-correct packet sized to exactly the descriptor's length, wait for
`CH_IRQ_STATE`'s Done cause, then check: the memory model's payload address
holds the exact bytes sent, `irq_o` itself only asserts once IRQ_ENABLE/
CH_IRQ_ENABLE actually unmask the cause, and `CH_BYTE_CNT`/`CH_PKT_CNT`
read back correctly over AXI4-Lite. Every AR/AW is also checked for
ARSIZE/ARBURST/ARID/ARCACHE/ARPROT (mirroring `axi_rd_master`'s/
`axi_wr_master`'s own block-level checks), and WSTRB/WLAST on the one W
beat. Passed on the first real run after being wired up, and 8 additional
runs (5 fixed `-Seed` values, 3 more at the default random seed).

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

Phase 4 is complete: `dma_sched.sv`, `desc_fetch.sv`, `axi_rd_master.sv`,
`axi_wr_master.sv`, `wr_track.sv` all done, verified, and lint-clean across
the parameter sweep. Every phase-4 module now has a real consumer for every
signal it produces (e.g. `desc_fetch.sv`'s `ch_desc_addr_o`/
`ch_desc_maxlen_o` are `axi_wr_master.sv`'s own inputs now) - none of them
are only exercised by a block testbench's stand-in anymore, except where the
plan always intended a later phase to close the loop (`ch_desc_valid_o` is
still not consulted by anything, a deliberate documented choice in
`axi_wr_master.sv`'s own header, not a gap).

Phase 5 is complete: `irq_ctrl.sv`, `perf_cnt.sv`, `daq_subsystem.sv` all
done, verified, and lint-clean across the parameter sweep, plus a smoke-
level integration test proving the whole design moves a byte end-to-end
for real. `daq_csr.sv`'s per-channel status/counter/cause inputs now have
real producers (`irq_ctrl.sv`/`perf_cnt.sv`) instead of a block testbench
stand-in; `ch_enable_o` now has a real consumer (every `chan_top`, gated
by `global_enable_o`). A write error still does not halt a channel's ring
walk - `wr_track.sv`'s own documented gap - left as-is rather than
reopening the already-verified `desc_fetch.sv` to add the qualifier;
whether phase 6's integration environment needs to close this is still
open.

Phase 6 (integration UVM, formal per block, regression script) is started,
not complete - see the next section for exactly how far. Two register-map
outputs remain permanently unconnected unless a later decision changes their
scope: `err_inject_o` (no fault-injection hooks anywhere) and
`axi_max_burst_o`/`axi_outstanding_o` (both AXI masters use
`daq_pkg::MaxBurst` as a compile-time constant, not a runtime value).

## Phase 6 — per-block formal, started (2026-08-29)

Scope per [PHASE_3_6_PLAN.md](PHASE_3_6_PLAN.md): integration UVM environment,
per-block SymbiYosys formal, a parameter-sweep regression script, and
full-stack mutation. That plan document itself flags phase 6 as likely the
largest remaining phase; this session made a real, verified start on the
formal piece and nothing else. Not claiming more than that.

**Four blocks formally proven, each an unbounded k-induction proof plus full
mutation coverage** — every documented mutant in `mutants/` for these four
modules is caught by the specific property that states the guarantee it
breaks, not a downstream symptom:

| Block | Proof | Mutants (all caught) |
| --- | --- | --- |
| `skid_buffer.sv` | `formal/skid_buffer.sby` — PASS by k-induction | `MUT_SKID_READY`, `MUT_SKID_BYPASS`, `MUT_SKID_DRAIN` |
| `cnt_sat.sv` | `formal/cnt_sat.sby` — PASS by k-induction | `MUT_CNT_WRAP`, `MUT_CNT_CLEAR_LOSE` |
| `dma_sched.sv` | `formal/dma_sched.sby` — PASS by k-induction | `MUT_SCHED_STICKYLOCK`, `MUT_SCHED_EARLYUNLOCK`, `MUT_SCHED_DBLREADY` |
| `daq_csr.sv` | `formal/daq_csr.sby` — PASS by k-induction | `MUT_CSR_IRQNOHW`, `MUT_CSR_NODECERR`, `MUT_CSR_GOALL` |

All four are single-clock, so - unlike Sample Test 3's CDC blocks - a genuine
unbounded proof is the right target and closes on the first attempt (no
induction-helper invariants needed).

**A real formal coverage gap was found and closed while proving
`skid_buffer.sv`, not assumed away.** The first property set (capacity,
no-silent-accept, correct-source-selection, no-silent-drop) passed on golden
RTL but let `MUT_SKID_DRAIN` through - the mutant clears the skid register the
instant it becomes occupied rather than waiting for `out_advance`, which drops
the skidded beat one cycle before any of those four properties ever observe
`skid_valid_q` as true in their one-cycle-history checks. A fifth property
("no premature drain": `skid_valid_q` may only clear on the cycle
`out_advance` fires) was added and closes the gap - the mutant now fails
exactly there. Recorded in `skid_buffer_formal.sv`'s own comments so the next
person to touch this file knows why that property exists.

**`dma_sched.sv`'s proof deliberately does not claim round-robin fairness.**
Fairness ("a channel that keeps requesting is eventually granted") is a
liveness property; `mode prove` k-induction proves only safety. What is proven
is packet-atomicity and mutual exclusion instead: `$countones(ch_ready_o) <= 1`
always, a lock only releases on a genuinely *accepted* eop beat (not merely an
offered one), a lock that should release on a single-beat packet actually
does, and a grant is never taken on a non-sop beat. `NumCh` was overridden to
2 via `-DDAQ_NUM_CH=2` (the same package override the lint parameter sweep
already uses) to keep the state space small - 2 channels is the minimum that
can exercise "another channel's sop arrives while one is locked" at all, which
is what every one of the three documented mutants attacks. `AxiDw` was left at
its real default (64) after overriding it to 8 broke elaboration entirely: it
collapses `daq_pkg`'s `DescAlignBytes` (`= AxiDw/8`) to 1, and
`$clog2(1)-1 = -1` makes an unrelated function elsewhere in the package
declare a reversed `[-1:0]` bit range - the package elaborates as a whole, so
a width choice with no connection to `dma_sched` itself still broke the build.

**`daq_csr.sv`'s proof reuses `daq_status_sync.sby`'s exact three-property
split for a simultaneous-hardware-set/software-clear W1C register** (per-bit
hardware-always-wins, a clear takes effect on any bit it names that hardware
did not also set, an untouched bit is preserved exactly), applied per channel
to `CH_IRQ_STATE`. Also proves the address decode is genuinely one-hot (at
most one `sel_*` live at once - the module header's own claim about why the
read mux and write-commit path cannot drift), `CH_DESC_CTRL`'s go pulse fires
for the addressed channel only and never lingers, channel isolation (a write
naming channel 0 provably leaves channel 1's `CH_CTRL`/`CH_DESC_BASE`/
`CH_IRQ_ENABLE` storage untouched, and vice versa), and `irq_o`'s summary
formula. `NumCh` overridden to 2, same reasoning as `dma_sched.sv`'s proof -
2 is the minimum that can exercise isolation at all.

**The pre-existing block-TB mutant file (`mutants/daq_csr_MUTANT.sv`) was
diffed against golden before reuse, not trusted on the strength of its own
git history** - the lesson from phase 3's `chan_ctrl_MUTANT.sv` staleness
incident applies to every mutant file, not just the one it happened to. It
was current (comments aside), so the same three `ifdef` defects
(`MUT_CSR_IRQNOHW`/`MUT_CSR_NODECERR`/`MUT_CSR_GOALL`) were reused directly
for the formal mutation runs rather than re-authored.

**A reset-check timing bug in the harness itself, not the RTL, on the first
attempt.** A first version gated the reset-defaults assertions on a
registered `just_reset_q` flag (`<= !past_valid`, one clock behind
`past_valid` itself) and immediately found a "failure": `CH_IRQ_STATE`
nonzero right after reset. Root cause was the checker, not `daq_csr.sv` -
that extra register delay meant the check landed one real operating cycle
*after* the reset branch's defaults were visible, by which point
`ch_cause_i` (a free, unconstrained input the proof lets the solver pick
freely) had already legitimately been latched in, exactly as designed.
Fixed by checking reset defaults on `rst_ni && !past_valid` directly - the
same cycle boundary `dma_sched_formal.sv`'s own `past_valid`-gated
properties already use to mean "first real cycle," just without adding a
second register in front of it. The general lesson: in a k-induction
harness built from this project's own `cyc`/`rst_ni`/`past_valid` reset
generator, `!past_valid` already *is* "the first cycle out of reset" -
building a second, further-delayed flag on top of it checks the wrong cycle.

**A path lesson: `sby`'s process crashed silently (`returncode=3221225781`,
i.e. `STATUS_DLL_NOT_FOUND`) with an empty `design.log`** when `yosys.exe`
was launched with only `oss-cad-suite\bin` on `PATH` and not
`oss-cad-suite\lib` too - the same DLL-shadowing/missing-runtime class of
issue this project's Verilator scripts already carry a PATH-ordering fix
for, just manifesting as a bare crash instead of a `STATUS_ENTRYPOINT_NOT_FOUND`
this time. Both directories need to be on `PATH` before invoking `sby`
directly (`scripts/run_lint.ps1`'s own `$env:PATH` line already does this
for the lint/block-TB flows; there is no equivalent wrapper script for
`sby` yet).

**A path/PATH lesson for any future `read_slang` harness that pulls in
external OpenTitan `prim` files**: `sby`'s `[files]` section accepts absolute
Windows paths directly (unlike OpenLane's config, which refuses anything
outside its working directory and needed the `dir::../../../../../verilog`
relative-traversal workaround in `asic/chan_top/config.json`) - so pulling
`prim_arbiter_tree`/`prim_arbiter_ppc`/`prim_leading_one_ppc`/`prim_assert`
straight from `D:\MyWork\verilog\dbs\opentitan\...` needed no path gymnastics,
just listing them. Two things did trip on the first attempt: quoting a `-I`
path in the `[script]` line's `read_slang` invocation is taken literally as
part of the string (produces a "no such directory" warning for a path with
stray quote characters in its name, then cascades into "unknown macro"
errors for everything that header would have defined) - the fix was to drop
`-I` entirely and instead list the two `.svh` files `prim_assert.sv` actually
`` `include``s (under the `SYNTHESIS` define `read_slang` sets implicitly,
which routes it to the dummy no-op macro set - see
`samples/sample_test_2/formal/prim_fifo_sync.sby`'s note on the same thing)
in `[files]` alongside it, since `read_slang`'s default include search checks
a file's own local directory - and every `[files]` entry lands in the same
flat `src/` directory regardless of its original path - before anywhere else.

**What genuinely remains for phase 6**, in the order it likely makes sense to
attempt them:

- Formal for the other ~11 blocks. Good next targets, roughly in order of
  value-for-effort: `axil_slave.sv` (AXI4-Lite handshake compliance),
  `wr_track.sv` (outstanding-write bookkeeping never goes negative or
  leaks). `chan_ctrl.sv`'s FSM and the two AXI masters' burst/4KB-split
  logic are higher-value but also harder targets - expect them to take real
  iteration, the way `skid_buffer.sv` and `dma_sched.sv` did here.
- The integration UVM environment (AXI4-Lite agent, 8 source agents, AXI4
  slave memory model with latency/SLVERR/DECERR, reference model, scoreboard)
  - the largest single item, not started.
- The parameter-sweep regression script - needs the integration environment
  to exist first, or is scoped down to re-running the existing lint sweep plus
  the new formal proofs across `NUM_CH`/`AXI_DW` values.
- Full-stack mutation, once the integration environment exists to run mutants
  through.

## Physical design — daq_subsystem (top-level, 8-channel), started (2026-08-30)

First attempt at running the full chip top through OpenLane, not just a
single block. Two real things were found in the process - one RTL bug this
flow is the first tool ever to have exercised, and one open question about
`chan_top`'s own previously-claimed timing closure that this session's full
re-run contradicts and did not have time to resolve.

**Setup**: `asic/daq_subsystem/config.json` + `asic/constraints/daq_subsystem.sdc`
+ `tools/wsl/100_run_daq_subsystem.sh`, following `chan_top`'s exact pattern
(launch from `/mnt/d/MyWork`, `dir::` relative traversal for the external
`prim` files, its own tool shim so it can't race `chan_top`'s). Clocking is
`clk_i` (32 ns, floor estimate carried over from `chan_top`'s own axi_clk_i -
see the caveat below) plus 8 independent `src_clk_i[c]` (10 ns each, reusing
`chan_top`'s proven value), all mutually asynchronous - not the 3-domain split
`PLAN.md` sketched; see `daq_subsystem.sv`'s own header comment for why reg_clk
and axi_clk were merged. The dependency list came from grepping every
`rtl/**/*.sv` file for actual module instantiations rather than trusting the
phase-1 planning table (which lists prim modules, e.g. `prim_secded_39_32` for
ECC, that were never actually wired in) - chip-wide there are exactly three:
`prim_fifo_async`, `prim_rst_sync` (both already in `chan_top`'s list) and
`prim_arbiter_tree` (new, for `dma_sched`'s channel arbitration; it does not
itself instantiate `prim_arbiter_ppc`/`prim_leading_one_ppc`, so those aren't
needed despite the formal harness listing them for a different reason).

**Bug found: `perf_cnt.sv`'s `$countones` crashes OpenLane's synthesis
frontend.** `perf_cnt.sv` (phase 3, already verified and committed) uses
`$countones(beat_strb_i[c])` to turn an AXI strobe into a byte count.
Verilator and the sby/slang formal flow both accept this without complaint -
it is legal SystemVerilog - but no earlier design pulled `perf_cnt.sv` into
OpenLane (`chan_top` doesn't use it), so this is the first time it met the
physical-design toolchain. OpenLane's "Generate JSON Header" step uses
yosys's classic AST frontend (not the `synlig`/UHDM frontend the main
synthesis step uses, even with `USE_SYNLIG: true`), which flags `$countones`
a "non-synthesizable construct," silently drops the call, and then segfaults
serializing the resulting malformed AST. Fix: a synthesizable accumulate-loop
popcount. First attempt declared it as a local `function automatic` inside
`perf_cnt.sv` itself - same classic frontend then failed differently
(`Can't resolve function name 'gen_ch[0].popcount'`), a real limitation of
that frontend when a module-local automatic function is called from inside a
`generate for` scope. Moved to `daq_pkg::popcount` instead, the same pattern
`axi_pkg::bytes_to_boundary` and this package's own `apply_wstrb` already use
- and proven safe specifically for the generate-block case by
`pkt_check.sv`'s `crc32_byte_step`, called from inside its own `g_crc_stage`
generate loop and already exercised successfully by `chan_top`'s completed
OpenLane run. Both fixes were verified behavior-preserving before trusting
them: rebuilt and re-ran `tb_perf_cnt` and `tb_daq_subsystem` (both pass) and
re-confirmed `MUT_PERF_BYTEWRONG` is still killed (`run_block_tb.ps1 -Mutant
MUT_PERF_BYTEWRONG`) after each change.

With that fixed, synthesis proceeds normally (~107k generic cells pre-tech-
mapping, vs. `chan_top`'s ~29.5k final stdcell count - consistent with "well
over 8x", as expected for 8 channels plus the shared DMA/CSR/IRQ/perf logic).
Full P&R was still running at the time of writing; `DIE_AREA` (3200x3200 um)
and `CLOCK_PERIOD` (32 ns, clk_i) are both first-pass estimates per the
config's own comments, not validated numbers.

**Resolved (2026-09-12): why `chan_top`'s "closes at 32/10" claim didn't hold
up.** `constraints/chan_top.sdc`'s own header claimed 32/10 was "verified
against the routed design... at the ss_100C_1v60 (worst) corner". The
2026-08-30 signoff re-run (`RUN_2026-08-30_20-00-29`) showed the opposite at
that corner: `timing__setup__wns = -8.4 ns`, `-150.4 ns` TNS, 926 violations.
Root cause, found by walking every historical `chan_top/runs/RUN_*` directory
for whatever check actually produced the "closes" claim:

- The fast recheck tool used between P&R attempts
  (`tools/wsl/94_sdc_check.tcl`/`95_run_sdc_check.sh`) reads
  `06-yosys-synthesis/chan_top.nl.v` - the **pre-placement, pre-route**
  netlist - with `read_liberty` but no `read_spef` at all. It was built and
  is only useful for checking CDC pin-pattern matches (its own header says
  "SDC syntax/match check"), not for any real delay number - with zero wire
  parasitics loaded, it cannot report a valid setup slack at any corner.
- A mid-flow checkpoint in the run history
  (`RUN_2026-08-29_16-32-56/42-openroad-stamidpnr-3/`) ran one hour before
  detailed routing - global-route-estimated parasitics, not extracted SPEF -
  and only evaluated **`nom_tt_025C_1v80`** (typical corner): `wns.max.rpt`
  shows `0.0`, `ws.max.rpt` shows `+2.58 ns`. Never touched
  `nom_ss_100C_1v60`.

**Correction (2026-09-14): the "verified against the routed design" claim
does have a real source, found jointly with a concurrent session working the
same repo** - an earlier pass through this investigation (above) wrongly
said no pre-`RUN_2026-08-30_20-00-29` run ever reached real signoff, because
only that run has a `final/` directory. `RUN_2026-08-28_19-41-37` was never
opened to check - it turns out to run all 74 stages including
`53-openroad-rcx` (real per-corner extracted SPEF:
`53-openroad-rcx/{max,min,nom}/chan_top.*.spef` all present) and
`54-openroad-stapostpnr` (real multi-corner signoff STA), it just never
wrote a `final/` directory. Its own `54-openroad-stapostpnr/state_out.json`
reports `timing__setup__wns__corner:max_ss_100C_1v60 = -23.46 ns` - matching
RESULTS.md's own already-documented "first signoff attempt at 6/10 ns failed
badly" account almost exactly (-23.1 ns there). Confirmed by checking the
SDC actually in effect throughout that run, from `13-openroad-floorplan/`
through `51-openroad-fillinsertion/`: `create_clock ... -period 6.0000`
(`src_clk`) / `-period 10.0000` (`axi_clk`), unchanged start to finish. So
this run's real, extracted-SPEF physical implementation was built to hit
6/10 ns, not 32/10.

The "32/10 closes, verified against the routed design" claim came from
re-running OpenSTA against *this run's* real DEF + real extracted SPEF with
a *different*, substituted SDC (candidate `axi`/`src` periods swapped in
after the fact) - which is a legitimate technique (real parasitics don't
change based on what period you later ask about) but answers a different
question than it looks like it answers. A physical implementation that was
placed, resized, buffered, and routed to fight for an aggressive 6 ns/10 ns
target receives *more* optimization effort throughout the entire flow than
one the tool is only ever asked to hit 32/10 ns for - so it is expected to
have slack left over when re-graded against the much looser 32/10 ns
requirement after the fact. That is not the same as what a **from-scratch**
run targeting 32/10 ns from the first synthesis pass would produce, because
the tool calibrates its own optimization effort to whatever target it is
actually given. Both of this session's real, independent, from-scratch-
targeting-32/10 runs - `RUN_2026-08-30_20-00-29` (`DEFAULT_CORNER`=typical)
and the `DEFAULT_CORNER`=`nom_ss_100C_1v60` retarget experiment below - show
the opposite of "closes," which is the answer that actually matters for an
eventual tapeout (nobody ships a 6/10 ns-optimized layout and calls it a
32/10 ns part - a real 32/10 ns chip gets synthesized and placed *for*
32/10 ns from the start). **Conclusion stands, now with a full account of
where the contradicting claim came from rather than an unexplained gap**:
`chan_top` genuinely does not close at 10/32 ns for a from-scratch
implementation at the worst corner, and needs either a slower period or the
CRC/CDC-mux restructuring already flagged.

Separately, the completed run's own final metrics confirm the *typical*
corner really does close cleanly for a from-scratch 32/10 ns implementation:
`timing__setup__wns__corner:nom_tt_025C_1v80 = 0`,
`timing__setup__ws__corner:nom_tt_025C_1v80 = +2.36 ns`, 0 violations - a
close match to the earlier pre-route estimate. So the "closes at 32/10"
claim is genuinely true and reproducible for the *typical* corner specifically
- just never true for the worst corner, at any of the three from-scratch
implementations tried so far.

**Conclusion**: `chan_top` at 10/32 ns closes fine at typical process/voltage/
temperature, but was never actually checked at the worst corner
(slow-slow silicon, 100°C, 1.60V) before this session's completed run - the
SDC header's claim to have verified the worst corner was not backed by any
saved artifact, and the one saved partial-flow check that exists used the
typical corner instead. This is now a real, not merely apparent, timing
closure gap: at `ss_100C_1v60`, `chan_top` needs either a slower `axi_clk`
period than 32 ns, or the CRC/CDC-mux restructuring the SDC header already
flagged as the underlying fix, before this design is worst-corner clean.
Not yet re-tuned - next step if picked up: bisect `axi_period` upward from
32 ns against `nom_ss_100C_1v60` specifically (the informal-check script
should be rewritten to actually read a routed netlist + real SPEF and
target that corner, or simply re-run the full flow at each candidate period
and read `final/metrics.json` directly, per the lesson above).

## Physical design — P&R optimization options in this OpenLane 2.3.10 install (2026-09-12)

Asked: can placement+routing be optimized "all at once" instead of the
current one-shot-then-inspect-at-the-end approach, and what alternatives
exist. Investigated by reading the installed package
(`openlane/flows/*.py`, `openlane/steps/openroad.py`,
`openlane/config/variable.py`) rather than going by general OpenLane
knowledge, since this is exactly the install both `chan_top` and
`daq_subsystem` actually run through. Four real mechanisms exist; none is a
drop-in "just do it better" replacement for the current flow - each is a
genuine trade-off.

**1. `SynthesisExploration` flow - real, usable, but pre-P&R only.**
`openlane/flows/synth_explore.py` runs all 8 of yosys/ABC's built-in
strategies (`AREA 0-3`, `DELAY 0-4`) **in parallel**, then prints a
comparison table (gates, area, worst setup slack, TNS per strategy) so you
can pick the best `SYNTH_STRATEGY` before committing to a full run. This is
a legitimate, ready-to-use alternative to guessing a synthesis strategy up
front - `openlane --flow SynthesisExploration <config>`. Limitation: its
`Steps` list is only `[Yosys.Synthesis, OpenROAD.CheckSDCFiles,
OpenROAD.STAPrePNR]` - pre-placement, no real wire delay, same blind spot
`94_sdc_check.tcl` has. Good for picking a starting strategy, not for
predicting final timing.

**2. `Optimizing` flow - real, but explicitly a demo, and it stops at global
placement.** `openlane/flows/optimizing.py`'s own comment calls it "a custom
demo flow to show what's possible with non-sequential Flows". It runs the
same 3-strategy synthesis race, picks the smallest-area result, then tries
floorplanning + IO placement + global placement at `FP_CORE_UTIL=99`,
falling back to `40` if that fails. It never runs CTS, detailed placement,
routing, or any signoff STA - `Steps` ends at `OpenROAD.GlobalPlacement`.
Not usable as-is for a real run; would need to be forked/extended to
actually finish a design, at which point it stops being a novel flow and
becomes "Classic with a smarter floorplan step."

**3. Multi-corner optimization during placement/routing is already the
default - the chan_top gap above was not "only optimizing one corner".**
Checked `ResizerStep.run()` in `openroad.py`: every resizer-based repair
step (`CTS`, `RepairDesignPostGRT`, `ResizerTimingPostCTS`,
`ResizerTimingPostGRT`) resolves its corner list from `RSZ_CORNERS`, which
falls back to `STA_CORNERS` when unset - and neither `chan_top`'s nor
`daq_subsystem`'s config overrides either variable, so both already default
to the PDK's full corner set. `chan_top`'s own completed `final/metrics.json`
proves this empirically: it has real reported numbers for all 9 corners
(`nom/min/max` x `tt/ss/ff`), not just one - the tool clearly did evaluate
`ss_100C_1v60` throughout the flow, it just couldn't close the resulting
violation through cell-level ECO (buffering/upsizing) alone. This matters:
it means the -8.4 ns gap is a **structural** logic-depth problem (needs a
pipeline stage or the CRC/mux restructuring already flagged), not something
a "try harder" resizer setting would fix.

**4. Hierarchical (macro-based) P&R is real, fully wired-in, and the most
promising actual alternative for `daq_subsystem` specifically.**
`openlane/config/variable.py`'s `Macro` dataclass (referenced by the
`MACROS` config variable, used across `openroad.py`/`odb.py`/`magic.py`) lets
a top-level run treat an already-hardened block as a placeable macro instead
of flattening its RTL in - it takes GDS + LEF (required) plus optional
per-corner LIB/SPEF/netlist for hierarchical STA, and an `instances: {name:
Instance{location, orientation}}` map for where to place each copy.
`chan_top`'s own `final/` directory already has every one of these files
(`gds/`, `lef/`, `lib/`, `spef/`, `nl/`) sitting there from its completed
run. This is the standard "harden once, place N times" ASIC methodology,
and it directly addresses two problems this project has already hit
empirically:
  - **Runtime**: P&R runtime scales worse-than-linearly with cell count
    (already observed going `chan_ctrl` → `chan_top`, ~22x the cells took
    far more than 22x the time). `daq_subsystem`'s current flat approach
    resynthesizes and re-places 8 essentially-identical copies of `chan_top`
    from scratch inside one ~107k-cell run. Hardening `chan_top` once and
    instantiating it 8x as a macro turns that into 1 real P&R run plus 8
    cheap macro placements.
  - **Predictability**: each macro's internal timing is closed (or not, and
    known) independently of the top-level run, rather than an 8x-bigger flat
    netlist surfacing a new worst path somewhere unpredictable (as happened
    twice already: chan_top's own CRC/mux path, then perf_cnt's synthesis-
    frontend crash, both first discovered only at the level where they
    happened to matter).

  **The real trade-off, not free**: hierarchy trades whole-design
  optimization for modularity. Cross-macro paths need explicit
  `set_input_delay`/`set_output_delay` timing budgets at every macro
  boundary (the per-channel IO budgets already written into
  `constraints/daq_subsystem.sdc` are exactly this, so the current SDC
  is not wasted work if this path is taken later) - the top level can no
  longer discover and fix a critical path that happens to cross a macro
  boundary the way flat P&R can. It also means `chan_top` needs to be
  worst-corner timing-clean *first* (see the finding above) before hardening
  it as a reusable macro is worthwhile - hardening a known-broken block 8x
  over just multiplies the same violation instead of fixing it once.

  Not attempted this session - `daq_subsystem`'s currently-running attempt
  is the flat approach. If the flat run's own runtime or final timing turns
  out to be a real problem, hierarchical macro-based P&R (harden `chan_top`
  once, after fixing its worst-corner timing, then reference it via `MACROS`
  in a new top-level config) is the concrete next thing to try, not a vague
  "maybe possible" - the mechanism is proven-present in this exact install.

**No built-in parameter-sweep/DSE tool exists in this OpenLane 2.3.10
install** for the kind of thing `chan_top`'s clock-period bisection did
manually (try 10/32, try 30/32, etc.) - no `openlane/flows/*.py` file does
this, and there's no `dse`/`sweep` module in the package. That kind of sweep
still has to be done by hand or with an external loop calling `openlane`
once per candidate period and reading `final/metrics.json` back (which is
what the `chan_top` worst-corner re-tune above should do, this time actually
targeting `ss_100C_1v60`).

## chan_top — worst-corner-targeted synthesis experiment (2026-09-12)

Tried the fast-mid-flow-estimate idea directly: OpenLane's `OpenROAD.STAMidPNR`
step (there are 4 in the Classic flow, at increasing fidelity as the flow
progresses) uses `estimate_parasitics -global_routing`/`-placement` - a real
"cheap estimate before the expensive step" mechanism already built in, per
its own script (`openroad/sta/corner.tcl`) and log line
(`"[INFO] Setting RC values..."`). But it only evaluates **one** corner per
run - `openroad/sta/corner.tcl`'s own comment says so explicitly ("supports
one defined corner per-process") - driven by the `DEFAULT_CORNER` config
variable, which is `pdk=True` and defaults to `nom_<typical_pvt>`
(`config/pdk_compat.py`). This is the exact same variable, defaulting to the
exact same typical corner, that caused the original "closes at 32/10" miss:
the historical mid-flow checkpoint that exists in this project's run history
(`RUN_2026-08-29.../42-openroad-stamidpnr-3`) only ever saw
`nom_tt_025C_1v80` because nothing ever overrode `DEFAULT_CORNER`.

Ran `chan_top` again with `-c DEFAULT_CORNER=nom_ss_100C_1v60` (an OpenLane
CLI run-only override, no config.json edit -
`tools/wsl/101_chan_top_worst_corner_estimate.sh`). Two implementation
gotchas along the way, both fixed in the script:
- `-c KEY=VALUE` for a string variable must NOT be quoted
  (`DEFAULT_CORNER=nom_ss_100C_1v60`, not `DEFAULT_CORNER="nom_ss_100C_1v60"`)
  - the quotes get taken as literal characters in the string value, which
    then matches no real corner and leaves yosys's `DFFLIBMAP` pass with zero
    liberty files (`ERROR: Missing -liberty liberty_file option!`).
- `DEFAULT_CORNER` must be a `nom_*`-prefixed corner - trying
  `max_ss_100C_1v60` (the actual worst-of-9 corner) hit the identical
  DFFLIBMAP error; synthesis's own liberty lookup
  (`toolbox.filter_views(config, config["LIB"])` in `openlane/steps/yosys.py`)
  apparently only resolves against the nominal-corner family. `nom_ss_100C_1v60`
  (same slow-process/high-temp/low-voltage combination, just not the single
  worst of the 9) works and is still a meaningfully bad corner.

Intended to stop early via `-T OpenROAD.STAMidPNR-3` (the 4th, most-accurate
mid-flow checkpoint, right before the slow `DetailedRouting`/`RCX` steps) -
`--to` did not actually halt the sequential flow at that repeated-step id
(ran to `78/78`, "Flow complete" - worth filing as a real limitation of
this OpenLane version's `-T` handling for steps that appear multiple times
in one flow, not investigated further this session). The upside: it still
finished in **32m38s**, versus this design's earlier from-scratch run's
much longer wall time, and now with a REAL RCX-extracted-SPEF signoff
result rather than just an estimate, since it ran to completion anyway.

**Result - the worst-corner number improved, but at the price of the
typical corner:**

| | old run (2026-08-30, `DEFAULT_CORNER`=nom_tt) | new run (2026-09-12, `DEFAULT_CORNER`=nom_ss) |
|---|---|---|
| cells | 29,510 | 29,474 |
| setup WNS (worst of 9) | -8.40 ns | **-7.16 ns** (better) |
| setup TNS (worst of 9) | -150.4 ns | **-129.2 ns** (better) |
| setup violation count | 926 | **463** (better) |
| `nom_tt_025C_1v80` (typical) | **0 - clean** | **-3.78 ns - now broken** |
| `nom_ss_100C_1v60` | -7.94 ns | -7.16 ns (better) |

Retargeting synthesis's reference liberty toward the worst corner does not
fix the underlying problem - it **redistributes** it. ABC's technology
mapping and the resizer's cell selection/sizing optimize against whichever
one corner `DEFAULT_CORNER` points to; biasing that toward `ss_100C_1v60`
measurably helped every `ss` corner and the aggregate worst-of-9 numbers,
but broke the previously-clean typical corner in the process. There is no
single `DEFAULT_CORNER` choice, at 10/32 ns, that closes every corner at
once with this RTL - which is exactly what "the CRC/CDC-mux chain is
architecturally too deep for this period at every corner, just by different
margins" would predict, and lines up with `ResizerTimingPostCTS`'s own
explicit `[RSZ-0062] Unable to repair all setup violations` warning (present
in both runs) - cell-level ECO can shrink the gap and shift which corner
hurts most, but cannot close it. **Confirms, rather than changes, the
conclusion above**: the real fix is a slower `axi_clk` period or pipelining
`pkt_check`'s CRC-32 chain / the CDC FIFO's read-side mux, not a synthesis-
strategy or corner-targeting trick. Not yet attempted this session (both
`daq_subsystem`'s flat run and this experiment were using shared CPU/WSL
resources) - next concrete step if picked up: bisect `axi_period` upward
(e.g. 40, 48 ns) using this same fast worst-corner-targeted approach, with
`DEFAULT_CORNER=nom_ss_100C_1v60` and `-c CLOCK_PERIOD=...` together, reading
`final/metrics.json`'s `timing__setup__wns__corner:nom_tt_025C_1v80` AND
`:nom_ss_100C_1v60` both, since this experiment shows a period/strategy that
fixes one can break the other.

## Physical design — SYNTH_STRATEGY exploration, and sequential vs concurrent runs (2026-09-14)

Two things done together: pick a real `SYNTH_STRATEGY` for `chan_ctrl`/
`cnt_sat`/`skid_buffer` using OpenLane's own `SynthesisExploration` flow
(discovered but not used in the 2026-09-12 P&R-options investigation above),
and measure whether running independent designs concurrently instead of
one-after-another is actually worth doing - timed both ways in the same
session rather than assumed.

### `SynthesisExploration` results - real evidence, not a guess

[`tools/wsl/107_synth_explore.sh`](tools/wsl/107_synth_explore.sh) runs
`openlane --flow SynthesisExploration <config>`, which tries all 9 yosys/ABC
strategies (`AREA 0-3`, `DELAY 0-4` - each a different `resub`/`rewrite`/
`refactor`/`balance` restructuring sequence into a different `map -p -a`
(area-biased) or `map -p` (delay-biased) technology mapping, `AREA 3` alone
using a distinct ORFS-style `dch`+`topo` script) and reports gates/area/
worst-setup-slack/TNS per strategy. Scope: `Yosys.Synthesis` +
`OpenROAD.CheckSDCFiles` + `OpenROAD.STAPrePNR` only - pre-placement, no real
wire delay, same blind spot the fast SDC-check script already had. Tells you
which strategy is smaller/faster *on paper*; not a substitute for a routed
result.

| Design | Current default (`AREA 0`) | Best found | Verdict |
| --- | --- | --- | --- |
| `chan_ctrl` | 789.5 µm², slack 2.45 ns | **`AREA 2`**: 782.0 µm² (−0.9%), slack 2.59 ns (+5.8%) | Strictly better on both axes - no trade-off, switch |
| `cnt_sat` | 1975.6 µm², slack 3.98 ns | **`AREA 1`**: 1911.8 µm² (−3.2%), slack 3.72 ns (still 0 TNS) | Genuine trade-off - smaller, slightly less margin, still comfortably positive |
| `skid_buffer` | 2864.0 µm², slack 4.82 ns | `AREA 0`/`AREA 1` tie for smallest; `DELAY 4` gives 5.72 ns slack for +26.7% area | Already at the area optimum - no change needed |

`AREA 1` crashed outright for `chan_ctrl` specifically (`capnp` schema
mismatch inside pyosys - a yosys-internal issue with that design/strategy
combination, not investigated further since `AREA 2` already won). All
9-strategy tables are archived per design at
`asic/<design>/synth_explore_summary.txt`.

**Applied and re-verified with full P&R** - see the
"`SYNTH_STRATEGY` re-verification" section below; the pre-placement numbers
above are `Yosys.Synthesis` + `STAPrePNR` only and turned out not to predict
the routed result reliably, which is exactly why that re-run was necessary
rather than optional.

### Sequential vs concurrent: 1.43x, not 3x, and why

Asked directly: is there a real time cost to running independent block runs
one after another instead of all at once? Answer, timed rather than assumed
(`tools/wsl/108_synth_explore_compare.sh`, same three designs, same host,
back-to-back in one session so nothing else was competing for the machine
in between):

| Mode | chan_ctrl | cnt_sat | skid_buffer | Total |
| --- | --- | --- | --- | --- |
| Sequential | 25.0s | 29.6s | 26.2s | **80.8s** |
| Concurrent (all 3 backgrounded) | — | — | — | **56.4s** |

**1.43x speedup, not 3x**, because the host has 8 CPU cores
(`nproc` = 8) and each `SynthesisExploration` run already uses its own
internal thread pool to run 9 strategies in parallel - three such runs
backgrounded together are three thread pools contending for the same 8
cores, not three independent machines. This is CPU-bound contention, not
I/O-wait that concurrency would hide "for free". The results were verified
identical between the two modes (byte-for-byte comparison table per design,
not just "it finished") - concurrency changed only wall-clock time, not any
synthesis outcome, which is the expected and necessary result for three
genuinely independent designs.

**Why this matters going forward, not just for these three small blocks**:
the same 1.4x-ish ceiling should be expected for any future batch of
independent OpenLane runs on this 8-core host (e.g. exploring more
strategies, or later per-block formal runs) - concurrency is worth doing
(free ~30% wall-clock reduction here) but should not be assumed to scale
past core count. `107_synth_explore.sh` itself had to be made safe for this
in the first place: its original shim setup (`rm -rf` + rebuild a single
shared `$HOME/.cache/openlane-tools/bin` path every invocation, the same
pattern `80_run_openlane.sh`/`87_run_chan_top.sh` use) would have raced
three concurrent copies against each other, deleting each other's symlinks
mid-flight - exactly the class of bug a live peer session's own shim
collision warning (2026-09-12) flagged for a different pair of scripts. Fixed
by giving each design its own shim path
(`$HOME/.cache/openlane-tools-<design>/bin`) and making the setup idempotent
(skip rebuilding if already present) instead of unconditional - both changes
are in `107_synth_explore.sh` now, not a one-off workaround in the compare
script.

### `SYNTH_STRATEGY` re-verification with full P&R (2026-09-14, later same day)

`SynthesisExploration`'s numbers above are pre-placement
(`Yosys.Synthesis` + `STAPrePNR`, no real wire delay). Before trusting them,
`config.json` was actually updated (`chan_ctrl` → `SYNTH_STRATEGY: "AREA 2"`,
`cnt_sat` → `SYNTH_STRATEGY: "AREA 1"`) and the **full** default OpenLane
flow (real floorplan, placement, CTS, routing, DRC, LVS, signoff STA) was
re-run for both, via a new race-safe runner
([`tools/wsl/109_run_full_pnr.sh`](tools/wsl/109_run_full_pnr.sh), same
per-design-shim pattern as `107_synth_explore.sh`) driven by
[`tools/wsl/110_run_full_pnr_compare.sh`](tools/wsl/110_run_full_pnr_compare.sh),
which also pulled each design's last full-flow run from before
`SYNTH_STRATEGY` existed as the baseline for a real before/after diff.

| Design | Baseline (`AREA 0`, routed) | New (routed, `SYNTH_STRATEGY` applied) | Pre-placement had predicted |
| --- | --- | --- | --- |
| `chan_ctrl` | 2887.77 µm², worst slack 1.958 ns, TNS 0 | **`AREA 2`**: 2905.29 µm² (**+0.6%**), worst slack 2.211 ns (**+12.9%**), TNS 0 | area −0.9%, slack +5.8% |
| `cnt_sat` | 2275.93 µm², worst slack 3.772 ns, TNS 0 | **`AREA 1`**: 2128.29 µm² (**−6.5%**), worst slack 4.132 ns (**+9.6%**), TNS 0 | area −3.2%, slack −6.5% (accepted trade-off) |

Both blocks: real net win after full P&R (better timing margin, no new
violations), but **the pre-placement prediction did not hold for either
design** - not even in direction, for two of the four numbers:

- `chan_ctrl`'s predicted area reduction (−0.9%) **reversed** to a small
  increase (+0.6%) after real buffering/repair during placement and CTS,
  while its predicted slack gain undersold the actual result (+12.9% vs the
  +5.8% predicted).
- `cnt_sat`'s predicted slack *cost* (−6.5%, an accepted trade-off for a
  smaller die) **reversed into a gain** (+9.6%) once real routing delay
  replaced the pre-placement estimate, on top of a bigger-than-predicted
  area win (−6.5% actual vs −3.2% predicted).

Net conclusion: `SynthesisExploration`'s pre-placement table is a reasonable
*first filter* for picking which strategy to try (both switches were still
correct calls - nothing here would have flipped a decision), but its actual
percentages are not reliable enough to report as the final PPA number for
either area or timing. Full P&R is the only step in this flow that measures
what a routed design will actually do; that's why this re-run is treated as
required confirmation, not a formality, and why it was worth doing before
this was called "done" for these two blocks. `skid_buffer` was left as
`AREA 0` since `SynthesisExploration` found no improvement available there
(see table above) - no full re-run needed for a strategy that wasn't
changed. Raw before/after run directories:
`asic/chan_ctrl/runs/RUN_2026-08-28_19-29-14` (baseline) vs
`asic/chan_ctrl/runs/RUN_2026-09-14_22-03-02` (new); `asic/cnt_sat/runs/
RUN_2026-08-26_12-43-50` (baseline) vs `asic/cnt_sat/runs/
RUN_2026-09-14_22-03-02` (new).

## chan_top — 12/48 ns from-scratch confirmation, real result (2026-09-18)

The from-scratch synthesis+P&R at `src_period=12.0`/`axi_period=48.0`
(`111_run_chan_top_safe.sh`, `RUN_2026-09-18_21-19-11`) completed to full
signoff. Real result, not an estimate:

| | 10/32 ns (`RUN_2026-08-30_20-00-29`) | 12/48 ns (`RUN_2026-09-18_21-19-11`) |
|---|---|---|
| cells | 29,510 | 31,147 |
| setup WNS (worst of 9, `max_ss_100C_1v60`) | -8.40 ns | **-2.73 ns** |
| setup TNS (worst of 9) | -150.4 ns | **-3.43 ns** |
| setup violation count | 926 | **5** |
| hold WNS / TNS / violations | (clean) | 0 / 0 / 0 (still clean) |

**Massive improvement (926 → 5 violating endpoints, -150 → -3.4 ns TNS) but
NOT fully closed.** The mid-flow re-timing prediction ("no plateau, closes
clean at 12/48") was directionally right - this is dramatically better - but
a genuinely fresh implementation still leaves 5 endpoints short by a small
margin. The remaining violators span both domains:
`ch_cause_o[0]`/`ch_cause_o[2]` (axi_clk, the same CRC/CDC-mux path
documented throughout this investigation) and several internal src_clk
flops. Given how close this is (-2.73 ns out of a 48 ns period, ~5.7%
short) and that TNS is already tiny, the next cheap thing to try is a
modest further period increase (e.g. 14/52 or 14/56) via the same
from-scratch confirmation pattern, before concluding RTL pipelining is
actually required - unlike the 926-violation case, 5 endpoints this close
is exactly the regime where a small period bump plausibly finishes the job
without touching RTL at all. Not yet tried this session.
