// Block-level testbench for rtl/dma/wr_track.sv.
//
// No AXI/beat-stream protocol on either side of this module - it only ever
// sees axi_wr_master's already-reduced per-burst completion event
// (burst_done_valid_i/ch_i/err_i/last_i), driven directly here rather than
// through a real axi_wr_master instance, and ch_abort_i from what would be
// daq_csr. xfer_done_o/ch_err_o are checked combinationally where the RTL
// makes them combinational (xfer_done_o), and one cycle after the driving
// edge where the RTL registers them (ch_err_o/ch_err_code_o).
//
// Phases:
//   1. a single-burst transfer (last=1 on its only burst) - xfer_done_o
//      fires immediately, no error latched
//   2. a multi-burst transfer - xfer_done_o must stay low on the
//      non-final burst and only fire on the one marked last
//   3. a burst errors mid-transfer, but the transfer still finishes -
//      the error must latch AND xfer_done_o must still fire on completion
//      (see the module header: a write error does not block xfer_done_o)
//   4. ch_abort_i clears a latched error for that channel
//   5. two channels' errors are independent - one channel's abort must not
//      touch another channel's still-latched error

module tb_wr_track;
  import daq_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0] ch_abort;

  logic              bd_valid;
  logic [ChIdxW-1:0] bd_ch;
  logic              bd_err, bd_last;

  logic              xfer_done;
  logic [ChIdxW-1:0] xfer_done_ch;
  logic [NumCh-1:0]  ch_err;
  err_e              ch_err_code [NumCh];

  wr_track dut (
    .clk_i (clk), .rst_ni (rst_n),
    .ch_abort_i (ch_abort),
    .burst_done_valid_i (bd_valid), .burst_done_ch_i (bd_ch),
    .burst_done_err_i (bd_err), .burst_done_last_i (bd_last),
    .xfer_done_o (xfer_done), .xfer_done_ch_o (xfer_done_ch),
    .ch_err_o (ch_err), .ch_err_code_o (ch_err_code)
  );

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  task automatic reset_dut();
    ch_abort = '0;
    bd_valid = 1'b0;
    bd_ch    = '0;
    bd_err   = 1'b0;
    bd_last  = 1'b0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  // Drives one burst_done_* pulse for exactly one cycle, checking the
  // combinational xfer_done_o/ch_o mid-cycle (before the pulse is dropped)
  // and leaving the clock one negedge past the posedge that would have
  // updated ch_err_o/ch_err_code_o, so callers can check those right after.
  task automatic pulse_burst_done(
      input logic [ChIdxW-1:0] ch, input bit err, input bit last,
      input bit exp_xfer_done, input logic [ChIdxW-1:0] exp_xfer_ch
  );
    @(negedge clk);
    bd_ch = ch; bd_err = err; bd_last = last; bd_valid = 1'b1;
    #1;
    check(xfer_done == exp_xfer_done, "xfer_done_o mismatch");
    if (exp_xfer_done) check(xfer_done_ch == exp_xfer_ch, "xfer_done_ch_o mismatch");
    @(posedge clk);
    @(negedge clk);
    bd_valid = 1'b0;
  endtask

  task automatic do_abort(input logic [ChIdxW-1:0] ch);
    ch_abort[ch] = 1'b1;
    @(posedge clk);
    @(negedge clk);
    ch_abort[ch] = 1'b0;
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: single-burst transfer, no error ---------------------------
    pulse_burst_done(3'(1), 1'b0, 1'b1, 1'b1, 3'(1));
    check(!ch_err[1], "phase1 no error should be latched");
    check(ch_err_code[1] == ErrNone, "phase1 err code should stay ErrNone");

    // ---- phase 2: multi-burst transfer - xfer_done only on the last one -----
    pulse_burst_done(3'(2), 1'b0, 1'b0, 1'b0, '0);
    check(!ch_err[2], "phase2 no error expected after the non-final burst");
    pulse_burst_done(3'(2), 1'b0, 1'b1, 1'b1, 3'(2));
    check(!ch_err[2], "phase2 no error expected after the final burst");

    // ---- phase 3: a burst errors mid-transfer, transfer still completes -----
    pulse_burst_done(3'(3), 1'b1, 1'b0, 1'b0, '0);
    check(ch_err[3], "phase3 error should latch immediately after the erroring burst");
    check(ch_err_code[3] == ErrAxiWrite, "phase3 err code should be ErrAxiWrite");
    pulse_burst_done(3'(3), 1'b0, 1'b1, 1'b1, 3'(3));
    check(ch_err[3], "phase3 error should remain latched once the transfer completes");
    check(ch_err_code[3] == ErrAxiWrite, "phase3 err code should still be ErrAxiWrite");

    // ---- phase 4: ch_abort_i clears the latched error ------------------------
    do_abort(3'(3));
    check(!ch_err[3], "phase4 abort should clear the latched error");
    check(ch_err_code[3] == ErrNone, "phase4 abort should reset the err code");

    // ---- phase 5: two channels' errors are independent -----------------------
    pulse_burst_done(3'(5), 1'b1, 1'b1, 1'b1, 3'(5));
    check(ch_err[5], "phase5 channel 5 should show its own error");
    check(!ch_err[1] && !ch_err[2], "phase5 other channels must stay unaffected");
    do_abort(3'(5));
    check(!ch_err[5], "phase5 abort ch5 should clear ch5");
    check(!ch_err[1] && !ch_err[2], "phase5 abort ch5 must not touch other channels");

    // ---- final: every channel this TB never touched (and every one it did,
    // now cleared) should show no residual error - reads every bit of
    // ch_err_o/ch_err_code_o rather than only the channels named above.
    for (int unsigned c = 0; c < NumCh; c++) begin
      check(!ch_err[c], $sformatf("final: channel %0d should show no residual error", c));
      check(ch_err_code[c] == ErrNone, $sformatf("final: channel %0d err code should be ErrNone", c));
    end

    $display("");
    if (errors == 0) begin $display("[WR_TRACK_TB] PASS"); $finish; end
    else begin $display("[WR_TRACK_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_wr_track failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_wr_track timeout"); end

endmodule
