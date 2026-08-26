// Block-level testbench for rtl/stream/chan_top.sv - the one testbench in
// phase 3 that actually crosses a clock domain, since chan_top is the one
// module in phase 3 that instantiates the CDC FIFO.
//
// src_clk and axi_clk run at a deliberately non-integer ratio (period 6 vs
// 10) so nothing here can accidentally pass by relying on the two clocks
// happening to align. This is a narrower version of what Sample Test 3's
// UVM clock-ratio sweep does for its three domains; a fuller sweep (many
// ratios, both directions) is integration-phase territory (phase 6), not a
// single block's testbench.
//
// prim_fifo_async's own correctness is not re-proven here - tb/
// prim_reuse_smoke.sv and Sample Test 2 already cover that. This TB is about
// chan_top's own wiring: the pack/unpack order around the FIFO agreeing with
// itself, both reset synchronizers actually working, and the FSM gating
// (chan_ctrl) correctly controlling what a source on one clock and a
// consumer on a completely different clock each see.
//
// Uses the posedge-monitor acceptance pattern (src_clk side and axi_clk side
// tracked independently, each in its own domain's monitor).
//
// Phases:
//   1. one clean packet, good CRC - full byte-for-byte reconstruction check
//   2. corrupted CRC - crc_err_o / ChError entered, then cleared with abort
//   3a. disabled before axi_clk ever saw a beat of the packet already
//       crossing - the packet is discarded, not delivered. Getting this
//       phase's own expectation right took two tries: an earlier version
//       assumed the packet should still arrive intact (matching
//       ChDraining's promise) and only found out otherwise by watching
//       chan_ctrl actually discard it - see chan_ctrl.sv's header for why
//       that is the *correct* behavior here, not a second bug. ChDraining
//       protects a packet axi_clk had already started accepting; this
//       packet never got that far before disable landed.
//   3b. disabled only after ch_busy_o confirms axi_clk has started the
//       packet - now ChDraining's promise applies and the packet must
//       arrive intact. This is the cross-clock version of what
//       tb_chan_ctrl.sv's phase 4 already covers same-clock; the two
//       together are what pin down where the drain/discard line actually is.
//   4. randomised packets (good CRC only - corruption is phase 2's job),
//      randomised backpressure on both the source side and beat_ready_i,
//      scoreboarded end to end across both clocks

