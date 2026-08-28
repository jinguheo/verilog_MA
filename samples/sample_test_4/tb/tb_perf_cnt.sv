// Block-level testbench for rtl/stat/perf_cnt.sv.
//
// Every counter here is a registered cnt_sat instance, so a check always
// happens at the @(negedge clk) following the driving posedge - no
// valid/ready protocol of this module's own to worry about, since
// beat_valid_i/beat_ready_i are just levels this testbench drives directly
// (standing in for chan_top/dma_sched at once).
//
// Phases:
//   1. full-strobe beats accepted on one channel - byte count tracks
//      AxiBw-per-beat, packet count increments only on an accepted eop beat
//   2. a partial-strobe beat - byte count advances by the strobe's popcount,
//      not the full bus width
//   3. backpressure (valid held, ready low) - stall count increments, byte/
//      packet counts do not
//   4. each of the three error-class cause bits bumps CH_ERR_CNT; only
//      IrqCauseCrc also bumps CH_CRC_STATUS
//   5. ch_abort_i clears every counter for that channel only
//   6. CH_ECC_STATUS is always zero - no ECC hardware exists yet

module tb_perf_cnt;
  import daq_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0]       ch_abort;
  logic [NumCh-1:0]       beat_valid, beat_ready;
  logic [AxiBw-1:0]       beat_strb [NumCh];
  logic [NumCh-1:0]       beat_eop;
  logic [NumIrqCause-1:0] ch_cause [NumCh];

  logic [31:0] byte_cnt   [NumCh];
  logic [31:0] pkt_cnt    [NumCh];
  logic [31:0] err_cnt    [NumCh];
  logic [31:0] stall_cnt  [NumCh];
  logic [31:0] crc_status [NumCh];
  logic [31:0] ecc_status [NumCh];

  perf_cnt dut (
    .clk_i (clk), .rst_ni (rst_n),
    .ch_abort_i (ch_abort),
    .beat_valid_i (beat_valid), .beat_ready_i (beat_ready),
    .beat_strb_i (beat_strb), .beat_eop_i (beat_eop),
    .ch_cause_i (ch_cause),
    .ch_byte_cnt_o (byte_cnt), .ch_pkt_cnt_o (pkt_cnt),
    .ch_err_cnt_o (err_cnt), .ch_stall_cnt_o (stall_cnt),
    .ch_crc_status_o (crc_status), .ch_ecc_status_o (ecc_status)
  );

  localparam int unsigned BeatBytes = AxiBw;

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  task automatic reset_dut();
    ch_abort   = '0;
    beat_valid = '0;
    beat_ready = '0;
    beat_eop   = '0;
    for (int unsigned c = 0; c < NumCh; c++) begin
      beat_strb[c] = '0;
      ch_cause[c]  = '0;
    end
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  // Drives one accepted beat on channel `ch` for exactly one cycle.
  task automatic send_beat(input logic [ChIdxW-1:0] ch, input logic [AxiBw-1:0] strb, input bit eop);
    beat_valid[ch] = 1'b1;
    beat_ready[ch] = 1'b1;
    beat_strb[ch]  = strb;
    beat_eop[ch]   = eop;
    @(negedge clk);
    beat_valid[ch] = 1'b0;
    beat_ready[ch] = 1'b0;
    beat_eop[ch]   = 1'b0;
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: full-strobe beats, packet count only on eop ------------------
    send_beat(0, {AxiBw{1'b1}}, 1'b0);
    check(byte_cnt[0] == 32'(BeatBytes), "phase1 byte_cnt after beat0 mismatch");
    check(pkt_cnt[0] == 32'd0, "phase1 pkt_cnt should not increment on a non-eop beat");
    send_beat(0, {AxiBw{1'b1}}, 1'b1);
    check(byte_cnt[0] == 32'(2 * BeatBytes), "phase1 byte_cnt after beat1 mismatch");
    check(pkt_cnt[0] == 32'd1, "phase1 pkt_cnt should increment on the accepted eop beat");

    // ---- phase 2: a partial-strobe beat advances by popcount, not full width ---
    send_beat(0, 8'h03, 1'b1);  // 2 of BeatBytes bytes enabled (BeatBytes>=2 at both AxiDw values)
    check(byte_cnt[0] == 32'(2 * BeatBytes + 2), "phase2 byte_cnt should advance by strobe popcount only");
    check(pkt_cnt[0] == 32'd2, "phase2 pkt_cnt should still increment on this eop beat");

    // ---- phase 3: backpressure - stall counts, byte/pkt do not -----------------
    beat_valid[0] = 1'b1;
    beat_ready[0] = 1'b0;
    beat_strb[0]  = {AxiBw{1'b1}};
    repeat (3) @(negedge clk);
    beat_valid[0] = 1'b0;
    check(stall_cnt[0] == 32'd3, "phase3 stall_cnt should count exactly the backpressured cycles");
    check(byte_cnt[0] == 32'(2 * BeatBytes + 2), "phase3 byte_cnt should not move during backpressure");
    check(pkt_cnt[0] == 32'd2, "phase3 pkt_cnt should not move during backpressure");

    // ---- phase 4: error-cause counting on a different channel ------------------
    ch_cause[1][IrqCauseErr] = 1'b1;
    @(negedge clk);
    ch_cause[1][IrqCauseErr] = 1'b0;
    check(err_cnt[1] == 32'd1, "phase4 IrqCauseErr should bump err_cnt");
    check(crc_status[1] == 32'd0, "phase4 IrqCauseErr alone should not bump crc_status");

    ch_cause[1][IrqCauseCrc] = 1'b1;
    @(negedge clk);
    ch_cause[1][IrqCauseCrc] = 1'b0;
    check(err_cnt[1] == 32'd2, "phase4 IrqCauseCrc should also bump err_cnt");
    check(crc_status[1] == 32'd1, "phase4 IrqCauseCrc should bump crc_status");

    ch_cause[1][IrqCauseFifoOvf] = 1'b1;
    @(negedge clk);
    ch_cause[1][IrqCauseFifoOvf] = 1'b0;
    check(err_cnt[1] == 32'd3, "phase4 IrqCauseFifoOvf should also bump err_cnt");
    check(crc_status[1] == 32'd1, "phase4 IrqCauseFifoOvf should not bump crc_status");

    check(byte_cnt[1] == 32'd0 && pkt_cnt[1] == 32'd0 && stall_cnt[1] == 32'd0,
          "phase4 channel 1's activity counters should be untouched by cause pulses alone");

    // ---- phase 5: abort clears only the aborted channel's counters -------------
    ch_abort[0] = 1'b1;
    @(negedge clk);
    ch_abort[0] = 1'b0;
    @(negedge clk);
    check(byte_cnt[0] == 32'd0 && pkt_cnt[0] == 32'd0 && stall_cnt[0] == 32'd0,
          "phase5 channel 0's counters should clear on its own abort");
    check(err_cnt[1] == 32'd3 && crc_status[1] == 32'd1,
          "phase5 channel 0's abort must not touch channel 1's counters");

    // ---- phase 6: CH_ECC_STATUS is always zero - no ECC hardware exists --------
    for (int unsigned c = 0; c < NumCh; c++) begin
      check(ecc_status[c] == 32'd0, $sformatf("phase6 channel %0d ecc_status should be zero", c));
    end

    $display("");
    if (errors == 0) begin $display("[PERF_CNT_TB] PASS"); $finish; end
    else begin $display("[PERF_CNT_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_perf_cnt failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_perf_cnt timeout"); end

endmodule
