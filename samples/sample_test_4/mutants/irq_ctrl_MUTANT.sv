// Mutant copy of rtl/irq/irq_ctrl.sv. See mutants/skid_buffer_MUTANT.sv for
// why these exist and what -Mutant does with them.
//
//   MUT_IRQ_NOEDGE     fetch_err_i/wr_err_i feed ch_cause_o[IrqCauseErr]
//                       as a level, not a rising-edge pulse - once the
//                       underlying error condition is sticky, the cause bit
//                       never actually goes low, so a W1C clear would be
//                       re-set the very next cycle.
//   MUT_IRQ_WRONGCH    xfer_done_i always pulses channel 0's
//                       ch_cause_o[IrqCauseDone], ignoring xfer_done_ch_i.
//   MUT_IRQ_BUSYWRONG   ch_busy_o is stream_busy_i alone - a channel
//                       holding a validated descriptor between packets
//                       incorrectly reads as idle.
//
// Per-channel and global interrupt/status aggregation - the reconciliation
// layer PLAN.md's own module inventory calls for, sitting between three
// independent axi_clk-domain status sources (chan_top's stream-level FSM,
// desc_fetch's descriptor-fetch errors, wr_track's payload-write errors/
// completions) and daq_csr's already-built ch_busy_i/ch_err_i/ch_cause_i
// ports.
//
// Why this module exists instead of wiring the three sources straight into
// daq_csr
// -----------------------------------------------------------------------
// daq_csr.sv (phase 2, already built/verified/committed) already does its
// own summary work - CH_IRQ_STATE's W1C latch, IRQ_STATE's live per-channel
// OR-with-enable summary, the final irq_o line. This module does NOT
// duplicate any of that (PHASE_3_6_PLAN.md flags exactly this overlap risk
// for irq_ctrl.sv). Its job stops one layer earlier: turning three sources
// that disagree about vocabulary and signal shape into the single
// per-channel busy/err/cause triple daq_csr's interface was built to
// consume - literally nothing more.
//
// "Channel busy" is broader than "stream busy"
// -----------------------------------------------------------------------
// chan_top's own ch_busy_o only reflects its FSM's ChRunning/ChDraining
// states - a channel between packets, holding a validated descriptor and
// waiting for the next one to start streaming, reads as idle there. Software
// polling GLOBAL_STATUS/CH_STATUS needs the wider view: ch_busy_o here is
// stream-busy OR "desc_fetch is holding a validated descriptor for this
// channel" (ch_desc_valid_i) - busy means "there is work assigned to this
// channel right now," not just "bytes are moving this exact cycle."
//
// ch_cause_i[IrqCauseDone] means the DOCUMENTED thing, not chan_ctrl's own
// per-packet completion
// -----------------------------------------------------------------------
// daq_pkg.sv's own comment on IrqCauseDone says "descriptor completed" - a
// DMA-level event. chan_ctrl.sv's ch_cause_o[IrqCauseDone] (built in phase 3,
// before the DMA engine existed) actually fires on stream-level packet
// completion, which is not the same event and predates a payload write even
// being attempted. This module does not use chan_top's Done bit at all:
// ch_cause_o[IrqCauseDone] here is driven from wr_track's xfer_done_i/
// xfer_done_ch_i - the descriptor's payload write has actually finished (or
// at least, per wr_track's own documented gap, been attempted - see its
// header on why a write error does not currently suppress this).
// chan_ctrl's own Err/Crc/FifoOvf cause bits are reused unchanged: those
// really are stream-level events with nowhere else to come from.
//
// Level-to-pulse conversion for desc_fetch/wr_track's error latches
// -----------------------------------------------------------------------
// desc_fetch_err_i/wr_err_i are STICKY levels in their own modules (cleared
// only by ch_abort_i), not one-shot pulses - correct for CH_STATUS's own
// err bit (ch_err_o here, a straight OR, stays sticky the same way), but
// wrong for feeding directly into ch_cause_o[IrqCauseErr]: daq_csr's
// CH_IRQ_STATE is W1C, applying `| ch_cause_i[c]` every single cycle
// (see daq_csr.sv's own comment on why - hardware must never lose a race
// against a same-cycle software clear). Feeding a STICKY level in there
// would mean the bit could never actually be cleared by software while the
// underlying error condition persists - it would be re-set the very cycle
// after a W1C write took effect. A rising-edge detector turns each sticky
// level into the one-shot pulse CH_IRQ_STATE's write-commit logic actually
// expects, exactly once per new error, regardless of how long the
// underlying condition remains asserted afterward.

