// Block-level testbench for rtl/dma/axi_wr_master.sv.
//
// Stands in for both sides at once: the beat-stream side plays dma_sched
// (its one and only source of write data), and a small AXI4 memory-slave
// stub plays the actual memory, capturing every accepted W beat and
// answering with BRESP once each burst's W beats are all in. Uses the same
// posedge-monitor acceptance pattern as tb_axi_rd_master.sv throughout, for
// the same reason: a live `ready` level check one negedge after asserting
// `valid` can straddle the exact edge `ready` drops on and hang or corrupt
// what is being captured.
//
// Phases:
//   1. one short packet, comfortably inside a page and under MaxBurst -
//      single AW, WLAST on the right beat, byte-strobe passthrough checked
//      on a deliberately partial final beat
//   2. a packet longer than MaxBurst (16 beats) - must split into two
//      bursts purely from the beat-count cap, addresses advancing correctly
//      between them, burst_done_last_o only on the second
//   3. a packet whose destination address sits one beat before a 4 KB
//      boundary - must split there even though the packet is far under
//      MaxBurst
//   4. a BRESP error (SLVERR) on one burst - burst_done_err_o must align
//      with that burst
//   5. upstream backpressure - the beat-stream side pausing mid-packet must
//      not disturb WLAST/beat-count bookkeeping
//   6. two different channels back-to-back - each must pick up its OWN
//      ch_desc_addr_i, not a stale value latched for a previous channel

