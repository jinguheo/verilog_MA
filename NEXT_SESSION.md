# Next session note (2026-08-02)

- The legacy `dashboard/` static UI was removed; `my_dashboard/` is the sole UI.
- React dashboard: `http://127.0.0.1:5173/`
- Knowledge API: `http://127.0.0.1:8788/api/overview`
- Port 8787 had unrelated/conflicting listeners, so the project API intentionally uses port 8788.
- The API sends a CORS header for the Vite dashboard origin.
- User preference: always end server/dashboard-related responses with the web address.

## Dashboard state

- The left navigation has one `General RTL Pipeline` entry. Its internal pages are `Overview` and `단계별 Task`; the latter contains Requirements through Review as internal tabs.
- Sample Test 1, Sample Test 2, Knowledge DB, and Tool Comparison remain separate left-navigation entries.
- The overview hides the duplicate Knowledge DB summary and Verification Environment. The Task page also hides Verification Environment because each Task now has its own software-detail and tool-comparison guide.
- RTL Design includes plain-language explanations for CDC, lint, syntax/compile, elaboration, and synthesis, plus Verilator/Verible/Slang/Yosys comparisons.
- Each Task page has a tool guide that explains the listed software's purpose, strength, and difference from similar tools.

## UVM Test 2 status

- **Resolved (2026-08-02): full native build + regression now passes.** `samples/sample_test_2/uvm/run_verilator_uvm.ps1` builds `Vprim_fifo_sync_uvm_tb.exe` into `samples/sample_test_2/obj_uvm` and runs it; result is `UVM_ERROR: 0`, `UVM_FATAL: 0`, `[FIFO_SB] UVM FIFO PASS: 7 checked reads`, exit code 0.
- Three distinct Windows toolchain bugs had to be fixed in the script, all still relevant if this environment changes:
  1. `oss-cad-suite` bundles no GNU Make, so PATH resolved `make` to an unrelated legacy `C:\Windows\System32\make.exe` ("0 was unexpected at this time."). Fixed by shimming `mingw32-make.exe` as `make.exe` in `%TEMP%\veriolg-make-shim` and putting it first on PATH.
  2. This machine's installed MinGW-w64 g++ 16.1.0 mis-links `std::string`'s move constructor specifically under `-Os` (undefined reference at link time). Verilator's generated Makefile compiles the runtime + generated classes with `-Os` via `OPT_GLOBAL`/`OPT_FAST`/`OPT_SLOW`; the script now forces `-O2` for all three via `$env:MAKEFLAGS`.
  3. `oss-cad-suite\lib` ships its own older `libstdc++-6.dll`/`libgcc_s_seh-1.dll`/`libwinpthread-1.dll`. If those shadow the mingw64 runtime that actually built the exe, it fails at load with `STATUS_ENTRYPOINT_NOT_FOUND` (0xC0000139). Fixed by resolving `g++.exe`'s own bin dir and putting it first on PATH for both build and run.
- Re-run anytime with: `powershell -File samples\sample_test_2\uvm\run_verilator_uvm.ps1`. `-OutDirName <name>` is available if `obj_uvm` is ever locked by a stale process.

## Session 2026-08-08 — pending items closed

Per-sample evidence now lives in `samples/sample_test_2/RESULTS.md` and
`samples/sample_test_3/RESULTS.md`; the dashboard tables were rewritten from those runs
(the previous ones had gone stale — `verifLayers`/`verifGaps` in
`SampleTest2TabDetail.tsx` were defined but never rendered).

- **Sample Test 2.** Random and negative sequences were already written but had never been
  run; both pass (`UVM_ERROR: 0`, checked reads 7 → 23, reject bins 2/2). Fixed a
  reporting bug where two 1-bit comparisons summed to a self-determined 1-bit result and
  printed "0/2". Mutation run on the UVM side is now done too: mutant RTL gives 16
  UVM_ERRORs against 0 on golden, matching the formal MUTANT FAIL.
- **Sample Test 3.** DMA write port converted to AXI-style valid/ready with a write
  response; added backpressure, write-response-error, FIFO-overflow, and
  reset-during-traffic subtests plus a source/DMA stream scoreboard. Clock half-periods
  are runtime-settable and `-ClockSweep N` replays the regression at randomized ratios (7
  configurations pass). Two SymbiYosys proofs added under `formal/`, both `multiclock on`.
- **Sample Test 3 formal, second pass.** The `daq_status` induction counterexample was
  diagnosed, not left open: a `tick`/`p_tick` self-check in the harness shows the
  one-edge-history model is sound, and the counterexample trace contains a *single* clock
  edge with the violation sitting in the trace's arbitrary initial state. Root cause is
  the free-clock model — an induction trace of any depth may contain zero clock edges, so
  history-based properties get evaluated against unreachable states. It is spurious, and
  no depth increase fixes it. `formal/daq_status_prove.sby` reproduces it in one command.
