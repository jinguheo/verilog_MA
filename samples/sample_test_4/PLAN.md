# Sample Test 4 — Multi-channel DAQ/DMA subsystem (plan only)

Written 2026-08-08. **No RTL exists yet.** This file is the agreed plan; implementation
starts next session.

## Why this exists

Sample Test 3 is verified but small — 229 lines of RTL, two modules, one clock-domain
pair, a single integration testbench. It is a teaching example, not a rehearsal for a real
IP. Sample Test 4 is the rehearsal: a realistically structured mid-size IP where the
*workflow* (file lists, block-level vs integration verification, regression management,
parameter sweeps) matters as much as the logic.

Sample Test 3 stays untouched as a working reference.

### On scale, honestly

"Tens of thousands of lines" is a repository figure, not a module figure. OpenTitan is
roughly 500k lines of RTL across hundreds of IPs; an individual module is usually
200–800 lines. A real AXI DMA controller IP is about 3k–10k lines across 15–40 modules.

The estimate below lands near **5k lines of RTL plus a comparable amount of DV**, which is
a genuine mid-size IP deliverable. Padding beyond that would add line count without
adding anything to practice on, so the target is structure and interface count, not
volume.

## Knowledge DB — checked 2026-08-08, and it changes this plan

The registered knowledge sources all point at `D:\MyWork\verilog\`, a different workspace
from this repository. Nothing from `Veriolg_MA` is indexed: `graph.json` is 80.5 MB but
was last written 2026-05-25 and contains no match for `Veriolg_MA`, `sample_test_2`,
`sample_test_3`, `daq_top` or `prim_fifo_sync_uvm`. The dashboard showing "6/6 available"
means those paths exist, not that this repository is indexed.

What the sources *do* contain is directly useful:

| Source | Contents |
| --- | --- |
| `dbs/opentitan` | 3969 RTL files. `hw/ip/prim` alone is 257 files; there is a real `hw/ip/dma` (40 files), plus `tlul`, `spi_host`, `usbdev`, `aes`, `sram_ctrl` |
| `dbs/ibex` | 646 files, RISC-V core |
| `dbs/RTLLM` | 390 files, benchmark designs |
| `dbs/sv-tests` | 1031 files, SystemVerilog compliance suite |
| `graphify-out` | Architecture graph over the above, plus a 1.4 MB report |
| `docs`, embedding index | Document knowledge and semantic search over the same corpus |

**This invalidates the `common/` section below as originally written.** Writing
`sync_2ff`, `async_fifo`, `arb_rr`, `ecc_secded` and the CDC primitives from scratch is
not what real IP development looks like when a verified primitive library is already
available — and Sample Test 2 already uses `prim_fifo_sync` from this exact tree.

Revised approach, to settle at the start of the next session:

- **Build on `prim_*` rather than reimplementing.** `prim_fifo_async`, `prim_fifo_sync`,
  `prim_arbiter_rr`, `prim_flop_2sync`, `prim_sync_reqack`, `prim_packer`,
  `prim_secded_*`, `prim_count` cover most of the planned `common/` layer. Reusing them
  also means the CDC and FIFO properties already proved in Sample Test 2 carry over.
- **Study `hw/ip/dma` before designing.** There is a real, verified DMA controller in the
  corpus. The rehearsal is much more valuable if Sample Test 4 is deliberately shaped
  against it — same problem, own implementation — rather than invented in isolation.
- **Decide what is genuinely new.** The parts worth writing from scratch are the
  multi-channel scheduler, the stream packing path, the descriptor engine and the AXI
  masters. OpenTitan is TileLink-based, so the AXI layer is not something that can be
  lifted from it.
- **Index this repository.** Running graphify over `Veriolg_MA` would make the Sample Test
  2/3 assets searchable while building Sample Test 4. Not done yet.

## Architecture

Eight independent acquisition channels. Each channel receives an 8-bit source stream on
its **own clock**, packs it into the AXI data width, checks CRC-32, buffers it, and hands
it to a shared DMA engine that writes to memory over AXI4 using descriptors from a ring
in memory. Software configures everything over AXI4-Lite on a third clock.

```
reg_clk    AXI4-Lite ──> axil_slave ──> daq_csr ──┐
                                                   │ (CDC)
src_clk[0] ─> chan_top[0] ─┐                       v
src_clk[1] ─> chan_top[1] ─┤                  dma_sched (RR arbiter)
   ...                     ├──> async FIFOs ──>    │
src_clk[7] ─> chan_top[7] ─┘                       ├─> desc_fetch ─> axi_rd_master ─> AXI4
                                                   └─> axi_wr_master ──────────────> AXI4
                                                              │
                              perf_cnt, irq_ctrl <────────────┘
