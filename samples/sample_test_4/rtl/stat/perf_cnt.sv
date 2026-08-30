// Per-channel byte/packet/error/stall statistics counters, reusing
// rtl/common/cnt_sat.sv (phase 1) rather than hand-rolling five counters
// per channel from scratch.
//
// Tap point: the channel's own gated beat stream, before arbitration
// -----------------------------------------------------------------------
// beat_valid_i/beat_ready_i/beat_strb_i/beat_eop_i here are each channel's
// chan_top output - the exact same signals dma_sched consumes on its own
// ch_valid_i/ch_ready_o/ch_data_i/ch_strb_i/ch_eop_i ports (daq_subsystem.sv
// fans them out to both). This measures "how much has this channel itself
// moved," independent of whether dma_sched happened to be arbitrating it in
// any given cycle - a channel is not "stalled" by definition just because
// another channel currently holds the shared write path; it is stalled only
// when IT has a beat ready and IT is not being accepted. Measuring after
// dma_sched's own mux would conflate "this channel is backed up" with "some
// other channel is using the shared resource," which is not the same fault.
//
// CH_ERR_CNT vs CH_CRC_STATUS - two counters, not one register read two ways
// -----------------------------------------------------------------------
// Neither daq_pkg.sv nor PLAN.md's register-map sketch says more than the
// two names. Read here as: CH_ERR_CNT counts every error-class cause this
// channel has raised (IrqCauseErr | IrqCauseCrc | IrqCauseFifoOvf, taken
// from irq_ctrl's already-computed per-channel cause vector rather than
// re-deriving the same edge detection a second time), while CH_CRC_STATUS
// narrows that same stream to CRC-32 mismatches specifically - a
// specialization of the general counter, not a duplicate of it. Both are
// deliberately event counts, not sticky status bits, for the same reason
// cnt_sat.sv itself gives (a saturating counter says something a single bit
// cannot: how many times, not just whether).
//
// CH_ECC_STATUS is wired to a constant zero, not a counter, because no ECC
// hardware exists anywhere in this design yet - the channel FIFO
// (prim_fifo_async, chan_top.sv) carries no SECDED encoding, so
// ErrEccUncorr is unreachable by construction. Same treatment chan_ctrl.sv's
// own header already gives ch_cause_o[IrqCauseFifoOvf]: wired to a fixed
// value rather than omitted, so daq_csr's register map does not need a
// feature-not-implemented special case.

module perf_cnt
  import daq_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,

  input  logic [NumCh-1:0]        ch_abort_i,

  // tap point: each channel's own gated beat stream (chan_top's output,
  // fanned out to dma_sched too - see header)
  input  logic [NumCh-1:0]          beat_valid_i,
  input  logic [NumCh-1:0]          beat_ready_i,
  input  logic [AxiBw-1:0]          beat_strb_i [NumCh],
  input  logic [NumCh-1:0]          beat_eop_i,

  // per-channel cause vector, from irq_ctrl - reused rather than
  // re-detecting the same error edges a second time
  input  logic [NumIrqCause-1:0]    ch_cause_i [NumCh],

  // to daq_csr
  output logic [31:0]               ch_byte_cnt_o   [NumCh],
  output logic [31:0]               ch_pkt_cnt_o    [NumCh],
  output logic [31:0]               ch_err_cnt_o    [NumCh],
  output logic [31:0]               ch_stall_cnt_o  [NumCh],
  output logic [31:0]               ch_crc_status_o [NumCh],
  output logic [31:0]               ch_ecc_status_o [NumCh]
);

  localparam int unsigned ByteIncrW = $clog2(AxiBw + 1);

  // ECC hardware does not exist yet - see header.
  assign ch_ecc_status_o = '{default: 32'h0};

  for (genvar c = 0; c < NumCh; c++) begin : gen_ch

    logic accept, stall, err_cause, crc_cause;
    assign accept    = beat_valid_i[c] & beat_ready_i[c];
    assign stall     = beat_valid_i[c] & ~beat_ready_i[c];
    assign crc_cause = ch_cause_i[c][IrqCauseCrc];
    assign err_cause = ch_cause_i[c][IrqCauseErr] | ch_cause_i[c][IrqCauseCrc] |
                        ch_cause_i[c][IrqCauseFifoOvf];

    // saturated_o is left unconnected on every instance below: nothing in
    // this design reads it back (the 32-bit registers themselves are wide
    // enough that saturation is not an expected operating condition, only a
    // safety backstop against a wrapped, misleading count - see cnt_sat.sv's
    // own header).
    /* verilator lint_off PINCONNECTEMPTY */
    cnt_sat #(.Width(32), .IncrW(ByteIncrW)) u_byte_cnt (
      .clk_i, .rst_ni,
      .clear_i    (ch_abort_i[c]),
      .incr_en_i  (accept),
      .incr_i     (daq_pkg::popcount(beat_strb_i[c])),
      .cnt_o      (ch_byte_cnt_o[c]),
      .saturated_o()
    );

    cnt_sat #(.Width(32), .IncrW(1)) u_pkt_cnt (
      .clk_i, .rst_ni,
      .clear_i    (ch_abort_i[c]),
      .incr_en_i  (accept & beat_eop_i[c]),
      .incr_i     (1'b1),
      .cnt_o      (ch_pkt_cnt_o[c]),
      .saturated_o()
    );

    cnt_sat #(.Width(32), .IncrW(1)) u_err_cnt (
      .clk_i, .rst_ni,
      .clear_i    (ch_abort_i[c]),
      .incr_en_i  (err_cause),
      .incr_i     (1'b1),
      .cnt_o      (ch_err_cnt_o[c]),
      .saturated_o()
    );

    cnt_sat #(.Width(32), .IncrW(1)) u_stall_cnt (
      .clk_i, .rst_ni,
      .clear_i    (ch_abort_i[c]),
      .incr_en_i  (stall),
      .incr_i     (1'b1),
      .cnt_o      (ch_stall_cnt_o[c]),
      .saturated_o()
    );

    cnt_sat #(.Width(32), .IncrW(1)) u_crc_status (
      .clk_i, .rst_ni,
      .clear_i    (ch_abort_i[c]),
      .incr_en_i  (crc_cause),
      .incr_i     (1'b1),
      .cnt_o      (ch_crc_status_o[c]),
      .saturated_o()
    );
    /* verilator lint_on PINCONNECTEMPTY */

  end

endmodule