- **There is now an unbounded proof.** `formal/daq_status_sync.sby` ties the three clocks
  together and closes by k-induction, using FIFO pointer invariants as helpers. Those
  helpers are `assert`ed (so they are proof obligations, not assumptions) and live only in
  the single-clock harness — the same lag bounds are false in the multiclock model and are
  deliberately absent from `daq_fifo_formal.sv`. **This proof says nothing about CDC**;
  that still rests on the bounded multiclock runs plus the UVM clock-ratio sweep.
- **Formal mutation now exists for Sample Test 3.** `mutants/daq_top_MUTANT.sv` carries two
  `ifdef`-selected defects; both proofs fail on the property that states the guarantee the
  mutant breaks. `run_formal.ps1 -Mutant` inverts the exit status, so a mutant PASS is
  reported as the failure it is.
- Formal runs are slow here: `daq_status` takes ~8 minutes at depth 40, and FIFO-proof
  step 50 took ~9 minutes, which is why depth 120 was abandoned. The single-clock proof
  runs in about a second, so iterate there first.

## Session 2026-08-08 (later) — Sample Test 3 RTL expansion

The dashboard had been overstating the design: it advertised 7 IP blocks while the RTL was
one file with two modules, no FSM, a write-only two-address register map, and a dead
`xor_crc` that nothing ever read. Both halves were addressed.

- **Dashboard corrected first**, then kept in step: Architecture now separates what exists
  from what is still blueprint, and the summary strip carries real numbers.
- **RTL expanded** to 344 lines (229 excluding comments): five-state DMA FSM, six-register
  file with a read path and per-bit W1C, real CRC-8 compared against a value the source
  appends on the eop beat, interrupt enable mask. Every cross-domain path is explicit —
  two-flop for single sticky bits, data+toggle handshake for the W1C mask, the CMD clear
  and `byte_count`. **The FSM encoding is deliberately not exposed in CSR**: a 3-bit state
  cannot cross coherently without its own handshake, so STATUS carries only `busy`.
- **UVM**: 9 subtests, 21 checks, `UVM_ERROR 0`, and all 7 clock-ratio configurations pass.
- **Formal**: all three proofs pass on the expanded RTL, including new FSM-transition and
  W1C properties in the unbounded single-clock run. Both mutants still fail as intended.
- **Formal found the same class of bug twice**, both times with UVM passing: a property
  written stronger than the design contract. The second one (enable low for exactly one
  cycle in S_XFER) was also present in the RTL's own `p_wvalid_held` SVA, which was fixed
  to match. When changing one, check the other — they are deliberately separate
  expressions of the same contract because slang cannot parse the SVA form.

## Session 2026-08-09 — Sample Test 4 phase 1 (packages, common, build gate)

`samples/sample_test_4/PLAN.md` is the agreed plan for a realistically scaled multi-channel
DAQ/DMA IP: 8 channels, AXI4-Lite CSR plus AXI4 masters, descriptor-based DMA, ~24 modules
in six phases. Sample Test 3 is not modified. Phase 1 of 6 is now done and verified;
evidence lives in `samples/sample_test_4/RESULTS.md`.

