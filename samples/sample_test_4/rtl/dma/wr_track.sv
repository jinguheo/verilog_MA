// Per-channel write completion tracking and error aggregation, sitting
// downstream of axi_wr_master (per PLAN.md's architecture: dma_sched ->
// axi_wr_master -> AXI4, with axi_wr_master's own per-burst completion
// events landing here rather than going back to desc_fetch directly).
//
// Why this is a separate module from axi_wr_master
// -----------------------------------------------------------------------
// axi_wr_master already reduces every completed AXI write burst to a small
// event (burst_done_valid_o/ch_o/err_o/last_o - see its own header). What
// that event MEANS at the channel level - "this channel's whole transfer is
// now finished, tell desc_fetch to move to the next descriptor" and "did
// any burst along the way error, and how should that show up in the
// register map" - is deliberately kept out of axi_wr_master itself, the
// same protocol/semantics split desc_fetch.sv's header already draws
// against axi_rd_master. Because axi_wr_master is single-outstanding
// (never more than one burst in flight anywhere in the design), this
// module's own bookkeeping stays trivial - a straight per-channel latch,
// not a scoreboard - but the separation is still worth keeping: a future
// change to axi_wr_master's own outstanding depth would not need to touch
// how completion/error status is derived, and vice versa.
//
// A write error does not halt the channel's ring walk - documented gap
// -----------------------------------------------------------------------
// xfer_done_o fires whenever burst_done_last_i does, regardless of
// burst_done_err_i - desc_fetch.sv's own xfer_done_i input has no separate
// "and it failed" qualifier, so as built today a channel whose payload
// write actually failed still advances to its next descriptor exactly as
// if it had succeeded; only ch_err_o/ch_err_code_o (read out through
// daq_csr once daq_subsystem exists, phase 5) tells software a write ever
// errored. Making a write error halt the ring the way a descriptor-fetch
// error already does (see desc_fetch.sv's halted_q) would need a new input
// on desc_fetch itself, which is out of scope for this phase - desc_fetch
// is already built, verified, and committed. Left as an explicit gap
// rather than worked around here, the same way chan_ctrl.sv's own header
// flags what ch_abort_i mid-packet leaves unresolved for phase 4 to pick up
// later.
//
// ch_err_o is sticky, cleared only by ch_abort_i - the same convention
// desc_fetch.sv's own err_q/halted_q already use, so a software abort
// clears write-side and fetch-side error latches identically.

module wr_track
  import daq_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,

  input  logic [NumCh-1:0]        ch_abort_i,

  // per-burst completion, from axi_wr_master
  input  logic                     burst_done_valid_i,
  input  logic [ChIdxW-1:0]        burst_done_ch_i,
  input  logic                     burst_done_err_i,
  input  logic                     burst_done_last_i,

  // "the transfer for the descriptor currently held by this channel has
  // finished" - to desc_fetch
  output logic                      xfer_done_o,
  output logic [ChIdxW-1:0]         xfer_done_ch_o,

  // per-channel status, to daq_csr (via daq_subsystem, phase 5)
  output logic [NumCh-1:0]          ch_err_o,
  output err_e                      ch_err_code_o [NumCh]
);

  logic [NumCh-1:0] err_q;
  err_e             err_code_q [NumCh];

  assign xfer_done_o    = burst_done_valid_i & burst_done_last_i;
  assign xfer_done_ch_o = burst_done_ch_i;

  logic this_burst_errored;
  assign this_burst_errored = burst_done_valid_i & burst_done_err_i;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      for (int unsigned c = 0; c < NumCh; c++) begin
        err_q[c]      <= 1'b0;
        err_code_q[c] <= ErrNone;
      end
    end else begin
      for (int unsigned c = 0; c < NumCh; c++) begin
        if (ch_abort_i[c]) begin
          err_q[c]      <= 1'b0;
          err_code_q[c] <= ErrNone;
        end else if (this_burst_errored & (burst_done_ch_i == ChIdxW'(c))) begin
          err_q[c]      <= 1'b1;
          err_code_q[c] <= ErrAxiWrite;
        end
      end
    end
  end

  assign ch_err_o      = err_q;
  assign ch_err_code_o = err_code_q;

endmodule
