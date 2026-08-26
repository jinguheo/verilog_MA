// Block-level testbench for rtl/dma/desc_fetch.sv.
//
// Stands in for axi_rd_master (not built yet) with a simple associative-
// array "memory" model keyed by address, exactly the role tb_chan_top.sv
// played for dma_sched and tb_dma_sched.sv played for axi_wr_master before
// each of those existed. Built at NumCh=4 (+define+DAQ_NUM_CH=4), same
// reasoning as tb_dma_sched.sv: enough channels for real multi-channel
// fetch contention without NumCh=8's bookkeeping overhead.
//
// Phases:
//   1. one channel, one descriptor (last=1) - fetch, deliver, consume,
//      confirm it halts rather than auto-refetching
//   2. ring walk - two linearly-addressed descriptors (no link), auto-
//      continuing after the first's transfer completes
//   3. link jump - a descriptor with ctrl.link set sends the walk to
//      next_ptr instead of the linear address
//   4. descriptor errors - alignment, zero length, over-max length,
//      valid=0, and an AXI read error on the fetch itself - each must halt
//      the channel with the right daq_pkg::err_e code and never present a
//      descriptor as valid
//   5. abort mid-ring clears the error/halts without auto-resuming; only a
//      fresh go actually restarts the walk, and it restarts clean (refetches
//      from the ring's own base, not wherever the abort caught it)
//   6. multi-channel contention - two channels both need a fetch the same
//      cycle; both must eventually be serviced (no starvation in this run)

