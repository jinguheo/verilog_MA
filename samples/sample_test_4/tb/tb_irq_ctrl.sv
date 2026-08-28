// Block-level testbench for rtl/irq/irq_ctrl.sv.
//
// No valid/ready protocol anywhere in this module's own interface - every
// input is a level or a one-cycle pulse driven directly here, standing in
// for chan_top/desc_fetch/wr_track all at once. Checks are made right after
// a `@(negedge clk)` following the driving edge, since every output here is
// either purely combinational (ch_busy_o/ch_err_o/dma_busy_o/ch_cause_o) or
// registered from an input that was already stable across the edge
// (fetch_err_q/wr_err_q) - there is no cross-block "_taken" capture/consume
// split in this file for the same race tb_axi_wr_master.sv's own header
// documents, so none of that machinery is needed here.
//
// Phases:
//   1. ch_busy_o is the OR of stream_busy_i and desc_valid_i - either alone
//      is enough, and dma_busy_o follows any channel's busy
//   2. fetch_err_i held sticky produces exactly ONE ch_cause_o[IrqCauseErr]
//      pulse (the rising edge), not a continuous level, while ch_err_o
//      itself stays sticky the whole time
//   3. same for wr_err_i
//   4. xfer_done_i/xfer_done_ch_i routes ch_cause_o[IrqCauseDone] to the
//      correct channel only
//   5. stream_cause_i's Err/Crc/FifoOvf bits pass through unmodified
//      (Err ORs with any fetch/write pulse; Crc/FifoOvf are pure passthrough)

