// Block-level testbench for rtl/dma/dma_sched.sv.
//
// Built at NumCh=4 (+define+DAQ_NUM_CH=4) - enough channels to force real
// contention (two, three, and four-way) without the sweep's own NumCh=8
// default making every scenario's fork/join bookkeeping unwieldy. The
// parameter sweep in scripts/run_lint.ps1 still elaborates this module at
// NumCh ∈ {1,2,8}; this TB's own job is arbitration behaviour, not the
// sweep's job of catching non-parameterised code.
//
// dma_sched is single-clock (no CDC of its own - each channel's chan_top has
// already crossed into axi_clk before this module ever sees a beat), so
// unlike tb_chan_top.sv there is only one posedge-monitor acceptance domain
// here, not two.
//
// What "correct" means for an arbiter, and how each phase pins it down:
//   - data integrity: every beat a channel offers arrives at the merged
//     output tagged with that channel's index, in the same order, unchanged.
//   - the lock invariant: once a channel's sop beat is accepted, the merged
//     output belongs to that channel and no other until that same channel's
//     own eop beat is accepted - checked continuously (every accepted output
//     beat), not just in the phases aimed at provoking a violation.
//   - fairness in the informal sense actually usable in a block TB: everyone
//     who kept offering packets eventually got serviced in one run. Proving
//     prim_arbiter_tree's own round-robin fairness bound is that primitive's
//     job (FPV-only assertions in its own file), not re-litigated here.
//
// Phases:
//   1. one channel alone - basic passthrough, tagged correctly
//   2. two channels present sop the same cycle - exactly one wins, the loser
//      holds and is serviced whole and intact right after, never interleaved
//   3. mid-packet contention - a second channel's sop appears while another
//      is already locked multiple beats in; the second channel must not be
//      accepted until the first's own eop passes
//   4. backpressure - out_ready_i toggled randomly through a multi-beat
//      locked packet; the lock must survive stalls and resume correctly
//   5. single-beat packet (sop=eop the same beat) immediately followed by a
//      different channel's sop - the lock must release the same cycle it is
//      won, not linger an extra idle cycle
//   6. randomised stress - all four channels each push several packets of
//      random length with random inter-packet gaps, backpressure toggling
//      throughout, full per-channel scoreboard at the end