module tb_desc_fetch;
  import daq_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0] ch_enable, ch_abort, ch_desc_go;
  logic [31:0]      ch_desc_base [NumCh];

  logic              xfer_done;
  logic [ChIdxW-1:0] xfer_done_ch;

  logic              rd_req_valid, rd_req_ready;
  logic [31:0]       rd_req_addr;

  logic              rd_resp_valid, rd_resp_ready;
  logic [AxiDw-1:0]  rd_resp_data;
  logic              rd_resp_last, rd_resp_err;

  logic [NumCh-1:0] ch_desc_valid;
  logic [31:0]      ch_desc_addr   [NumCh];
  logic [31:0]      ch_desc_maxlen [NumCh];
  logic [NumCh-1:0] ch_err;
  err_e             ch_err_code    [NumCh];

  desc_fetch dut (
    .clk_i (clk), .rst_ni (rst_n),
    .ch_enable_i (ch_enable), .ch_abort_i (ch_abort),
    .ch_desc_base_i (ch_desc_base), .ch_desc_go_i (ch_desc_go),
    .xfer_done_i (xfer_done), .xfer_done_ch_i (xfer_done_ch),
    .rd_req_valid_o (rd_req_valid), .rd_req_ready_i (rd_req_ready),
    .rd_req_addr_o (rd_req_addr),
    .rd_resp_valid_i (rd_resp_valid), .rd_resp_ready_o (rd_resp_ready),
    .rd_resp_data_i (rd_resp_data), .rd_resp_last_i (rd_resp_last),
    .rd_resp_err_i (rd_resp_err),
    .ch_desc_valid_o (ch_desc_valid), .ch_desc_addr_o (ch_desc_addr),
    .ch_desc_maxlen_o (ch_desc_maxlen),
    .ch_err_o (ch_err), .ch_err_code_o (ch_err_code)
  );


  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- "memory": address -> packed descriptor bits, plus a poison set for
  // addresses that should come back with an AXI read error -------------------
  localparam int unsigned DescBeats = DescBits / AxiDw;

  logic [DescBits-1:0] mem [logic [31:0]];
  bit                   poison [logic [31:0]];

  function automatic logic [DescBits-1:0] mk_desc(
    input logic [31:0] addr, input logic [31:0] length,
    input bit valid, input bit last, input bit link, input logic [31:0] next_ptr
  );
    automatic desc_ctrl_t ctrl;
    automatic desc_t      d;
    ctrl = '{tag: 16'h0, rsvd: 12'h0, link: link, last: last, irq_en: 1'b0, valid: valid};
    d = '{next_ptr: next_ptr, ctrl: ctrl, length: length, addr: addr};
    mk_desc = DescBits'(d);
  endfunction

  // ---- axi_rd_master stand-in: accepts every request immediately, streams
  // back DescBeats response beats (fixed one-cycle-apart, no backpressure of
  // its own - exercising rd_resp_ready_o's own backpressure handling is
  // desc_fetch's job to get right regardless, not this stub's job to prove) -
  assign rd_req_ready = 1'b1;

  // Posedge-monitor acceptance pattern (project convention, used everywhere
  // else in this repo's TBs): latch the accept decision and the address at
  // the same posedge desc_fetch's own FSM uses to decide it, rather than
  // reading rd_req_valid/rd_req_addr live from a negedge-triggered process.
  // A live read raced against go()'s own negedge-triggered continuation
  // (which clears ch_desc_go_i at the very negedge this stub also wakes on)
  // and could miss the one-cycle request window entirely depending on which
  // of the two same-time processes Verilator happened to run first.
  logic        req_taken;
  logic [31:0] req_taken_addr;
  always @(posedge clk) begin
    req_taken      = rd_req_valid & rd_req_ready;
    req_taken_addr = rd_req_addr;
  end

  // Same pattern on the response side: a beat is only actually consumed when
  // valid and ready are both true AT the posedge desc_fetch samples them,
  // not whenever rd_resp_ready_o's level happens to read 1 at some later
  // negedge this stub gets around to checking - rd_resp_ready_o can (and,
  // for the last beat of a fetch, does) drop the very same edge it accepts,
  // so a level check one negedge later can straddle a completely different
  // fetch's own ready window and falsely believe the earlier beat was just
  // now accepted.
  logic resp_taken;
  always @(posedge clk) resp_taken = rd_resp_valid & rd_resp_ready;

  initial begin
    rd_resp_valid = 1'b0;
    rd_resp_data  = '0;
    rd_resp_last  = 1'b0;
    rd_resp_err   = 1'b0;
    forever begin
      @(negedge clk);
      if (rst_n && req_taken) begin
        automatic logic [31:0] addr = req_taken_addr;
        automatic logic [DescBits-1:0] bits = mem.exists(addr) ? mem[addr] : '0;
        automatic bit err = poison.exists(addr) && poison[addr];
        for (int unsigned i = 0; i < DescBeats; i++) begin
          rd_resp_data  = bits[i*AxiDw+:AxiDw];
          rd_resp_last  = (i == DescBeats - 1);
          rd_resp_err   = err;
          rd_resp_valid = 1'b1;
          @(negedge clk);
          while (!resp_taken) @(negedge clk);
        end
        rd_resp_valid = 1'b0;
      end
    end
  end

  task automatic reset_dut();
    ch_enable = '0; ch_abort = '0; ch_desc_go = '0;
    for (int unsigned c = 0; c < NumCh; c++) ch_desc_base[c] = '0;
    xfer_done = 1'b0; xfer_done_ch = '0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  task automatic go(input logic [ChIdxW-1:0] ch, input logic [31:0] base);
    ch_enable[ch]    = 1'b1;
    ch_desc_base[ch] = base;
    ch_desc_go[ch]   = 1'b1;
    @(negedge clk);
    ch_desc_go[ch] = 1'b0;
  endtask

  task automatic wait_valid(input logic [ChIdxW-1:0] ch, input int unsigned guard = 200);
    automatic int unsigned n = 0;
    while (!ch_desc_valid[ch] && !ch_err[ch] && n < guard) begin
      @(negedge clk);
      n++;
    end
    check(n < guard, $sformatf("ch%0d timed out waiting for a fetched descriptor", ch));
  endtask

  task automatic done(input logic [ChIdxW-1:0] ch);
    xfer_done_ch = ch;
    xfer_done    = 1'b1;
    @(negedge clk);
    xfer_done = 1'b0;
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: one descriptor, last=1 ---------------------------------------
    mem[32'h1000] = mk_desc(32'h2000, 32'd64, 1'b1, 1'b1, 1'b0, 32'h0);
    go(0, 32'h1000);
    wait_valid(0);
    check(ch_desc_valid[0], "phase1 descriptor never became valid");
    check(ch_desc_addr[0] === 32'h2000, "phase1 addr mismatch");
    check(ch_desc_maxlen[0] === 32'd64, "phase1 maxlen mismatch");
    check(!ch_err[0], "phase1 unexpected error");
    done(0);
    @(negedge clk);
    check(!ch_desc_valid[0], "phase1 descriptor still valid after transfer done");
    repeat (10) @(negedge clk);
    check(!ch_desc_valid[0] && !ch_err[0], "phase1 last descriptor should halt, not auto-refetch");

    // ---- phase 2: linear ring walk, two descriptors ----------------------------
    mem[32'h3000] = mk_desc(32'h4000, 32'd32, 1'b1, 1'b0, 1'b0, 32'h0);
    mem[32'h3000 + DescBytes] = mk_desc(32'h5000, 32'd48, 1'b1, 1'b1, 1'b0, 32'h0);
    go(1, 32'h3000);
    wait_valid(1);
    check(ch_desc_addr[1] === 32'h4000, "phase2 first descriptor addr mismatch");
    done(1);
    wait_valid(1);
    check(ch_desc_addr[1] === 32'h5000, "phase2 second (linear) descriptor addr mismatch");
    check(ch_desc_maxlen[1] === 32'd48, "phase2 second descriptor maxlen mismatch");
    done(1);
    repeat (10) @(negedge clk);
    check(!ch_desc_valid[1] && !ch_err[1], "phase2 ring should halt after its last descriptor");

    // ---- phase 3: link jump -----------------------------------------------------
    mem[32'h6000] = mk_desc(32'h7000, 32'd16, 1'b1, 1'b0, 1'b1, 32'h9000);
    mem[32'h9000] = mk_desc(32'h8000, 32'd80, 1'b1, 1'b1, 1'b0, 32'h0);
    go(2, 32'h6000);
    wait_valid(2);
    check(ch_desc_addr[2] === 32'h7000, "phase3 first descriptor addr mismatch");
    done(2);
    wait_valid(2);
    check(ch_desc_addr[2] === 32'h8000,
          "phase3 link did not jump to next_ptr's descriptor");
    done(2);

    // ---- phase 4: descriptor errors ---------------------------------------------
    mem[32'hA001] = mk_desc(32'hA001, 32'd16, 1'b1, 1'b1, 1'b0, 32'h0);  // misaligned addr
    go(3, 32'hA001);
    wait_valid(3);
    check(ch_err[3] && ch_err_code[3] == ErrDescAlign, "phase4a expected ErrDescAlign");
    check(!ch_desc_valid[3], "phase4a a failed fetch must never present a descriptor as valid");
    ch_abort[3] = 1'b1; @(negedge clk); ch_abort[3] = 1'b0;
    check(!ch_err[3], "phase4a abort should clear the error");

    mem[32'hB000] = mk_desc(32'hB100, 32'd0, 1'b1, 1'b1, 1'b0, 32'h0);  // zero length
    go(3, 32'hB000);
    wait_valid(3);
    check(ch_err[3] && ch_err_code[3] == ErrDescLength, "phase4b expected ErrDescLength (zero)");
    ch_abort[3] = 1'b1; @(negedge clk); ch_abort[3] = 1'b0;

    // +DescAlignBytes (not a bare +4): must itself stay alignment-legal so
    // this exercises the length-range check, not a coincidental alignment
    // failure - DescMaxLength is already a round, aligned value.
    mem[32'hC000] = mk_desc(32'hC100, DescMaxLength + 32'(DescAlignBytes), 1'b1, 1'b1, 1'b0, 32'h0);  // over max
    go(3, 32'hC000);
    wait_valid(3);
    check(ch_err[3] && ch_err_code[3] == ErrDescLength, "phase4c expected ErrDescLength (over-max)");
    ch_abort[3] = 1'b1; @(negedge clk); ch_abort[3] = 1'b0;

    mem[32'hD000] = mk_desc(32'hD100, 32'd16, 1'b0, 1'b1, 1'b0, 32'h0);  // valid=0
    go(3, 32'hD000);
    wait_valid(3);
    check(ch_err[3] && ch_err_code[3] == ErrDescInvalid, "phase4d expected ErrDescInvalid");
    ch_abort[3] = 1'b1; @(negedge clk); ch_abort[3] = 1'b0;

    mem[32'hE000] = mk_desc(32'hE100, 32'd16, 1'b1, 1'b1, 1'b0, 32'h0);
    poison[32'hE000] = 1'b1;
    go(3, 32'hE000);
    wait_valid(3);
    check(ch_err[3] && ch_err_code[3] == ErrDescFetch, "phase4e expected ErrDescFetch");
    ch_abort[3] = 1'b1; @(negedge clk); ch_abort[3] = 1'b0;

    // ---- phase 5: abort mid-ring, then a clean restart --------------------------
    mem[32'hF000] = mk_desc(32'hF100, 32'd16, 1'b1, 1'b0, 1'b0, 32'h0);
    mem[32'hF000 + DescBytes] = mk_desc(32'hF200, 32'd16, 1'b1, 1'b1, 1'b0, 32'h0);
    go(0, 32'hF000);
    wait_valid(0);
    check(ch_desc_addr[0] === 32'hF100, "phase5 first descriptor addr mismatch");
    ch_abort[0] = 1'b1; @(negedge clk); ch_abort[0] = 1'b0;
    check(!ch_desc_valid[0], "phase5 abort should drop the held descriptor");
    repeat (20) @(negedge clk);
    check(!ch_desc_valid[0] && !ch_err[0],
          "phase5 an aborted channel must not silently resume fetching");
    go(0, 32'hF000);
    wait_valid(0);
    check(ch_desc_addr[0] === 32'hF100,
          "phase5 restart after abort should refetch from the ring's own base, not resume mid-ring");
    done(0);
    wait_valid(0);
    check(ch_desc_addr[0] === 32'hF200, "phase5 restart's ring walk did not continue correctly");
    done(0);

    // ---- phase 6: two channels contend for the shared fetch path ---------------
    mem[32'h11000] = mk_desc(32'h12000, 32'd8, 1'b1, 1'b1, 1'b0, 32'h0);
    mem[32'h13000] = mk_desc(32'h14000, 32'd8, 1'b1, 1'b1, 1'b0, 32'h0);
    fork
      go(1, 32'h11000);
      go(2, 32'h13000);
    join
    wait_valid(1);
    wait_valid(2);
    check(ch_desc_valid[1] && ch_desc_addr[1] === 32'h12000, "phase6 ch1 not serviced correctly");
    check(ch_desc_valid[2] && ch_desc_addr[2] === 32'h14000, "phase6 ch2 not serviced correctly");
    done(1);
    done(2);

    $display("");
    if (errors == 0) begin $display("[DESC_FETCH_TB] PASS"); $finish; end
    else begin $display("[DESC_FETCH_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_desc_fetch failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_desc_fetch timeout"); end

endmodule