module tb_irq_ctrl;
  import daq_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0]       stream_busy, stream_err;
  logic [NumIrqCause-1:0] stream_cause [NumCh];
  logic [NumCh-1:0]       desc_valid;
  logic [NumCh-1:0]       fetch_err;
  logic [NumCh-1:0]       wr_err;
  logic                   xfer_done;
  logic [ChIdxW-1:0]      xfer_done_ch;

  logic [NumCh-1:0]       ch_busy, ch_err;
  logic [NumIrqCause-1:0] ch_cause [NumCh];
  logic                   dma_busy;

  irq_ctrl dut (
    .clk_i (clk), .rst_ni (rst_n),
    .stream_busy_i (stream_busy), .stream_err_i (stream_err),
    .stream_cause_i (stream_cause),
    .desc_valid_i (desc_valid), .fetch_err_i (fetch_err), .wr_err_i (wr_err),
    .xfer_done_i (xfer_done), .xfer_done_ch_i (xfer_done_ch),
    .ch_busy_o (ch_busy), .ch_err_o (ch_err), .ch_cause_o (ch_cause),
    .dma_busy_o (dma_busy)
  );

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  task automatic reset_dut();
    stream_busy  = '0;
    stream_err   = '0;
    for (int unsigned c = 0; c < NumCh; c++) stream_cause[c] = '0;
    desc_valid   = '0;
    fetch_err    = '0;
    wr_err       = '0;
    xfer_done    = 1'b0;
    xfer_done_ch = '0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: ch_busy_o / dma_busy_o are an OR -----------------------------
    stream_busy[1] = 1'b1;
    @(negedge clk);
    check(ch_busy[1], "phase1 stream_busy_i alone should set ch_busy_o");
    check(dma_busy, "phase1 dma_busy_o should follow any busy channel");
    stream_busy[1] = 1'b0;
    desc_valid[1]  = 1'b1;
    @(negedge clk);
    check(ch_busy[1], "phase1 desc_valid_i alone should also set ch_busy_o");
    desc_valid[1] = 1'b0;
    @(negedge clk);
    check(!ch_busy[1], "phase1 ch_busy_o should drop once both sources clear");
    check(!dma_busy, "phase1 dma_busy_o should drop once every channel is idle");

    // ---- phase 2: fetch_err_i sticky -> exactly one pulse ----------------------
    // fetch_err_i/wr_err_i model a REGISTERED status output of another
    // same-clock-domain module (desc_fetch's/wr_track's own err_q), so the
    // stimulus has to transition with that same timing relationship - a
    // non-blocking assignment scheduled at the SAME posedge irq_ctrl's own
    // edge-detector flop samples, not a blocking assignment set early at a
    // negedge. Driving it early (stable for the whole half-cycle before the
    // next posedge, the way this file's other level/pulse inputs are driven)
    // was tried first and does NOT work: irq_ctrl's own fetch_err_q flop
    // would then capture the "new" value on its very first opportunity too,
    // with zero lag relative to fetch_err_i itself, so fetch_err_rise never
    // sees a cycle where one is 1 and the other is still 0 - no pulse ever
    // appears. A non-blocking assignment at the matching posedge reproduces
    // exactly what a real upstream flop does: everything triggered by that
    // edge reads its OLD value, so irq_ctrl's own flop is one genuine cycle
    // behind, and the pulse appears immediately after.
    @(posedge clk);
    fetch_err[2] <= 1'b1;
    @(negedge clk);
    check(ch_cause[2][IrqCauseErr], "phase2 fetch_err_i rising edge should pulse IrqCauseErr");
    check(ch_err[2], "phase2 ch_err_o should be set while fetch_err_i is held");
    @(negedge clk);
    check(!ch_cause[2][IrqCauseErr], "phase2 IrqCauseErr should NOT stay high while fetch_err_i is merely held");
    check(ch_err[2], "phase2 ch_err_o should remain sticky while fetch_err_i is still held");
    @(negedge clk);
    check(!ch_cause[2][IrqCauseErr], "phase2 IrqCauseErr should still be low two cycles after the rising edge");
    @(posedge clk);
    fetch_err[2] <= 1'b0;
    @(negedge clk);
    check(!ch_err[2], "phase2 ch_err_o should clear once fetch_err_i clears");

    // ---- phase 3: wr_err_i, same shape -----------------------------------------
    @(posedge clk);
    wr_err[3] <= 1'b1;
    @(negedge clk);
    check(ch_cause[3][IrqCauseErr], "phase3 wr_err_i rising edge should pulse IrqCauseErr");
    @(negedge clk);
    check(!ch_cause[3][IrqCauseErr], "phase3 IrqCauseErr should not stay high while wr_err_i is merely held");
    @(posedge clk);
    wr_err[3] <= 1'b0;
    @(negedge clk);
    check(!ch_err[3], "phase3 ch_err_o should clear once wr_err_i clears");

    // ---- phase 4: xfer_done routes to the right channel only -------------------
    xfer_done_ch = ChIdxW'(5);
    xfer_done    = 1'b1;
    #1;
    check(ch_cause[5][IrqCauseDone], "phase4 xfer_done_i should pulse the named channel's IrqCauseDone");
    for (int unsigned c = 0; c < NumCh; c++) begin
      if (c != 5) check(!ch_cause[c][IrqCauseDone],
                         $sformatf("phase4 channel %0d should not see IrqCauseDone", c));
    end
    @(negedge clk);
    xfer_done = 1'b0;
    @(negedge clk);
    check(!ch_cause[5][IrqCauseDone], "phase4 IrqCauseDone should drop once xfer_done_i drops");

    // ---- phase 5: Crc/FifoOvf passthrough, Err ORs with fetch/wr pulses --------
    stream_cause[4][IrqCauseCrc]     = 1'b1;
    stream_cause[4][IrqCauseFifoOvf] = 1'b1;
    @(negedge clk);
    check(ch_cause[4][IrqCauseCrc], "phase5 stream_cause_i's Crc bit should pass through");
    check(ch_cause[4][IrqCauseFifoOvf], "phase5 stream_cause_i's FifoOvf bit should pass through");
    stream_cause[4][IrqCauseErr] = 1'b1;
    @(negedge clk);
    check(ch_cause[4][IrqCauseErr], "phase5 stream_cause_i's Err bit should pass through directly (not edge-gated)");
    stream_cause[4] = '0;
    @(negedge clk);
    check(!ch_cause[4][IrqCauseErr], "phase5 Err should drop once stream_cause_i drops");

    // ---- final: every untouched channel shows nothing left over ----------------
    for (int unsigned c = 0; c < NumCh; c++) begin
      check(!ch_err[c], $sformatf("final: channel %0d should show no residual error", c));
      check(!ch_busy[c], $sformatf("final: channel %0d should show no residual busy", c));
      check(ch_cause[c] == '0, $sformatf("final: channel %0d should show no residual cause", c));
    end
    check(!dma_busy, "final: dma_busy_o should be low");

    $display("");
    if (errors == 0) begin $display("[IRQ_CTRL_TB] PASS"); $finish; end
    else begin $display("[IRQ_CTRL_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_irq_ctrl failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_irq_ctrl timeout"); end

endmodule
