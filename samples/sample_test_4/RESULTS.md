# Sample Test 4 — Results

Phases 1-2. See [PLAN.md](PLAN.md) for the full six-phase plan; phases 3-6 are
not started.

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

## Not done yet

Phases 3-6 (per-channel stream path, DMA engine, IRQ/perf/top, integration
UVM + formal + regression) are unstarted. `rtl/dma`, `rtl/stream`,
`rtl/irq`, `rtl/stat` do not exist yet. `daq_csr.sv`'s per-channel status,
counter, and cause inputs are currently driven directly by its block
testbench; nothing downstream consumes `ch_enable_o`/`ch_desc_base_o`/
`ch_desc_go_o` yet.
