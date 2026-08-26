// Block-level testbench for rtl/stream/pkt_align.sv.
//
// Uses the same posedge-monitor acceptance pattern established (the hard
// way) in tb_axil_slave.sv/tb_daq_csr.sv during phase 2: valid/ready
// acceptance is captured inside an always @(posedge clk) block, in the
// Active region before any NBA update commits, and the negedge-driven
// driver/checker code reads that captured boolean rather than re-reading the
// raw ready signal afterwards. skid_buffer's ready_o does not drop on
// exactly the same edge it accepts on the way axil_slave's did, but there is
// no reason to find that out the same way twice - this pattern is correct
// for any valid/ready channel, not just the specific one that first forced
// it.
//
// Phases:
//   1. one full beat exactly (length == AxiBw)                 - strb all 1
//   2. multi-beat packet with a partial last beat               - strb partial
//   3. single-byte packet (partial first-and-only beat)
//   4. back-to-back packets - sop/eop must land on the right beats each time
//   5. randomised lengths + randomised backpressure on both sides, scoreboarded
//   6. src_crc_i driven to garbage except on the eop byte - beat_crc_o must
//      only be trusted when beat_eop_o is set, and this proves nothing
//      downstream depends on it being stable elsewhere

module tb_pkt_align;
  import daq_pkg::*;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic             src_valid, src_ready, src_sop, src_eop;
  logic [SrcDw-1:0] src_data;
  logic [31:0]      src_crc;

  logic                 beat_valid, beat_ready, beat_sop, beat_eop;
  logic [AxiDw-1:0]     beat_data;
  logic [AxiBw-1:0]     beat_strb;
  logic [31:0]          beat_crc;

  pkt_align dut (
    .clk_i (clk), .rst_ni (rst_n),
    .src_valid_i (src_valid), .src_ready_o (src_ready),
    .src_data_i (src_data), .src_sop_i (src_sop), .src_eop_i (src_eop),
    .src_crc_i (src_crc),
    .beat_valid_o (beat_valid), .beat_ready_i (beat_ready),
    .beat_data_o (beat_data), .beat_strb_o (beat_strb),
    .beat_sop_o (beat_sop), .beat_eop_o (beat_eop), .beat_crc_o (beat_crc)
  );

  // ---- acceptance monitors (posedge, pre-NBA) --------------------------------
  logic src_taken, beat_taken;
  always @(posedge clk) begin
    src_taken  = src_valid  & src_ready;
    beat_taken = beat_valid & beat_ready;
  end

  int unsigned errors = 0;

  // ---- reference model --------------------------------------------------------
  // Expected byte stream (in send order) and, once a beat is observed, the
  // reconstructed byte stream from beat_data_o/beat_strb_o. Compared once a
  // whole packet's worth of beats has come out.
  logic [7:0] exp_bytes [$];
  logic [7:0] got_bytes [$];
  logic [31:0] exp_crc_q [$];   // one entry per packet, pushed at send-time eop
  logic [31:0] got_crc_q [$];   // one entry per packet, pushed at beat eop
  int unsigned exp_pkt_len_q [$];
  int unsigned got_pkt_len_q [$];
  int unsigned cur_pkt_bytes;   // bytes reconstructed in the packet in progress

  initial cur_pkt_bytes = 0;

  always @(posedge clk) begin
    if (rst_n && beat_taken) begin
      automatic int unsigned n;
      // How many bytes does this beat contribute? strb is a contiguous
      // low-to-high run starting at lane 0 for every beat pkt_align emits
      // (full beats: all AxiBw lanes; partial: 1..AxiBw-1 lanes) - never a
      // gap, since bytes are packed in arrival order starting at byte_cnt=0.
      n = 0;
      for (int unsigned i = 0; i < AxiBw; i++) if (beat_strb[i]) n++;
      if (n == 0) begin
        $display("ERROR: beat_taken with strb=0"); errors++;
      end
      if (cur_pkt_bytes == 0 && !beat_sop) begin
        $display("ERROR: first beat of a packet did not carry sop"); errors++;
      end
      if (cur_pkt_bytes != 0 && beat_sop) begin
        $display("ERROR: sop set on a non-first beat"); errors++;
      end
      for (int unsigned i = 0; i < AxiBw; i++) begin
        if (beat_strb[i]) got_bytes.push_back(beat_data[i*8+:8]);
      end
      cur_pkt_bytes += n;
      if (beat_eop) begin
        got_crc_q.push_back(beat_crc);
        got_pkt_len_q.push_back(cur_pkt_bytes);
        cur_pkt_bytes = 0;
      end
    end
  end

  // ---- drivers -----------------------------------------------------------------
  task automatic reset_dut();
    src_valid = 0; src_data = '0; src_sop = 0; src_eop = 0; src_crc = '0;
    beat_ready = 0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  // Sends one packet of `len` bytes with the given crc (driven only on the
  // eop byte; garbage otherwise, see phase 6 above). `stall_pct` randomly
  // withholds src_valid between bytes to test that pkt_align keeps
  // accumulating across gaps, not just back-to-back bytes.
  task automatic send_packet(input int unsigned len, input logic [31:0] crc, input int unsigned stall_pct);
    for (int unsigned i = 0; i < len; i++) begin
      // Deassert before the stall wait, not just at the end of the task: the
      // previous byte's acceptance (src_taken) only means the DUT took it
      // that edge, not that src_valid dropped afterwards. Leaving it high
      // into the stall gap re-presents the SAME already-accepted byte with
      // src_ready still up, and the DUT (correctly) accepts it again -
      // silently duplicating a byte for every stall gap. This only showed up
      // once phase 5 turned stall_pct on; phases 1-4 (stall_pct=0) never
      // exercised the gap at all.
      src_valid = 1'b0;
      while (stall_pct > 0 && $urandom_range(0, 99) < stall_pct) @(negedge clk);
      src_data = 8'(exp_bytes.size() + 1);  // arbitrary but distinct per byte
      exp_bytes.push_back(src_data);
      src_sop  = (i == 0);
      src_eop  = (i == len - 1);
      src_crc  = src_eop ? crc : 32'($urandom);
      src_valid = 1'b1;
      @(negedge clk);
      while (!src_taken) @(negedge clk);
    end
    src_valid = 1'b0;
    exp_crc_q.push_back(crc);
    exp_pkt_len_q.push_back(len);
  endtask

  initial begin
    reset_dut();
    beat_ready = 1'b1;

    // ---- phase 1: exactly one full beat -------------------------------------
    send_packet(AxiBw, 32'hAAAA_0001, 0);

    // ---- phase 2: multi-beat with partial last beat -------------------------
    send_packet(AxiBw * 2 + (AxiBw / 2 == 0 ? 1 : AxiBw / 2), 32'hAAAA_0002, 0);

    // ---- phase 3: single-byte packet -----------------------------------------
    send_packet(1, 32'hAAAA_0003, 0);

    // ---- phase 4: back-to-back, no gap between packets -----------------------
    send_packet(3, 32'hAAAA_0004, 0);
    send_packet(AxiBw + 1, 32'hAAAA_0005, 0);
    send_packet(2, 32'hAAAA_0006, 0);

    @(negedge clk);
    // Drain phases 1-4 before starting the randomised/backpressure phase so
    // the scoreboard below can check them as a clean, known-length group.
    while (got_crc_q.size() < exp_crc_q.size()) @(negedge clk);

    // ---- phase 5: randomised lengths + backpressure on both sides -----------
    // The two forked branches below run to completion together (plain join,
    // not join_any) - an earlier version raced a fixed-length beat_ready
    // toggler against send_packet and used disable fork to kill whichever
    // finished last. When stalls made send_packet run longer than the
    // toggler's fixed len*3 budget, disable fork killed it mid-byte with
    // src_valid still asserted and never cleared, which then bled a stray
    // byte into whatever came next - "got more bytes than expected" on every
    // packet after the first randomised one. The toggler now loops on a
    // completion flag send_packet itself sets, so it always outlasts the
    // send it is meant to backpressure, and nothing is ever killed mid-task.
    for (int unsigned p = 0; p < 12; p++) begin
      automatic int unsigned len = $urandom_range(1, AxiBw * 3 + 5);
      automatic logic [31:0] crc = $urandom;
      automatic bit send_done = 1'b0;
      fork
        begin
          send_packet(len, crc, 30);
          send_done = 1'b1;
        end
        begin
          while (!send_done) begin
            beat_ready = ($urandom_range(0, 99) < 70);
            @(negedge clk);
          end
          beat_ready = 1'b1;
        end
      join
      // Let the pipeline drain fully before starting the next packet, so
      // per-packet accounting below stays unambiguous.
      while (got_crc_q.size() < exp_crc_q.size()) @(negedge clk);
    end

    // ---- scoreboard: full byte stream + per-packet CRC/length ---------------
    if (got_bytes.size() != exp_bytes.size()) begin
      $display("ERROR: byte count mismatch, got %0d expected %0d", got_bytes.size(), exp_bytes.size());
      errors++;
    end else begin
      for (int unsigned i = 0; i < exp_bytes.size(); i++) begin
        if (got_bytes[i] !== exp_bytes[i]) begin
          $display("ERROR: byte %0d mismatch, got %0h expected %0h", i, got_bytes[i], exp_bytes[i]);
          errors++;
        end
      end
    end
    if (got_crc_q.size() != exp_crc_q.size()) begin
      $display("ERROR: packet count mismatch, got %0d expected %0d", got_crc_q.size(), exp_crc_q.size());
      errors++;
    end else begin
      for (int unsigned i = 0; i < exp_crc_q.size(); i++) begin
        if (got_crc_q[i] !== exp_crc_q[i]) begin
          $display("ERROR: packet %0d crc mismatch, got %0h expected %0h", i, got_crc_q[i], exp_crc_q[i]);
          errors++;
        end
        if (got_pkt_len_q[i] !== exp_pkt_len_q[i]) begin
          $display("ERROR: packet %0d length mismatch, got %0d expected %0d", i, got_pkt_len_q[i], exp_pkt_len_q[i]);
          errors++;
        end
      end
    end

    $display("");
    $display("[PKT_ALIGN_TB] packets=%0d bytes=%0d", exp_crc_q.size(), exp_bytes.size());
    if (errors == 0) begin $display("[PKT_ALIGN_TB] PASS"); $finish; end
    else begin $display("[PKT_ALIGN_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_pkt_align failed"); end
  end

  initial begin #2_000_000; $fatal(1, "tb_pkt_align timeout"); end

endmodule