module tb_chan_top;
  import daq_pkg::*;

  logic src_clk = 1'b0;
  always #3 src_clk = ~src_clk;   // period 6

  logic axi_clk = 1'b0;
  always #5 axi_clk = ~axi_clk;   // period 10 - non-integer ratio vs src_clk

  logic rst_n = 1'b0;

  logic             src_valid, src_ready, src_sop, src_eop;
  logic [SrcDw-1:0] src_data;
  logic [31:0]      src_crc;

  logic ch_enable, ch_abort;

  logic             beat_valid, beat_ready, beat_sop, beat_eop;
  logic [AxiDw-1:0] beat_data;
  logic [AxiBw-1:0] beat_strb;

  logic ch_busy, ch_err;
  logic [NumIrqCause-1:0] ch_cause;

  chan_top dut (
    .src_clk_i (src_clk), .axi_clk_i (axi_clk), .rst_ni (rst_n),
    .src_valid_i (src_valid), .src_ready_o (src_ready),
    .src_data_i (src_data), .src_sop_i (src_sop), .src_eop_i (src_eop), .src_crc_i (src_crc),
    .ch_enable_i (ch_enable), .ch_abort_i (ch_abort),
    .beat_valid_o (beat_valid), .beat_ready_i (beat_ready),
    .beat_data_o (beat_data), .beat_strb_o (beat_strb),
    .beat_sop_o (beat_sop), .beat_eop_o (beat_eop),
    .ch_busy_o (ch_busy), .ch_err_o (ch_err), .ch_cause_o (ch_cause)
  );

  // ---- acceptance monitors, one per clock domain -----------------------------
  logic src_taken, beat_taken;
  always @(posedge src_clk) src_taken  = src_valid  & src_ready;
  always @(posedge axi_clk) beat_taken = beat_valid & beat_ready;

  int unsigned errors = 0;

  // ---- reference CRC-32 (independent of pkt_check's RTL, same as tb_pkt_check) -
  function automatic logic [31:0] crc32_step(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) c = c[0] ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    crc32_step = c;
  endfunction
  function automatic logic [31:0] software_crc32(input logic [7:0] bytes_q[$]);
    automatic logic [31:0] c = 32'hFFFF_FFFF;
    foreach (bytes_q[i]) c = crc32_step(c, bytes_q[i]);
    software_crc32 = c ^ 32'hFFFF_FFFF;
  endfunction

  // ---- scoreboard --------------------------------------------------------------
  logic [7:0] exp_bytes [$];
  logic [7:0] got_bytes [$];
  int unsigned exp_pkt_count;
  int unsigned got_pkt_count;
  bit          out_in_pkt;
  bit          done_cause_seen;  // latched, since ch_cause_o is a one-cycle pulse
  bit          busy_seen;        // latched: was ch_busy_o ever high during this phase?

  always @(posedge axi_clk) begin
    if (rst_n && ch_cause[IrqCauseDone]) done_cause_seen = 1'b1;
    if (rst_n && ch_busy) busy_seen = 1'b1;
  end

  always @(posedge axi_clk) begin
    if (rst_n && beat_taken) begin
      if (!out_in_pkt && !beat_sop) begin
        $display("ERROR: first output beat of a packet did not carry sop"); errors++;
      end
      if (out_in_pkt && beat_sop) begin
        $display("ERROR: sop set on a non-first output beat"); errors++;
      end
      out_in_pkt = beat_eop ? 1'b0 : 1'b1;
      for (int unsigned i = 0; i < AxiBw; i++) if (beat_strb[i]) got_bytes.push_back(beat_data[i*8+:8]);
      if (beat_eop) got_pkt_count++;
    end
  end

  // ---- drivers ------------------------------------------------------------------
  task automatic reset_dut();
    src_valid = 0; src_data = '0; src_sop = 0; src_eop = 0; src_crc = '0;
    ch_enable = 0; ch_abort = 0;
    beat_ready = 0;
    rst_n = 1'b0;
    repeat (5) @(negedge src_clk);
    rst_n = 1'b1;
    repeat (3) @(negedge src_clk);
  endtask

  task automatic send_packet(input int unsigned len, input bit bad_crc, input bit track);
    automatic logic [7:0] bytes_q[$];
    automatic logic [31:0] crc;
    for (int unsigned i = 0; i < len; i++) begin
      automatic logic [7:0] b = 8'((exp_pkt_count * 53 + i + 1) & 8'hFF);
      bytes_q.push_back(b);
      if (track) exp_bytes.push_back(b);
    end
    crc = software_crc32(bytes_q);
    if (bad_crc) crc = crc ^ 32'h1;

    for (int unsigned i = 0; i < len; i++) begin
      src_data = bytes_q[i];
      src_sop  = (i == 0);
      src_eop  = (i == len - 1);
      src_crc  = src_eop ? crc : 32'($urandom);
      src_valid = 1'b1;
      @(negedge src_clk);
      while (!src_taken) @(negedge src_clk);
    end
    src_valid = 1'b0;
    if (track) exp_pkt_count++;
  endtask

  initial begin
    reset_dut();
    if (ch_err !== 1'b0) begin $display("ERROR: ch_err_o set after reset"); errors++; end

    // ---- phase 1: one clean packet, byte-for-byte check ----------------------
    ch_enable = 1'b1;
    beat_ready = 1'b1;
    @(negedge src_clk);
    send_packet(AxiBw * 2 + 3, 1'b0, 1'b1);
    while (got_pkt_count < exp_pkt_count) @(negedge axi_clk);
    if (got_bytes.size() != exp_bytes.size()) begin
      $display("ERROR: phase1 byte count got %0d expected %0d", got_bytes.size(), exp_bytes.size());
      errors++;
    end else begin
      foreach (exp_bytes[i]) if (got_bytes[i] !== exp_bytes[i]) begin
        $display("ERROR: phase1 byte %0d mismatch got %0h expected %0h", i, got_bytes[i], exp_bytes[i]);
        errors++;
      end
    end
    if (!done_cause_seen) begin
      $display("ERROR: phase1 ch_cause_o[IrqCauseDone] never pulsed for the clean packet");
      errors++;
    end
    done_cause_seen = 1'b0;
    if (!busy_seen) begin
      $display("ERROR: phase1 ch_busy_o never asserted while the packet was in flight");
      errors++;
    end
    if (ch_busy !== 1'b0) begin
      $display("ERROR: phase1 ch_busy_o still set once the packet has fully drained");
      errors++;
    end
    busy_seen = 1'b0;

    // ---- phase 2: corrupted CRC -> Error, then abort to recover --------------
    // track=1'b1: pkt_check/chan_ctrl forward a packet's beats (including its
    // eop beat) before the CRC result is known - see pkt_check.sv's header on
    // why this is not store-and-forward - so this corrupted packet's data
    // really does reach beat_valid_o/got_bytes/got_pkt_count despite the bad
    // CRC. track=1'b0 here (an earlier version) left the scoreboard's exp_*
    // counters one packet/AxiBw+1 bytes behind what the DUT actually and
    // correctly delivered - not a leak, just an unscored delivery - which
    // desynced every later "while (got_pkt_count < exp_pkt_count)" wait in
    // phase 3b/4 that happened to find got_pkt_count already coincidentally
    // >= exp_pkt_count and returned immediately without the pipeline having
    // drained the packet actually being waited for.
    send_packet(AxiBw + 1, 1'b1, 1'b1);
    repeat (10) @(negedge axi_clk);
    if (ch_err !== 1'b1) begin $display("ERROR: phase2 ch_err_o not set after bad-CRC packet"); errors++; end
    ch_abort = 1'b1;
    @(negedge axi_clk);
    ch_abort = 1'b0;
    repeat (3) @(negedge axi_clk);
    if (ch_err !== 1'b0) begin $display("ERROR: phase2 ch_err_o still set after abort"); errors++; end

    // ---- phase 3a: disabled before axi_clk ever saw a beat - discarded ------
    ch_enable = 1'b1;
    @(negedge axi_clk);
    begin
      automatic logic [7:0] bytes_q[$];
      automatic int unsigned len = AxiBw + 2;
      automatic logic [31:0] crc;
      automatic int unsigned bytes_before = got_bytes.size();
      automatic int unsigned pkts_before  = got_pkt_count;
      for (int unsigned i = 0; i < len; i++) bytes_q.push_back(8'(200 + i));
      crc = software_crc32(bytes_q);
      // Not added to exp_bytes/exp_pkt_count: this packet is expected to be
      // discarded by chan_ctrl's Idle-state drain, not delivered - see the
      // module header comment on the two attempts it took to get this right.
      for (int unsigned i = 0; i < len; i++) begin
        src_data = bytes_q[i]; src_sop = (i == 0); src_eop = (i == len - 1);
        src_crc = src_eop ? crc : 32'($urandom);
        src_valid = 1'b1;
        @(negedge src_clk);
        while (!src_taken) @(negedge src_clk);
        if (i == 0) ch_enable = 1'b0;  // disable right after the first beat's byte
      end
      src_valid = 1'b0;
      // Wait for the drain to provably finish (state-driven, not a guessed
      // cycle count): Idle, nothing sitting in the CDC FIFO, and chan_ctrl's
      // own sticky mid-packet-drain bit clear. A fixed-cycle wait here once
      // hid a real question - "did it actually finish, or did the check just
      // happen to run before a later leak" - that this removes entirely.
      begin
        automatic int unsigned guard = 0;
        while (!(dut.u_chan_ctrl.state_q == ChIdle && !dut.fifo_rvalid &&
                 !dut.u_chan_ctrl.drain_pending_q) && guard < 200) begin
          @(negedge axi_clk);
          guard++;
        end
        if (guard >= 200) begin
          $display("ERROR: phase3a drain never completed within the guard window"); errors++;
        end
      end
      repeat (5) @(negedge axi_clk);  // margin past the drain-complete point
      if (ch_err !== 1'b0) begin $display("ERROR: phase3a a discarded packet should not enter Error"); errors++; end
      if (got_bytes.size() !== bytes_before || got_pkt_count !== pkts_before) begin
        $display("ERROR: phase3a discarded packet leaked through: bytes %0d->%0d, packets %0d->%0d",
                  bytes_before, got_bytes.size(), pkts_before, got_pkt_count);
        errors++;
      end
    end

    // ---- phase 3b: disabled only after axi_clk confirms Running - drains ----
    // A longer packet than 3a's, so there is a real window (many src_clk
    // bytes) during which the disable can land after ch_busy_o confirms
    // Running but before the packet's own eop - the two must race, not run
    // sequentially, or "disable after busy" would just mean "disable after
    // the packet already fully finished," testing nothing.
    ch_enable = 1'b1;
    @(negedge axi_clk);
    begin
      automatic logic [7:0] bytes_q[$];
      automatic int unsigned len = AxiBw * 4 + 2;
      automatic logic [31:0] crc;
      for (int unsigned i = 0; i < len; i++) bytes_q.push_back(8'(220 + i));
      crc = software_crc32(bytes_q);
      foreach (bytes_q[i]) exp_bytes.push_back(bytes_q[i]);
      exp_pkt_count++;
      fork
        begin
          for (int unsigned i = 0; i < len; i++) begin
            src_data = bytes_q[i]; src_sop = (i == 0); src_eop = (i == len - 1);
            src_crc = src_eop ? crc : 32'($urandom);
            src_valid = 1'b1;
            @(negedge src_clk);
            while (!src_taken) @(negedge src_clk);
          end
          src_valid = 1'b0;
        end
        begin
          while (!ch_busy) @(negedge axi_clk);
          ch_enable = 1'b0;
        end
      join
    end
    while (got_pkt_count < exp_pkt_count) @(negedge axi_clk);
    repeat (3) @(negedge axi_clk);
    if (ch_err !== 1'b0) begin $display("ERROR: phase3b a clean drained packet should not enter Error"); errors++; end

    // ---- phase 4: randomised packets, backpressure on both sides -------------
    ch_enable = 1'b1;
    @(negedge axi_clk);
    for (int unsigned p = 0; p < 8; p++) begin
      automatic int unsigned len = $urandom_range(1, AxiBw * 3 + 4);
      automatic bit send_done = 1'b0;
      automatic int unsigned bytes_before = got_bytes.size();
      fork
        begin
          send_packet(len, 1'b0, 1'b1);
          send_done = 1'b1;
        end
        begin
          while (!send_done) begin
            beat_ready = ($urandom_range(0, 99) < 70);
            @(negedge axi_clk);
          end
          beat_ready = 1'b1;
        end
      join
      while (got_pkt_count < exp_pkt_count) @(negedge axi_clk);
      if (got_bytes.size() - bytes_before !== len) begin
        $display("ERROR: phase4 packet %0d (len=%0d) delivered %0d bytes instead", p, len, got_bytes.size() - bytes_before);
        errors++;
      end
    end

    if (got_bytes.size() != exp_bytes.size()) begin
      $display("ERROR: final byte count got %0d expected %0d", got_bytes.size(), exp_bytes.size());
      errors++;
    end else begin
      foreach (exp_bytes[i]) if (got_bytes[i] !== exp_bytes[i]) begin
        $display("ERROR: final byte %0d mismatch got %0h expected %0h", i, got_bytes[i], exp_bytes[i]);
        errors++;
      end
    end
    if (got_pkt_count !== exp_pkt_count) begin
      $display("ERROR: final packet count got %0d expected %0d", got_pkt_count, exp_pkt_count);
      errors++;
    end

    $display("");
    $display("[CHAN_TOP_TB] packets=%0d bytes=%0d", exp_pkt_count, exp_bytes.size());
    if (errors == 0) begin $display("[CHAN_TOP_TB] PASS"); $finish; end
    else begin $display("[CHAN_TOP_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_chan_top failed"); end
  end

  initial begin #4_000_000; $fatal(1, "tb_chan_top timeout"); end

endmodule
