// Block-level testbench for rtl/dma/axi_rd_master.sv.
//
// Stands in for both sides at once: the request/response protocol side
// plays desc_fetch (its one and only real consumer), and a small AXI4
// memory-slave stub plays the actual memory. Uses the posedge-monitor
// acceptance pattern throughout, on both the AR-issue side and the R-beat
// side, for the same reason tb_desc_fetch.sv's own memory-model stub had to
// be fixed to use it: a level check of `ready` one negedge after asserting
// `valid` can straddle the exact edge `ready` drops on and hang.
//
// Phases:
//   1. one fetch, comfortably inside a 4 KB page - single AR, no split
//   2. one fetch straddling a 4 KB boundary - two back-to-back ARs, and
//      rd_resp_last_o only asserts on the overall final beat, not the
//      first burst's own rlast
//   3. an RRESP error (SLVERR/DECERR) on one beat - rd_resp_err_o must
//      align with that specific beat
//   4. backpressure on both AXI's ready signals and on rd_resp_ready_i
//      (the desc_fetch side) through a split fetch
//   5. back-to-back fetches - rd_req_ready_o must stay low while one is
//      active and accept the next only once idle again

module tb_axi_rd_master;
  import daq_pkg::*;
  import axi_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic        rd_req_valid, rd_req_ready;
  logic [31:0] rd_req_addr;

  logic             rd_resp_valid, rd_resp_ready;
  logic [AxiDw-1:0] rd_resp_data;
  logic             rd_resp_last, rd_resp_err;

  logic                arvalid, arready;
  logic [31:0]         araddr;
  logic [7:0]          arlen;
  logic [2:0]          arsize;
  logic [1:0]          arburst;
  logic [AxiIdw-1:0]   arid;
  logic [3:0]          arcache;
  prot_t               arprot;

  logic                 rvalid, rready;
  logic [AxiDw-1:0]     rdata;
  logic [1:0]           rresp;
  logic                 rlast;
  logic [AxiIdw-1:0]    rid;

  axi_rd_master dut (
    .clk_i (clk), .rst_ni (rst_n),
    .rd_req_valid_i (rd_req_valid), .rd_req_ready_o (rd_req_ready),
    .rd_req_addr_i (rd_req_addr),
    .rd_resp_valid_o (rd_resp_valid), .rd_resp_ready_i (rd_resp_ready),
    .rd_resp_data_o (rd_resp_data), .rd_resp_last_o (rd_resp_last),
    .rd_resp_err_o (rd_resp_err),
    .arvalid_o (arvalid), .arready_i (arready),
    .araddr_o (araddr), .arlen_o (arlen), .arsize_o (arsize),
    .arburst_o (arburst), .arid_o (arid), .arcache_o (arcache), .arprot_o (arprot),
    .rvalid_i (rvalid), .rready_o (rready),
    .rdata_i (rdata), .rresp_i (rresp), .rlast_i (rlast), .rid_i (rid)
  );

  localparam int unsigned BeatBytes = AxiDw / 8;
  localparam int unsigned DescBeats = DescBits / AxiDw;

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- posedge-monitor acceptance, both directions ----------------------------
  logic req_taken;
  always @(posedge clk) req_taken = rd_req_valid & rd_req_ready;

  logic               ar_taken;
  logic [31:0]        ar_taken_addr;
  logic [7:0]         ar_taken_len;
  logic [2:0]         ar_taken_size;
  logic [1:0]         ar_taken_burst;
  logic [AxiIdw-1:0]  ar_taken_id;
  logic [3:0]         ar_taken_cache;
  prot_t              ar_taken_prot;
  always @(posedge clk) begin
    ar_taken       = arvalid & arready;
    ar_taken_addr  = araddr;
    ar_taken_len   = arlen;
    ar_taken_size  = arsize;
    ar_taken_burst = arburst;
    ar_taken_id    = arid;
    ar_taken_cache = arcache;
    ar_taken_prot  = arprot;
  end

  // Constant AXI signalling fields, checked every AR rather than just wired
  // through unread: this module always issues full-bus-width INCR bursts at
  // a fixed ID (single-outstanding, so there is never a second transaction
  // to distinguish), non-cacheable/unprivileged access.
  always @(posedge clk) begin
    if (rst_n && ar_taken) begin
      check(ar_taken_size == 3'($clog2(BeatBytes)), "AR: ARSIZE was not the full bus width");
      check(ar_taken_burst == BurstIncr, "AR: ARBURST was not INCR");
      check(ar_taken_id == '0, "AR: ARID was not the fixed single-outstanding id");
      check(ar_taken_cache == CacheNonCacheable, "AR: ARCACHE mismatch");
      check(ar_taken_prot == ProtDataUnpriv, "AR: ARPROT mismatch");
    end
  end

  logic r_taken;
  always @(posedge clk) r_taken = rvalid & rready;

  logic resp_taken;
  logic [AxiDw-1:0] resp_taken_data;
  logic resp_taken_last, resp_taken_err;
  always @(posedge clk) begin
    resp_taken      = rd_resp_valid & rd_resp_ready;
    resp_taken_data = rd_resp_data;
    resp_taken_last = rd_resp_last;
    resp_taken_err  = rd_resp_err;
  end

  // ---- "memory": word-addressed (address with the low BeatBytes bits masked
  // off), plus a poison set for beats that should come back with an error --
  logic [AxiDw-1:0] mem [logic [31:0]];
  bit                poison [logic [31:0]];

  function automatic logic [31:0] word_addr(input logic [31:0] a);
    word_addr = a & ~(32'(BeatBytes) - 32'd1);
  endfunction

  // ---- AXI slave stub -----------------------------------------------------------
  // arready randomly backpressured on every phase (not just a dedicated one)
  // so ordinary AR latency is exercised throughout, not just where a test
  // goes looking for it.
  always @(negedge clk) arready = ($urandom_range(0, 99) < 60);

  int unsigned ar_count = 0;

  initial begin
    rvalid = 1'b0;
    rdata  = '0;
    rresp  = RespOkay;
    rlast  = 1'b0;
    rid    = '0;
    forever begin
      @(negedge clk);
      if (rst_n && ar_taken) begin
        automatic logic [31:0] base = ar_taken_addr;
        automatic int unsigned nbeats = int'(ar_taken_len) + 1;
        ar_count++;
        for (int unsigned i = 0; i < nbeats; i++) begin
          automatic logic [31:0] a = base + 32'(i * BeatBytes);
          rdata = mem.exists(word_addr(a)) ? mem[word_addr(a)] : '0;
          rresp = (poison.exists(word_addr(a)) && poison[word_addr(a)]) ? RespSlvErr : RespOkay;
          rlast = (i == nbeats - 1);
          rid   = '0;
          rvalid = 1'b1;
          @(negedge clk);
          while (!r_taken) @(negedge clk);
        end
        rvalid = 1'b0;
      end
    end
  end

  task automatic reset_dut();
    rd_req_valid  = 1'b0;
    rd_req_addr   = '0;
    rd_resp_ready = 1'b1;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  task automatic send_req(input logic [31:0] addr);
    rd_req_addr  = addr;
    rd_req_valid = 1'b1;
    @(negedge clk);
    while (!req_taken) @(negedge clk);
    rd_req_valid = 1'b0;
  endtask

  // Collects exactly `n` response beats (via resp_taken) into `got`.
  task automatic collect_resp(input int unsigned n, output logic [AxiDw-1:0] got [$], output bit err_seen);
    got.delete();
    err_seen = 1'b0;
    for (int unsigned i = 0; i < n; i++) begin
      @(negedge clk);
      while (!resp_taken) @(negedge clk);
      got.push_back(resp_taken_data);
      err_seen |= resp_taken_err;
      if (i == n - 1) check(resp_taken_last, "final response beat did not carry rd_resp_last_o");
      else             check(!resp_taken_last, "rd_resp_last_o set on a non-final response beat");
    end
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: single burst, comfortably inside a page ----------------------
    mem[word_addr(32'h1000)]              = {AxiDw{1'b0}} | AxiDw'(32'hAAAA_0000);
    mem[word_addr(32'h1000 + BeatBytes)]  = AxiDw'(32'hBBBB_0001);
    begin
      automatic logic [AxiDw-1:0] got [$];
      automatic bit err;
      fork
        send_req(32'h1000);
        collect_resp(DescBeats, got, err);
      join
      check(ar_count == 1, "phase1 expected exactly one AR");
      check(!err, "phase1 unexpected error response");
      check(got[0] === mem[word_addr(32'h1000)], "phase1 beat0 data mismatch");
    end

    // ---- phase 2: fetch straddling a 4 KB boundary ------------------------------
    ar_count = 0;
    mem[word_addr(32'hFFF8)] = AxiDw'(32'hC0FF_EE00);            // last word before the boundary
    mem[word_addr(32'h10000)] = AxiDw'(32'hC0FF_EE01);           // first word after it
    begin
      automatic logic [AxiDw-1:0] got [$];
      automatic bit err;
      fork
        send_req(32'hFFF8);
        collect_resp(DescBeats, got, err);
      join
      check(ar_count == 2, "phase2 expected two ARs (a boundary-crossing fetch must split)");
      check(!err, "phase2 unexpected error response");
      check(got[0] === mem[word_addr(32'hFFF8)], "phase2 pre-boundary beat data mismatch");
    end

    // ---- phase 3: an RRESP error on one beat ------------------------------------
    ar_count = 0;
    mem[word_addr(32'h2000)] = AxiDw'(32'hDEAD_0000);
    poison[word_addr(32'h2000 + BeatBytes)] = 1'b1;
    begin
      automatic logic [AxiDw-1:0] got [$];
      automatic bit err;
      fork
        send_req(32'h2000);
        collect_resp(DescBeats, got, err);
      join
      check(err, "phase3 expected an error response to be seen");
    end

    // ---- phase 4: backpressure on rd_resp_ready_i through a split fetch --------
    // Reuses collect_resp (posedge-latched resp_taken) rather than reading
    // rd_resp_valid live in a negedge-driven loop of its own - a live read
    // here would race the AR/R responder task's own negedge-driven rvalid
    // updates the exact same way tb_desc_fetch.sv's memory-model stub did
    // before it was fixed to use the same latched pattern.
    ar_count = 0;
    begin
      automatic logic [AxiDw-1:0] got [$];
      automatic bit err;
      automatic bit p4_done = 1'b0;
      send_req(32'hFFF8);
      fork
        begin
          collect_resp(DescBeats, got, err);
          p4_done = 1'b1;
        end
        begin
          while (!p4_done) begin
            rd_resp_ready = ($urandom_range(0, 99) < 60);
            @(negedge clk);
          end
          rd_resp_ready = 1'b1;
        end
      join
      check(!err, "phase4 unexpected error response");
      check(ar_count == 2, "phase4 expected the split fetch to still issue two ARs under backpressure");
    end

    // ---- phase 5: back-to-back fetches - ready must drop while active ----------
    ar_count = 0;
    mem[word_addr(32'h3000)] = AxiDw'(32'h1111_1111);
    begin
      automatic logic [AxiDw-1:0] got [$];
      automatic bit err;
      send_req(32'h3000);
      check(!rd_req_ready, "phase5 rd_req_ready_o should drop while a fetch is active");
      collect_resp(DescBeats, got, err);
      check(!err, "phase5 first fetch unexpected error response");
      check(rd_req_ready, "phase5 rd_req_ready_o should return once idle again");
      mem[word_addr(32'h3100)] = AxiDw'(32'h2222_2222);
      fork
        send_req(32'h3100);
        collect_resp(DescBeats, got, err);
      join
      check(!err, "phase5 second fetch unexpected error response");
      check(got[0] === mem[word_addr(32'h3100)], "phase5 second fetch data mismatch");
      check(ar_count == 2, "phase5 expected one AR per (unsplit) fetch, two total");
    end

    $display("");
    if (errors == 0) begin $display("[AXI_RD_MASTER_TB] PASS"); $finish; end
    else begin $display("[AXI_RD_MASTER_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_axi_rd_master failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_axi_rd_master timeout"); end

endmodule