```

### Clock domains

| Domain | Contents |
| --- | --- |
| `reg_clk` | AXI4-Lite slave, register file |
| `axi_clk` | DMA scheduler, descriptor fetch, both AXI masters, counters, interrupts |
| `src_clk[0..7]` | Per-channel source stream ingress, one independent clock each |

Ten clock domains total. Every crossing goes through `common/`: `reset_sync` per domain,
`sync_2ff` for single sticky bits, `cdc_pulse` for events, `cdc_data_handshake` for
multi-bit payloads, `async_fifo` for the streams. **No ad-hoc crossings** — that rule is
what makes the CDC verification tractable later.

### Parameters

| Parameter | Default | Notes |
| --- | --- | --- |
| `NUM_CH` | 8 | channels, instantiated with `generate` |
| `AXI_DW` | 64 | DMA data width |
| `AXI_AW` | 32 | address width |
| `AXI_IDW` | 4 | write/read ID width, sets outstanding capacity |
| `AXIL_DW` / `AXIL_AW` | 32 / 16 | register interface |
| `CH_FIFO_DEPTH` | 32 | per-channel async FIFO |
| `MAX_BURST` | 16 | beats per AXI burst before splitting |

Elaboration must pass for at least three configurations (`NUM_CH` 1/2/8, `AXI_DW` 32/64) —
parameter sweeps are part of the build gate, not an afterthought.

## Module inventory

Estimates are for guidance; what matters is that each module does one job.

### `rtl/pkg/`
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `axi_pkg.sv` | 120 | AXI4 and AXI4-Lite channel structs, burst/response enums |
| `daq_pkg.sv` | 180 | Parameters, descriptor struct, channel state enum, register map constants, error codes |

### `rtl/common/`
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `reset_sync.sv` | 40 | Async assert, synchronous deassert, one per clock domain |
| `sync_2ff.sv` | 40 | Single-bit two-flop synchronizer |
| `cdc_pulse.sv` | 60 | Toggle-based event crossing |
| `cdc_data_handshake.sv` | 90 | Multi-bit data + toggle handshake |
| `async_fifo.sv` | 140 | Parameterized Gray-pointer FIFO with almost-full/empty |
| `sync_fifo.sv` | 110 | Same-clock FIFO |
| `skid_buffer.sv` | 70 | valid/ready pipeline stage for AXI timing |
| `arb_rr.sv` | 90 | Round-robin arbiter with grant masking |
| `crc32.sv` | 90 | CRC-32 over `AXI_DW` bits with byte enables |
| `ecc_secded.sv` | 130 | 32-bit SEC-DED encode/decode |
| `cnt_sat.sv` | 40 | Saturating counter for statistics |

### `rtl/csr/`
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `axil_slave.sv` | 200 | Full AW/W/B/AR/R handshake, byte strobes, DECERR on unmapped addresses |
| `daq_csr.sv` | 450 | Global bank plus eight per-channel banks, W1C interrupt state, enable masks |

### `rtl/stream/`
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `pkt_align.sv` | 220 | 8-bit stream to `AXI_DW` packing, byte enables, partial last beat |
| `pkt_check.sv` | 150 | CRC-32 verification and length checking |
| `chan_ctrl.sv` | 260 | Per-channel FSM: idle, armed, running, draining, error |
| `chan_top.sv` | 120 | Per-channel wrapper tying FIFO, align, check and control together |

### `rtl/dma/`
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `desc_fetch.sv` | 280 | Descriptor ring walk, validation (alignment, length, range) |
| `axi_rd_master.sv` | 300 | AR/R channels, outstanding reads, 4 KB boundary splitting |
| `axi_wr_master.sv` | 340 | AW/W/B channels, INCR bursts, `WLAST`, 4 KB splitting |
| `wr_track.sv` | 130 | Outstanding response tracking and error aggregation |
| `dma_sched.sv` | 200 | Channel arbitration and credit management |

### `rtl/irq/`, `rtl/stat/`, top
| Module | ~Lines | Responsibility |
| --- | --- | --- |
| `irq_ctrl.sv` | 160 | Per-channel and global interrupt aggregation |
| `perf_cnt.sv` | 180 | Byte, packet, error and stall-cycle counters per channel |
| `daq_subsystem.sv` | 400 | Top-level wiring with all CDC instantiated explicitly |

**Total ≈ 4,900 lines of RTL across 24 modules.**

## Register map (sketch)

Global bank at `0x000`:

| Offset | Name | Access | Contents |
| --- | --- | --- | --- |
| `0x000` | `ID` | RO | Constant identifier |
| `0x004` | `VERSION` | RO | Major/minor, `NUM_CH`, `AXI_DW` readback |
| `0x008` | `GLOBAL_CTRL` | RW | Global enable, soft reset |
| `0x00C` | `GLOBAL_STATUS` | RO | Per-channel busy bitmap, DMA state |
| `0x010` | `IRQ_STATE` | W1C | Per-channel interrupt summary |
| `0x014` | `IRQ_ENABLE` | RW | Summary mask |
| `0x018` | `ERR_INJECT` | RW | Fault-injection hooks, isolated behind an explicit bit |
| `0x01C` | `AXI_CFG` | RW | Max burst length, outstanding limit |

Per channel at `0x100 + ch*0x40`: `CH_CTRL`, `CH_STATUS`, `CH_DESC_BASE`,
`CH_DESC_CTRL`, `CH_IRQ_STATE` (W1C), `CH_IRQ_ENABLE`, `CH_BYTE_CNT`, `CH_PKT_CNT`,
`CH_ERR_CNT`, `CH_STALL_CNT`, `CH_CRC_STATUS`, `CH_ECC_STATUS`.

As in Sample Test 3, raw FSM encodings are **not** exposed directly — anything multi-bit
that crosses a clock boundary goes through a handshake or is not exposed at all.

## Implementation phases

Each phase ends with Verilator lint and elaboration clean across the parameter sweep.
Nothing moves to the next phase with a broken build.

| Phase | Content | Gate | Status |
| --- | --- | --- | --- |
| 1 | `pkg/` and `common/` plus the file list and build script | Lint clean; block TBs for FIFO, arbiter, CRC, ECC, CDC primitives | **Done** — see RESULTS.md |
| 2 | `axil_slave.sv`, `daq_csr.sv` | AXI4-Lite protocol TB, register readback/W1C test | **Done** — see RESULTS.md |
| 3 | `pkt_align.sv`, `pkt_check.sv`, `chan_ctrl.sv`, `chan_top.sv` | Per-block TBs, byte-enable and partial-beat coverage | Not started |
| 4 | `desc_fetch.sv`, both AXI masters, `wr_track.sv`, `dma_sched.sv` | AXI protocol checks, 4 KB split test, arbiter fairness | Not started |
| 5 | `irq_ctrl.sv`, `perf_cnt.sv`, `daq_subsystem.sv` | Full elaboration, CDC audit | Not started |
| 6 | Integration UVM, formal per block, regression script | End-to-end scoreboard, formal proofs, mutation | Not started |

## Verification strategy

The important structural change from Sample Test 3: **block-level and integration are
separate levels.** Sample Test 3 had only an integration test, which is why a single
testbench could cover everything.

- **Block level.** Each `common/` primitive and each major block gets its own testbench
  and, where the property set is small enough, its own formal harness. Bugs are cheaper to
  find here and the proofs actually close.
- **Integration.** One UVM environment with an AXI4-Lite master agent, eight source stream
  agents, an AXI4 slave memory model with configurable latency and `SLVERR`/`DECERR`
  injection, a reference model and a scoreboard.
- **Regression.** Dozens of tests, not one. Needs a test list, seed control and a summary
  report — this is a large part of what is being rehearsed.
- **Formal.** Per block, following what was learned in Sample Test 3: single-clock
  abstractions close by induction, multiclock runs stay bounded, and every property set
  gets a mutation run to prove it is not vacuous.
- **Parameter sweeps.** Elaborate and regress at more than one `NUM_CH` and `AXI_DW`.

## Decisions already made

- New directory `samples/sample_test_4/`; Sample Test 3 is not modified.
- `reset_sync` is in `common/` from the start and used in every domain. Sample Test 3
  drives `rst_n` directly into three domains with no per-domain deassertion
  synchronizer — that gap is recorded there and is not repeated here.
- Channels are instantiated with `generate`, so line count does not scale with `NUM_CH`.
- Descriptor-based DMA, not a single enable bit — this is what makes the FSM non-trivial.
- Round-robin arbitration across channels, which is where genuine mux and fairness
  properties come from.

## Decisions settled 2026-08-09 (see RESULTS.md for evidence)

- **Prim reuse**: nine of eleven `common/` modules reused unmodified from OpenTitan
  `hw/ip/prim` and `hw/ip/prim_generic`; only `skid_buffer.sv` and `cnt_sat.sv` are new.
  Proven by `tb/prim_reuse_smoke.sv`, part of the lint gate, not just asserted here.
- **Descriptor layout**: 128-bit, four 32-bit words (address, length, control, next
  pointer) — `daq_pkg::desc_t`. A wider per-packet-metadata format was not chosen; it can
  be added later as a second descriptor flavour without changing the ring walk.
- **ECC scope**: channel FIFO payload only, not the descriptor path. The descriptor path is
  protected by `daq_pkg::desc_check()` plus the AXI response instead.

## Open questions for next session

- Whether the AXI read master is needed for anything beyond descriptor fetch — deferred to
  phase 4, once `desc_fetch.sv` exists to make it concrete.
- Whether to run graphify over this repository so Sample Test 2/3/4 assets become
  searchable while building the remaining phases.