module tb_axi_wr_master;
  import daq_pkg::*;
  import axi_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic              wr_valid, wr_ready;
  logic [AxiDw-1:0]  wr_data;
  logic [AxiBw-1:0]  wr_strb;
  logic              wr_sop, wr_eop;
  logic [ChIdxW-1:0] wr_ch;

  logic [31:0] ch_desc_addr    [NumCh];
  logic [31:0] ch_desc_maxlen  [NumCh];

  logic              burst_done_valid;
  logic [ChIdxW-1:0] burst_done_ch;
  logic              burst_done_err, burst_done_last;

  logic                awvalid, awready;
  logic [31:0]         awaddr;
  logic [7:0]          awlen;
  logic [2:0]          awsize;
  logic [1:0]          awburst;
  logic [AxiIdw-1:0]   awid;
  logic [3:0]          awcache;
  prot_t               awprot;

  logic                 wvalid, wready;
  logic [AxiDw-1:0]     wdata;
  logic [AxiBw-1:0]     wstrb;
  logic                 wlast;

  logic                 bvalid, bready;
  logic [1:0]           bresp;
  logic [AxiIdw-1:0]    bid;

  axi_wr_master dut (
    .clk_i (clk), .rst_ni (rst_n),
    .wr_valid_i (wr_valid), .wr_ready_o (wr_ready),
    .wr_data_i (wr_data), .wr_strb_i (wr_strb),
    .wr_sop_i (wr_sop), .wr_eop_i (wr_eop), .wr_ch_i (wr_ch),
    .ch_desc_addr_i (ch_desc_addr), .ch_desc_maxlen_i (ch_desc_maxlen),
    .burst_done_valid_o (burst_done_valid), .burst_done_ch_o (burst_done_ch),
    .burst_done_err_o (burst_done_err), .burst_done_last_o (burst_done_last),
    .awvalid_o (awvalid), .awready_i (awready),
    .awaddr_o (awaddr), .awlen_o (awlen), .awsize_o (awsize),
    .awburst_o (awburst), .awid_o (awid), .awcache_o (awcache), .awprot_o (awprot),
    .wvalid_o (wvalid), .wready_i (wready),
    .wdata_o (wdata), .wstrb_o (wstrb), .wlast_o (wlast),
    .bvalid_i (bvalid), .bready_o (bready),
    .bresp_i (bresp), .bid_i (bid)
  );

  localparam int unsigned BeatBytes = AxiDw / 8;

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- posedge-monitor acceptance, every channel -----------------------------
  //
  // Each signal's capture AND every same-edge consumer (checks, queue
  // pushes) live in the SAME always block, not split across separate
  // always @(posedge clk) blocks that both key off a shared "_taken"
  // variable. Splitting them - capture in one block, consume in another,
  // both triggered by the same edge - leaves their relative execution
  // order within that edge's delta cycle undefined: a consumer block can
  // read a "_taken" variable's PREVIOUS cycle's value if it happens to run
  // before the capture block updates it. This was caught directly: an
  // earlier version split bd_taken's capture from the queue push that
  // uses it, and phase 1's own single-burst transfer intermittently pushed
  // burst_done_last_o's value one cycle stale, hanging wait_transfer_done()
  // forever. Only signals consumed exclusively by a DIFFERENT process via
  // @(negedge clk) - genuinely one delta cycle later, not the same edge -
  // are safe to keep as a separate capture (up_taken, w_taken, b_taken
  // below, all polled from negedge-driven loops elsewhere in this file).

  logic up_taken;
  always @(posedge clk) up_taken = wr_valid & wr_ready;

  // Consumed only by the memory-slave stub below via @(negedge clk) - a
  // genuinely later delta than the posedge that sets it, so this capture
  // (unlike the check+push block right after it) is safe on its own.
  logic        aw_taken;
  logic [31:0] aw_taken_addr;
  logic [7:0]  aw_taken_len;
  always @(posedge clk) begin
    aw_taken      = awvalid & awready;
    aw_taken_addr = awaddr;
    aw_taken_len  = awlen;
  end

  logic [31:0] aw_addr_q [$];
  logic [7:0]  aw_len_q  [$];
  always @(posedge clk) begin
    automatic logic              taken = awvalid & awready;
    automatic logic [7:0]        len   = awlen;
    if (rst_n && taken) begin
      // Constant AXI signalling fields, checked every AW: full-bus-width
      // INCR bursts at a fixed ID, non-cacheable/unprivileged access - same
      // reasoning as tb_axi_rd_master.sv's AR checks.
      check(awsize == 3'($clog2(BeatBytes)), "AW: AWSIZE was not the full bus width");
      check(awburst == BurstIncr, "AW: AWBURST was not INCR");
      check(awid == '0, "AW: AWID was not the fixed single-outstanding id");
      check(awcache == CacheNonCacheable, "AW: AWCACHE mismatch");
      check(awprot == ProtDataUnpriv, "AW: AWPROT mismatch");
      aw_addr_q.push_back(awaddr);
      aw_len_q.push_back(len);
    end
  end

  logic             w_taken;
  logic [AxiDw-1:0] w_taken_data;
  logic [AxiBw-1:0] w_taken_strb;
  logic             w_taken_last;
  always @(posedge clk) begin
    w_taken      = wvalid & wready;
    w_taken_data = wdata;
    w_taken_strb = wstrb;
    w_taken_last = wlast;
  end

  logic b_taken;
  always @(posedge clk) b_taken = bvalid & bready;

  logic [ChIdxW-1:0] bd_ch_q   [$];
  bit                bd_err_q  [$];
  bit                bd_last_q [$];
  always @(posedge clk) begin
    if (rst_n && burst_done_valid) begin
      bd_ch_q.push_back(burst_done_ch);
      bd_err_q.push_back(burst_done_err);
      bd_last_q.push_back(burst_done_last);
    end
  end

  task automatic clear_queues();
    aw_addr_q.delete(); aw_len_q.delete();
    bd_ch_q.delete(); bd_err_q.delete(); bd_last_q.delete();
  endtask

  task automatic wait_transfer_done();
    while (bd_last_q.size() == 0 || bd_last_q[$] !== 1'b1) @(negedge clk);
  endtask

  // ---- "memory": word-addressed (address with the low BeatBytes bits masked
  // off), plus a poison set (keyed by a burst's own AWADDR) for bursts that
  // should come back with a BRESP error ----------------------------------------
  logic [AxiDw-1:0] mem [logic [31:0]];
  bit                poison [logic [31:0]];

  function automatic logic [31:0] word_addr(input logic [31:0] a);
    word_addr = a & ~(32'(BeatBytes) - 32'd1);
  endfunction

  // ---- AXI slave stub ---------------------------------------------------------
  // awready/wready randomly backpressured throughout, not just in a
  // dedicated phase, so ordinary latency is exercised everywhere.
  always @(negedge clk) awready = ($urandom_range(0, 99) < 60);
  always @(negedge clk) wready  = ($urandom_range(0, 99) < 60);

  int unsigned aw_count = 0;
  logic [AxiBw-1:0] last_burst_final_strb;

  initial begin
    bvalid = 1'b0;
    bresp  = RespOkay;
    bid    = '0;
    forever begin
      @(negedge clk);
      if (rst_n && aw_taken) begin
        automatic logic [31:0] base   = aw_taken_addr;
        automatic int unsigned nbeats = int'(aw_taken_len) + 1;
        aw_count++;
        for (int unsigned i = 0; i < nbeats; i++) begin
          @(negedge clk);
          while (!w_taken) @(negedge clk);
          mem[word_addr(base + 32'(i * BeatBytes))] = w_taken_data;
          if (i == nbeats - 1) begin
            check(w_taken_last, "final W beat of a burst did not carry wlast_o");
            last_burst_final_strb = w_taken_strb;
          end else begin
            check(!w_taken_last, "wlast_o set on a non-final W beat");
          end
        end
        bresp = (poison.exists(base) && poison[base]) ? RespSlvErr : RespOkay;
        bid   = '0;
        bvalid = 1'b1;
        @(negedge clk);
        while (!b_taken) @(negedge clk);
        bvalid = 1'b0;
      end
    end
  end

  task automatic reset_dut();
    wr_valid = 1'b0;
    wr_data  = '0;
    wr_strb  = '0;
    wr_sop   = 1'b0;
    wr_eop   = 1'b0;
    wr_ch    = '0;
    for (int unsigned c = 0; c < NumCh; c++) begin
      ch_desc_addr[c]   = '0;
      ch_desc_maxlen[c] = '0;
    end
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  // Sends one full packet's worth of beats (sop on the first, eop on the
  // last) on channel `ch`. `strb_last` overrides the final beat's byte
  // strobe (all other beats always send a full strobe) so callers can probe
  // partial-final-beat passthrough without complicating every other phase.
  task automatic send_packet(
      input logic [ChIdxW-1:0] ch,
      input int unsigned       n_beats,
      input logic [AxiDw-1:0]  base_data,
      input logic [AxiBw-1:0]  strb_last = {AxiBw{1'b1}}
  );
    wr_ch = ch;
    for (int unsigned i = 0; i < n_beats; i++) begin
      wr_data  = base_data + AxiDw'(i);
      wr_strb  = (i == n_beats - 1) ? strb_last : {AxiBw{1'b1}};
      wr_sop   = (i == 0);
      wr_eop   = (i == n_beats - 1);
      wr_valid = 1'b1;
      @(negedge clk);
      while (!up_taken) @(negedge clk);
    end
    wr_valid = 1'b0;
    wr_sop   = 1'b0;
    wr_eop   = 1'b0;
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: single burst, well inside a page and under MaxBurst -------
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_4000;
    ch_desc_maxlen[0] = 32'(4 * BeatBytes);
    fork
      send_packet(3'(0), 4, AxiDw'(32'hAAAA_0000), 8'h0F);
      wait_transfer_done();
    join
    check(aw_count == 1, "phase1 expected exactly one AW");
    check(aw_addr_q[0] == 32'h0000_4000, "phase1 AW address mismatch");
    check(aw_len_q[0] == 8'd3, "phase1 AWLEN should be 3 (4 beats)");
    check(bd_ch_q[0] == 3'(0), "phase1 burst_done_ch_o mismatch");
    check(!bd_err_q[0], "phase1 unexpected burst error");
    check(bd_last_q[0], "phase1 single burst should be the last");
    check(last_burst_final_strb == 8'h0F, "phase1 final beat's byte strobe was not passed through");
    check(mem[word_addr(32'h4000)] === AxiDw'(32'hAAAA_0000), "phase1 beat0 data mismatch");
    check(mem[word_addr(32'h4000 + 3 * BeatBytes)] === AxiDw'(32'hAAAA_0000) + AxiDw'(3),
          "phase1 beat3 data mismatch");

    // ---- phase 2: packet longer than MaxBurst - splits purely on the cap ----
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_5000;
    ch_desc_maxlen[0] = 32'(20 * BeatBytes);
    fork
      send_packet(3'(0), 20, AxiDw'(32'hBBBB_0000));
      wait_transfer_done();
    join
    check(aw_count == 2, "phase2 expected two AWs (MaxBurst-forced split)");
    check(aw_len_q[0] == 8'(MaxBurst - 1), "phase2 first burst should be exactly MaxBurst beats");
    check(aw_len_q[1] == 8'd3, "phase2 second burst should carry the remaining 4 beats");
    check(aw_addr_q[1] == 32'h0000_5000 + 32'(MaxBurst) * 32'(BeatBytes),
          "phase2 second AW address did not advance by the first burst's size");
    check(!bd_last_q[0], "phase2 first burst falsely signalled as the transfer's last");
    check(bd_last_q[1], "phase2 second burst should be the last");
    check(!bd_err_q[0] && !bd_err_q[1], "phase2 unexpected burst error");

    // ---- phase 3: destination address one beat before a 4 KB boundary -------
    // Chosen so bytes_to_boundary is exactly one beat, well under MaxBurst -
    // the split has to come from the boundary check, not the beat-count cap.
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_6FF8;
    ch_desc_maxlen[0] = 32'(3 * BeatBytes);
    fork
      send_packet(3'(0), 3, AxiDw'(32'hC0FF_EE00));
      wait_transfer_done();
    join
    check(aw_count == 2, "phase3 expected two AWs (boundary-forced split)");
    check(aw_len_q[0] == 8'd0, "phase3 first (pre-boundary) burst should be exactly one beat");
    check(aw_addr_q[1] == 32'h0000_7000, "phase3 second burst should start exactly at the boundary");
    check(aw_len_q[1] == 8'd1, "phase3 second burst should carry the remaining two beats");
    check(bd_last_q[1] && !bd_last_q[0], "phase3 last-burst flag on the wrong burst");

    // ---- phase 4: a BRESP error on one burst ---------------------------------
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_8000;
    ch_desc_maxlen[0] = 32'(2 * BeatBytes);
    poison[32'h0000_8000] = 1'b1;
    fork
      send_packet(3'(0), 2, AxiDw'(32'hDEAD_0000));
      wait_transfer_done();
    join
    check(bd_err_q[0], "phase4 expected the poisoned burst's error to be surfaced");

    // ---- phase 5: upstream backpressure mid-packet ---------------------------
    // send_packet already stalls wr_valid between beats via up_taken/ready
    // handshaking; drive wr_valid low for a random extra span before each
    // beat to prove WLAST/beat-count bookkeeping tolerates gaps.
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_9000;
    ch_desc_maxlen[0] = 32'(6 * BeatBytes);
    fork
      begin
        wr_ch = 3'(0);
        for (int unsigned i = 0; i < 6; i++) begin
          wr_valid = 1'b0;
          repeat ($urandom_range(0, 3)) @(negedge clk);  // real gap: wr_valid held low, not stale data
          wr_data  = AxiDw'(32'h1234_0000) + AxiDw'(i);
          wr_strb  = {AxiBw{1'b1}};
          wr_sop   = (i == 0);
          wr_eop   = (i == 5);
          wr_valid = 1'b1;
          @(negedge clk);
          while (!up_taken) @(negedge clk);
        end
        wr_valid = 1'b0;
      end
      wait_transfer_done();
    join
    check(aw_count == 1, "phase5 expected a single burst despite upstream stalls");
    check(bd_last_q[0] && !bd_err_q[0], "phase5 unexpected result after upstream backpressure");
    check(mem[word_addr(32'h9000 + 5 * BeatBytes)] === AxiDw'(32'h1234_0000) + AxiDw'(5),
          "phase5 final beat data mismatch after backpressure");

    // ---- phase 6: two channels back-to-back - each keeps its own descriptor --
    clear_queues();
    aw_count = 0;
    ch_desc_addr[0]   = 32'h0000_A000;
    ch_desc_maxlen[0] = 32'(2 * BeatBytes);
    ch_desc_addr[2]   = 32'h0000_B000;
    ch_desc_maxlen[2] = 32'(2 * BeatBytes);
    fork
      send_packet(3'(0), 2, AxiDw'(32'h0A0A_0000));
      wait_transfer_done();
    join
    check(bd_ch_q[0] == 3'(0), "phase6 first packet's burst_done_ch_o mismatch");
    check(aw_addr_q[0] == 32'h0000_A000, "phase6 first packet used the wrong descriptor address");

    clear_queues();
    aw_count = 0;
    fork
      send_packet(3'(2), 2, AxiDw'(32'h0B0B_0000));
      wait_transfer_done();
    join
    check(bd_ch_q[0] == 3'(2), "phase6 second packet's burst_done_ch_o mismatch");
    check(aw_addr_q[0] == 32'h0000_B000,
          "phase6 second packet picked up a stale descriptor address from channel 0");

    $display("");
    if (errors == 0) begin $display("[AXI_WR_MASTER_TB] PASS"); $finish; end
    else begin $display("[AXI_WR_MASTER_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_axi_wr_master failed"); end
  end

  initial begin #2_000_000; $fatal(1, "tb_axi_wr_master timeout"); end

endmodule