module irq_ctrl
  import daq_pkg::*;
(
  input  logic                      clk_i,
  input  logic                       rst_ni,

  // from chan_top, per channel - already axi_clk domain, no CDC needed
  input  logic [NumCh-1:0]             stream_busy_i,
  input  logic [NumCh-1:0]             stream_err_i,
  input  logic [NumIrqCause-1:0]       stream_cause_i [NumCh],

  // from desc_fetch, per channel
  input  logic [NumCh-1:0]             desc_valid_i,
  input  logic [NumCh-1:0]             fetch_err_i,

  // from wr_track, per channel
  input  logic [NumCh-1:0]             wr_err_i,
  input  logic                          xfer_done_i,
  input  logic [ChIdxW-1:0]             xfer_done_ch_i,

  // to daq_csr
  output logic [NumCh-1:0]              ch_busy_o,
  output logic [NumCh-1:0]              ch_err_o,
  output logic [NumIrqCause-1:0]        ch_cause_o [NumCh],
  output logic                           dma_busy_o
);

`ifdef MUT_IRQ_BUSYWRONG
  assign ch_busy_o  = stream_busy_i;
`else
  assign ch_busy_o  = stream_busy_i | desc_valid_i;
`endif
  assign ch_err_o   = stream_err_i | fetch_err_i | wr_err_i;
  assign dma_busy_o = |ch_busy_o;

  // ---- rising-edge detection: sticky error levels -> one-shot pulses -------

  logic [NumCh-1:0] fetch_err_q, wr_err_q;
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      fetch_err_q <= '0;
      wr_err_q    <= '0;
    end else begin
      fetch_err_q <= fetch_err_i;
      wr_err_q    <= wr_err_i;
    end
  end

  logic [NumCh-1:0] fetch_err_rise, wr_err_rise;
`ifdef MUT_IRQ_NOEDGE
  assign fetch_err_rise = fetch_err_i;
  assign wr_err_rise    = wr_err_i;
`else
  assign fetch_err_rise = fetch_err_i & ~fetch_err_q;
  assign wr_err_rise    = wr_err_i & ~wr_err_q;
`endif

  // ---- xfer_done_i/xfer_done_ch_i -> per-channel one-hot pulse -------------

  logic [NumCh-1:0] xfer_done_pulse;
`ifdef MUT_IRQ_WRONGCH
  always_comb begin
    xfer_done_pulse = '0;
    if (xfer_done_i) xfer_done_pulse[0] = 1'b1;
  end
`else
  always_comb begin
    xfer_done_pulse = '0;
    if (xfer_done_i) xfer_done_pulse[xfer_done_ch_i] = 1'b1;
  end
`endif

  // ---- per-channel cause vector ---------------------------------------------

  always_comb begin
    for (int unsigned c = 0; c < NumCh; c++) begin
      ch_cause_o[c][IrqCauseDone]    = xfer_done_pulse[c];
      ch_cause_o[c][IrqCauseErr]     = stream_cause_i[c][IrqCauseErr] |
                                        fetch_err_rise[c] | wr_err_rise[c];
      ch_cause_o[c][IrqCauseCrc]     = stream_cause_i[c][IrqCauseCrc];
      ch_cause_o[c][IrqCauseFifoOvf] = stream_cause_i[c][IrqCauseFifoOvf];
    end
  end

endmodule