module tb_dma_sched;
  import daq_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0] ch_valid, ch_ready, ch_sop, ch_eop;
  logic [AxiDw-1:0] ch_data [NumCh];
  logic [AxiBw-1:0] ch_strb [NumCh];

  logic             out_valid, out_ready, out_sop, out_eop;
  logic [AxiDw-1:0] out_data;
  logic [AxiBw-1:0] out_strb;
  logic [ChIdxW-1:0] out_ch;

  dma_sched dut (
    .clk_i (clk), .rst_ni (rst_n),
    .ch_valid_i (ch_valid), .ch_ready_o (ch_ready),
    .ch_data_i (ch_data), .ch_strb_i (ch_strb),
    .ch_sop_i (ch_sop), .ch_eop_i (ch_eop),
    .out_valid_o (out_valid), .out_ready_i (out_ready),
    .out_data_o (out_data), .out_strb_o (out_strb),
    .out_sop_o (out_sop), .out_eop_o (out_eop),
    .out_ch_o (out_ch)
  );

  // ---- posedge-monitor acceptance pattern (project convention) ---------------
  logic [NumCh-1:0] ch_taken;
  always @(posedge clk) ch_taken = ch_valid & ch_ready;

  logic out_taken;
  always @(posedge clk) out_taken = out_valid & out_ready;

  // Module-level (not automatic-inside-a-block) because phase 6 forks
  // per-channel driver processes with join_none - they outlive the block
  // scope that spawns them, so the flags they set on completion need
  // program lifetime, not the enclosing begin/end's.
  bit stress_done [NumCh];

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- scoreboard ---------------------------------------------------------------
  typedef struct packed {
    logic [AxiDw-1:0] data;
    logic [AxiBw-1:0] strb;
    logic             sop;
    logic             eop;
  } beat_t;

  beat_t       exp_q [NumCh][$];
  beat_t       got_q [NumCh][$];
  int unsigned exp_pkt_count [NumCh];
  int unsigned got_pkt_count [NumCh];

  bit                out_in_pkt;
  logic [ChIdxW-1:0] out_in_ch;

  always @(posedge clk) begin
    if (rst_n) begin
      // Structurally this is already onehot0 from dma_sched's own
      // always_comb (it only ever sets one bit), but checking it from the
      // TB's own observation catches a regression rather than trusting the
      // design under test to police itself.
      check($onehot0(ch_ready), "more than one channel's ready asserted at once");
    end
    if (rst_n && out_taken) begin
      if (!out_in_pkt) begin
        check(out_sop === 1'b1, "first beat of a new merged-output packet did not carry sop");
        out_in_ch = out_ch;
      end else begin
        check(out_ch === out_in_ch, "merged output switched channel mid-packet - lock violated");
        check(out_sop === 1'b0, "sop set on a non-first beat of an already-locked packet");
      end
      out_in_pkt = out_eop ? 1'b0 : 1'b1;
      got_q[out_ch].push_back('{out_data, out_strb, out_sop, out_eop});
      if (out_eop) got_pkt_count[out_ch]++;
    end
  end

  // ---- drivers ------------------------------------------------------------------
  task automatic reset_dut();
    ch_valid = '0; ch_sop = '0; ch_eop = '0;
    for (int unsigned c = 0; c < NumCh; c++) begin ch_data[c] = '0; ch_strb[c] = '0; end
    out_ready = 1'b1;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  task automatic drive_beat(input logic [ChIdxW-1:0] ch, input beat_t b);
    ch_data[ch] = b.data; ch_strb[ch] = b.strb; ch_sop[ch] = b.sop; ch_eop[ch] = b.eop;
    ch_valid[ch] = 1'b1;
    @(negedge clk);
    while (!ch_taken[ch]) @(negedge clk);
    ch_valid[ch] = 1'b0;
  endtask

  logic [15:0] pkt_id = 16'h0;

  task automatic send_packet(input logic [ChIdxW-1:0] ch, input int unsigned len);
    automatic logic [15:0] id = pkt_id;
    pkt_id = pkt_id + 16'h1;
    for (int unsigned i = 0; i < len; i++) begin
      automatic beat_t b;
      // A 16-bit packet id and an 8-bit beat index, zero-extended - fits
      // comfortably even at the sweep's narrowest AxiDw (32) even though
      // this TB itself always builds at the package default (64).
      b.data = AxiDw'({id, i[7:0]});
      b.strb = '1;
      b.sop  = (i == 0);
      b.eop  = (i == len - 1);
      exp_q[ch].push_back(b);
      drive_beat(ch, b);
    end
    exp_pkt_count[ch]++;
  endtask

  task automatic check_channel(input int unsigned ch);
    check(got_q[ch].size() == exp_q[ch].size(),
          $sformatf("ch%0d beat count got %0d expected %0d", ch, got_q[ch].size(), exp_q[ch].size()));
    if (got_q[ch].size() == exp_q[ch].size()) begin
      foreach (exp_q[ch][i]) begin
        if (got_q[ch][i] !== exp_q[ch][i]) begin
          $display("ERROR: ch%0d beat %0d mismatch got %p expected %p", ch, i, got_q[ch][i], exp_q[ch][i]);
          errors++;
        end
      end
    end
    check(got_pkt_count[ch] == exp_pkt_count[ch],
          $sformatf("ch%0d packet count got %0d expected %0d", ch, got_pkt_count[ch], exp_pkt_count[ch]));
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: one channel alone -------------------------------------------
    send_packet(0, 3);
    check_channel(0);

    // ---- phase 2: two channels contend for sop the same cycle -----------------
    // Both branches start in the same delta cycle, so both channels present
    // their sop beat simultaneously - a real tie, not a staggered request.
    fork
      send_packet(1, 4);
      send_packet(2, 3);
    join
    check_channel(1);
    check_channel(2);

    // ---- phase 3: mid-packet contention ----------------------------------------
    // ch3 starts a long packet alone; only once it is genuinely locked
    // (whitebox check on dut's own lock state, same style tb_chan_top.sv
    // already uses on chan_ctrl's internals) does ch0 present a new packet's
    // sop, so this exercises "someone else's sop shows up mid-flight," not
    // just another initial-tie race.
    fork
      send_packet(3, 5);
      begin
        wait (dut.locked_q && dut.locked_ch_q == ChIdxW'(3));
        send_packet(0, 2);
      end
    join
    check_channel(3);
    check_channel(0);

    // ---- phase 4: backpressure through a locked multi-beat packet -------------
    begin
      automatic bit send_done = 1'b0;
      fork
        begin
          send_packet(1, 6);
          send_done = 1'b1;
        end
        begin
          while (!send_done) begin
            out_ready = ($urandom_range(0, 99) < 60);
            @(negedge clk);
          end
          out_ready = 1'b1;
        end
      join
    end
    check_channel(1);

    // ---- phase 5: single-beat packet must release the lock immediately --------
    send_packet(2, 1);
    check(!dut.locked_q, "single-beat packet left dma_sched locked instead of releasing immediately");
    send_packet(3, 2);
    check_channel(2);
    check_channel(3);

    // ---- phase 6: randomised multi-channel stress ------------------------------
    for (int unsigned c = 0; c < NumCh; c++) stress_done[c] = 1'b0;
    fork
      for (int unsigned c = 0; c < NumCh; c++) begin
        automatic logic [ChIdxW-1:0] cc = ChIdxW'(c);
        fork
          begin
            for (int unsigned p = 0; p < 5; p++) begin
              send_packet(cc, $urandom_range(1, 6));
              repeat ($urandom_range(0, 3)) @(negedge clk);
            end
            stress_done[cc] = 1'b1;
          end
        join_none
      end
      begin
        automatic bit all_done;
        do begin
          out_ready = ($urandom_range(0, 99) < 65);
          @(negedge clk);
          all_done = 1'b1;
          for (int unsigned c = 0; c < NumCh; c++) if (!stress_done[c]) all_done = 1'b0;
        end while (!all_done);
        out_ready = 1'b1;
      end
    join
    for (int unsigned c = 0; c < NumCh; c++) check_channel(c);

    $display("");
    $display("[DMA_SCHED_TB] channels=%0d", NumCh);
    if (errors == 0) begin $display("[DMA_SCHED_TB] PASS"); $finish; end
    else begin $display("[DMA_SCHED_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_dma_sched failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_dma_sched timeout"); end

endmodule