- **The prim-reuse decision is settled and proven, not just decided.** Nine of the eleven
  planned `rtl/common/` modules are reused unmodified from OpenTitan's `hw/ip/prim` and
  `hw/ip/prim_generic` (in `D:\MyWork\verilog\`, the same tree Sample Test 2 already
  depends on). `tb/prim_reuse_smoke.sv` instantiates every reused primitive at Sample Test
  4's actual widths and is part of the lint gate — if a later phase stops using one, the
  smoke test is where that drift would be caught. Only `skid_buffer.sv` (valid/ready
  pipeline stage) and `cnt_sat.sv` (saturating statistics counter) are genuinely new;
  OpenTitan has no equivalent for either (TileLink flow control, and `prim_count`'s
  hardened dual-counter design pays for tamper detection nothing here needs).
- **`rtl/pkg/axi_pkg.sv` and `rtl/pkg/daq_pkg.sv`** hold AXI4 encodings, the 128-bit
  descriptor struct, channel-state enum, error codes, and the full register map from the
  plan. Descriptor layout decided as 128-bit/4-word, not a wider metadata format. ECC scope
  decided as channel-FIFO payload only, not the descriptor path.
- **Lint gate passes across the parameter sweep**: `NUM_CH` ∈ {1,2,8} × `AXI_DW` ∈ {32,64},
  18 configurations, clean under `-Wall`. `scripts/run_lint.ps1`.
- **Block testbenches + mutation gate, 5/5 defects killed** after fixing two testbench bugs
  found while closing the gate (one equivalent-mutant dead end, one driver sampling ready_o
  a delta late that hid a real defect) — see RESULTS.md for the root-cause writeup.
  `scripts/run_block_tb.ps1`, `-Mutant <DEFINE>` for the mutation runs.
- **A fourth Windows toolchain bug** was found and fixed: `VERILATOR_ROOT` with backslashes
  breaks `verilator_includer` when it runs through `sh.exe` inside `make`, with a confusing
  `python3: can't open file` error. Fixed by using forward slashes throughout the phase-1
  scripts. Distinct from the three Sample Test 2 already documented.

## Session 2026-08-09 (later) — Sample Test 4 phase 2 (AXI4-Lite CSR)

Phase 2 of 6 is done and verified; evidence lives in `samples/sample_test_4/RESULTS.md`.

- **`rtl/csr/axil_slave.sv`**: generic AXI4-Lite-to-regbus bridge, independent of any
  register map. One outstanding transaction at a time; AW/W captured independently since a
  master may present them on different cycles; fixed write-over-read priority; `reg_error_i`
  maps to DECERR uniformly.
- **`rtl/csr/daq_csr.sv`**: the register file — global bank, `NumCh` per-channel banks, one
  shared address-decode block feeding both the read mux and write-commit so the two paths
  cannot drift apart.
- **Register-map correction**: the plan's global `IRQ_STATE` was originally W1C, mirroring
  `CH_IRQ_STATE`. Built that way it would have been a redundant, misleading second latch —
  clearing it wouldn't have deasserted anything while the per-channel cause was still
  pending. Changed to RO (live summary); `CH_IRQ_STATE` remains the actual W1C latch,
  unchanged from plan. Full rationale next to `AddrIrqState` in `daq_pkg.sv`.
- **Lint gate**: 30 configurations (5 tops × the same `NUM_CH`/`AXI_DW` sweep), clean.
- **Mutation, 5/5 killed**, after fixing **three** testbench bugs — all timing/coverage gaps
  in the drivers, none in the RTL. The big one: `awready`-style AXI ready signals are
  combinational and drop on the *same* edge they accept a transfer, so polling them one
  negedge later (as both phase-2 testbenches originally did) never observes the accept —
  and because `bready`/`rready` were already held high, the write's one-and-only `BVALID`
  silently drained while the driver was still stuck checking, then hung forever waiting for
  a second `BVALID` that would never come. `tb_axil_slave` timed out on its very first
  transaction. Fixed with the same posedge-monitor technique `tb_skid_buffer.sv`'s
  `offer_taken` already used correctly — nothing in phase 1 had exposed this because none of
  those testbenches drove a channel whose ready changes on the accept edge itself. Full
  writeup of all three fixes (this one plus two narrower mutant-driven gaps) in RESULTS.md.
- Same toolchain fixes as phase 1 (forward-slash `VERILATOR_ROOT`) carried over unchanged.

## Session 2026-08-26 — Sample Test 4 phase 3 (per-channel stream path) complete

Phase 3 of 6 (`pkt_align.sv`, `pkt_check.sv`, `chan_ctrl.sv`, `chan_top.sv`) is
done and verified; evidence lives in `samples/sample_test_4/RESULTS.md`.

- **Lint gate**: all 4 new tops clean across the 6-configuration sweep.
- **Block TBs pass, mutation 9/9 killed** (3 each for pkt_align/pkt_check/chan_ctrl).
- **`chan_top`'s block TB had a real bug to chase down**, but it was in the
  testbench's scoreboard, not the RTL: phase 2's corrupted-CRC packet was sent
  untracked (`track=1'b0`), while `pkt_check.sv`/`chan_ctrl.sv` both
  deliberately forward a packet's beats — including its own eop — before the
  CRC result is known (documented store-and-forward tradeoff). The untracked
  packet's bytes/count landing in the scoreboard's `got_*` totals anyway
  permanently desynced `got_pkt_count` from `exp_pkt_count`, so later
  `while (got_pkt_count < exp_pkt_count)` waits returned early and threw off
  every packet after it. Fixed by tracking that packet too. Debug tracing
  code added while chasing this was removed once fixed.
- **`chan_ctrl.sv` itself had three real bugs fixed this session**, all in the
  `ChIdle` drain-and-discard path (see the file's own header) — the
  `chan_ctrl` mutants were re-run against the post-fix RTL specifically
  because of this, not assumed still-valid from before.
- **A fifth Windows toolchain issue**: a long-running sandboxed PowerShell
  session accumulates memory pressure over many Verilator/g++ builds,
  eventually hitting `cc1plus.exe: out of memory` despite adequate free RAM.
  Workaround: spawn a fresh one-off `powershell.exe` process per build/run
  instead of reusing one long-lived session.

## Session 2026-08-26 (later) — Sample Test 4 phase 4 started (dma_sched)

`rtl/dma/dma_sched.sv` delivered and verified: packet-granularity round-robin
arbiter across all `NumCh` channels' gated beat streams (each channel's
`chan_top` output), merging them into the one stream the not-yet-built
`axi_wr_master` will write. First use of `prim_arbiter_tree` in this project.
Lint clean (6-config sweep), block TB pass (6 phases + 5 extra `-Seed` runs),
mutation 3/3 killed. Evidence in `samples/sample_test_4/RESULTS.md`'s "Phase
4" section.

- **Arbitrates only at packet boundaries, not per beat** - a channel's sop
  beat wins the shared output and every other channel is excluded from
  arbitration entirely (not just deprioritised) until that same channel's
  own eop beat is accepted. Beat-level round-robin was the obvious first
  design and was rejected before being built: it would let the winner
  change mid-packet, interleaving two channels' bytes into what downstream
  (axi_wr_master/wr_track's outstanding-write bookkeeping, scoped to "the
  packet currently being written") believes is one contiguous transfer.
- **A second stale-mutant-file problem found and fixed**, distinct from
  phase 3's chan_top TB bug: `mutants/chan_ctrl_MUTANT.sv` had been copied
  from `chan_ctrl.sv` before the `idle_drain`/`drain_pending_q` feature
  existed. All three `MUT_CTRL_*` mutants were reported "killed" in the
  phase-3 close-out, but only because every run also failed an unrelated
  idle-drain check the stale copy didn't have at all - not proof any of the
  three named defects were actually being caught. Regenerated the mutant
  file from current golden RTL with the same three defects re-applied;
  each now fails only its own named check.
- `dma_sched.sv` needed its own `NumCh==1` guard: `prim_arbiter_tree`'s
  `idx_o` is `[$clog2(N)-1:0]` with no `N==1` guard, so at `N=1` it is
  genuinely zero-width - a real mismatch against this module's own
  always-≥1-bit `ChIdxW` convention, caught immediately by the lint sweep.

## Session 2026-08-26 (later still) — Sample Test 4 phase 4: desc_fetch.sv

`rtl/dma/desc_fetch.sv` delivered and verified: one shared descriptor
ring-walk engine for all `NumCh` channels, sitting between `dma_sched` and
the not-yet-built `axi_rd_master` (per PLAN.md's diagram - it issues a small
request/response protocol, not raw AXI AR/R). Second use of
`prim_arbiter_tree` in this project, arbitrating which channel gets the one
shared fetch path next. Lint clean (6-config sweep), block TB pass (6
phases), mutation 3/3 killed (`MUT_DESC_NOLINK`, `MUT_DESC_NOHALT`,
`MUT_DESC_NOCHECK`). Evidence in `samples/sample_test_4/RESULTS.md`.

- **A real same-cycle RTL race, caught immediately by the block TB**: the
  first version computed `need_fetch` from `ch_enable_i` alone. On the exact
  cycle `ch_desc_go_i` pulses, `ch_enable_i` is already high but `cur_ptr_q`
  has not yet been loaded with the new base address (that load commits on
  this same edge, not before it) - so every single `go` issued a bogus fetch
  to address zero, one cycle too early. Fixed by also gating `need_fetch` on
  `~ch_desc_go_i`.
- **A valid/ready handshake bug in the TB's own memory-model stub** (the same
  class of mistake phase 2's AXI-style testbenches made): the stub asserted
  a response beat's `valid`, waited one negedge, then checked `ready`'s
  level - but `rd_resp_ready_o` drops the same edge it accepts the fetch's
  *last* beat, so a level check one negedge later routinely missed it and
  spun in `while (!ready)`, only "recovering" once some later, unrelated
  fetch happened to drive `ready` high again - corrupting whatever came next
  in the meantime. Fixed with the project's standard posedge-monitor
  acceptance pattern (`resp_taken = valid & ready`, latched at the same edge
  the DUT itself uses to decide acceptance).

**Next up**: the rest of phase 4 (`axi_rd_master.sv`, `axi_wr_master.sv`,
`wr_track.sv`), per `samples/sample_test_4/PHASE_3_6_PLAN.md`. Whether to run
graphify over this repository (so Sample Test 2/3/4 assets become
searchable) is still open.

## Git state

- Pushed to `https://github.com/jinguheo/verilog_MA.git`, branch `master`.
- Latest pushed commit: `b01bbee` (`Add Sample Test 4 (phases 1-2), close out Sample Test 2/3, dashboard flowcharts`).
- `docs/session_notes/` and `third_party/uvm-core/` are intentionally untracked local directories; generated UVM output/logs are ignored.

## Storage constraint

- C: drive has little free space. Do not install large tools, download dependencies, or place build caches/artifacts on C: unless the user explicitly approves it. Prefer the `D:\MyWork\Veriolg_MA` workspace or a user-designated non-C: location.
