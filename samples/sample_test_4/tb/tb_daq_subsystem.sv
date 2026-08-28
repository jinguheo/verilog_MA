// Smoke-level integration testbench for rtl/daq_subsystem.sv - one channel,
// one descriptor, one packet, driven entirely over the two real external
// interfaces (AXI4-Lite for configuration, the channel's own src_clk stream
// for data) with a single shared AXI4 memory model answering BOTH
// axi_rd_master's descriptor-fetch reads and axi_wr_master's payload
// writes. This is NOT the integration UVM environment PLAN.md's phase 6
// calls for (multiple channels, randomised traffic, a real scoreboard) -
// it exists to prove daq_subsystem.sv's own wiring is actually correct
// end-to-end, the thing phase 5's "full elaboration, CDC audit" gate does
// not by itself demonstrate. Built at NumCh=1 (+define+DAQ_NUM_CH=1) to
// keep the descriptor/memory bookkeeping simple; the parameter sweep
// itself is already covered by the lint gate.
//
// src_clk and clk_i run at a deliberately different period (3 vs 5, same
// non-integer-ratio convention tb_chan_top.sv already established) so the
// one real CDC crossing in this design is genuinely exercised, not
// accidentally hidden by both domains happening to tick together.
//
// Sequence:
//   1. preload the shared memory with one descriptor (valid, last, no
//      link) at DESC_BASE, destination PAYLOAD_ADDR, length one beat
//   2. configure over AXI4-Lite: CH_DESC_BASE, CH_CTRL.enable,
//      GLOBAL_CTRL.enable, then CH_DESC_CTRL.go
//   3. poll CH_STATUS.busy until desc_fetch has validated the descriptor
//      (busy is desc_valid_i as well as stream-busy - see irq_ctrl.sv)
//   4. send one CRC-correct packet on the channel's src stream, sized to
//      exactly the descriptor's length
//   5. wait for the descriptor to complete (CH_IRQ_STATE's Done cause) and
//      check: the memory model's payload address holds the sent bytes,
//      CH_BYTE_CNT/CH_PKT_CNT read back correctly, and irq_o itself only
//      asserts once IRQ_ENABLE/CH_IRQ_ENABLE actually unmask it

module tb_daq_subsystem;
  import daq_pkg::*;
  import axi_pkg::*;

  logic clk = 1'b0;
  always #5 clk = ~clk;         // period 10
  logic src_clk = 1'b0;
  always #3 src_clk = ~src_clk; // period 6 - non-integer ratio vs clk
  logic rst_n = 1'b0;

  localparam int unsigned BeatBytes = AxiDw / 8;

  // ---- AXI4-Lite (CSR) ---------------------------------------------------------
  logic [AxilAw-1:0] awaddr;  logic awvalid, awready;
  logic [AxilDw-1:0] wdata;   logic [(AxilDw/8)-1:0] wstrb; logic wvalid, wready;
  logic [1:0]        bresp;   logic bvalid, bready;
  logic [AxilAw-1:0] araddr;  logic arvalid, arready;
  logic [AxilDw-1:0] rdata;   logic [1:0] rresp; logic rvalid, rready;

  // ---- per-channel source stream (NumCh=1) -------------------------------------
  logic [NumCh-1:0] src_clk_bus;
  assign src_clk_bus = {NumCh{src_clk}};
  logic [NumCh-1:0]  src_valid, src_ready, src_sop, src_eop;
  logic [SrcDw-1:0]  src_data [NumCh];
  logic [31:0]       src_crc  [NumCh];

  // ---- AXI4 read master port ----------------------------------------------------
  logic                arvalid_m, arready_m;
  logic [31:0]         araddr_m;
  logic [7:0]          arlen_m;
  logic [2:0]          arsize_m;
  logic [1:0]          arburst_m;
  logic [AxiIdw-1:0]   arid_m;
  logic [3:0]          arcache_m;
  prot_t               arprot_m;
  logic                 rvalid_m, rready_m;
  logic [AxiDw-1:0]     rdata_m;
  logic [1:0]           rresp_m;
  logic                 rlast_m;
  logic [AxiIdw-1:0]    rid_m;

  // ---- AXI4 write master port ---------------------------------------------------
  logic                awvalid_m, awready_m;
  logic [31:0]         awaddr_m;
  logic [7:0]          awlen_m;
  logic [2:0]          awsize_m;
  logic [1:0]          awburst_m;
  logic [AxiIdw-1:0]   awid_m;
  logic [3:0]          awcache_m;
  prot_t               awprot_m;
  logic                 wvalid_m, wready_m;
  logic [AxiDw-1:0]     wdata_m;
  logic [AxiBw-1:0]     wstrb_m;
  logic                 wlast_m;
  logic                 bvalid_m, bready_m;
  logic [1:0]           bresp_m;
  logic [AxiIdw-1:0]    bid_m;

  logic irq;

  daq_subsystem dut (
    .clk_i (clk), .rst_ni (rst_n),
    .src_clk_i (src_clk_bus),
    .src_valid_i (src_valid), .src_ready_o (src_ready),
    .src_data_i (src_data), .src_sop_i (src_sop), .src_eop_i (src_eop), .src_crc_i (src_crc),
    .s_axil_awaddr_i (awaddr), .s_axil_awvalid_i (awvalid), .s_axil_awready_o (awready),
    .s_axil_wdata_i (wdata), .s_axil_wstrb_i (wstrb), .s_axil_wvalid_i (wvalid), .s_axil_wready_o (wready),
    .s_axil_bresp_o (bresp), .s_axil_bvalid_o (bvalid), .s_axil_bready_i (bready),
    .s_axil_araddr_i (araddr), .s_axil_arvalid_i (arvalid), .s_axil_arready_o (arready),
    .s_axil_rdata_o (rdata), .s_axil_rresp_o (rresp), .s_axil_rvalid_o (rvalid), .s_axil_rready_i (rready),
    .m_axi_arvalid_o (arvalid_m), .m_axi_arready_i (arready_m),
    .m_axi_araddr_o (araddr_m), .m_axi_arlen_o (arlen_m), .m_axi_arsize_o (arsize_m),
    .m_axi_arburst_o (arburst_m), .m_axi_arid_o (arid_m), .m_axi_arcache_o (arcache_m), .m_axi_arprot_o (arprot_m),
    .m_axi_rvalid_i (rvalid_m), .m_axi_rready_o (rready_m),
    .m_axi_rdata_i (rdata_m), .m_axi_rresp_i (rresp_m), .m_axi_rlast_i (rlast_m), .m_axi_rid_i (rid_m),
    .m_axi_awvalid_o (awvalid_m), .m_axi_awready_i (awready_m),
    .m_axi_awaddr_o (awaddr_m), .m_axi_awlen_o (awlen_m), .m_axi_awsize_o (awsize_m),
    .m_axi_awburst_o (awburst_m), .m_axi_awid_o (awid_m), .m_axi_awcache_o (awcache_m), .m_axi_awprot_o (awprot_m),
    .m_axi_wvalid_o (wvalid_m), .m_axi_wready_i (wready_m),
    .m_axi_wdata_o (wdata_m), .m_axi_wstrb_o (wstrb_m), .m_axi_wlast_o (wlast_m),
    .m_axi_bvalid_i (bvalid_m), .m_axi_bready_o (bready_m),
    .m_axi_bresp_i (bresp_m), .m_axi_bid_i (bid_m),
    .irq_o (irq)
  );

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- AXI4-Lite driver (clk domain), same shape as tb_daq_csr.sv's own -------

  logic aw_taken, w_taken, b_taken, ar_taken, r_taken;
  always @(posedge clk) aw_taken = awvalid & awready;
  always @(posedge clk) w_taken  = wvalid  & wready;
  always @(posedge clk) b_taken  = bvalid  & bready;
  always @(posedge clk) ar_taken = arvalid & arready;
  always @(posedge clk) r_taken  = rvalid  & rready;

  task automatic axil_write(input logic [AxilAw-1:0] a, input logic [AxilDw-1:0] d,
                             input logic [(AxilDw/8)-1:0] s, output logic [1:0] resp);
    awaddr = a; awvalid = 1'b1;
    wdata  = d; wstrb = s; wvalid = 1'b1;
    bready = 1'b1;
    do @(negedge clk); while (!aw_taken);
    awvalid = 1'b0;
    if (!w_taken) do @(negedge clk); while (!w_taken);
    wvalid = 1'b0;
    if (!b_taken) do @(negedge clk); while (!b_taken);
    resp = bresp;
    bready = 1'b0;
  endtask

  task automatic axil_read(input logic [AxilAw-1:0] a, output logic [AxilDw-1:0] d, output logic [1:0] resp);
    araddr = a; arvalid = 1'b1; rready = 1'b1;
    do @(negedge clk); while (!ar_taken);
    arvalid = 1'b0;
    if (!r_taken) do @(negedge clk); while (!r_taken);
    d = rdata; resp = rresp;
    rready = 1'b0;
  endtask

  function automatic logic [AxilAw-1:0] chan_addr(input logic [5:0] off);
    chan_addr = ChanBase + AxilAw'(off);  // channel 0 only
  endfunction

  // ---- src-stream driver (src_clk domain) --------------------------------------

  logic src_taken;
  always @(posedge src_clk) src_taken = src_valid[0] & src_ready[0];

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

  logic [7:0] sent_bytes [$];

  task automatic send_packet(input int unsigned len);
    automatic logic [7:0] bytes_q [$];
    automatic logic [31:0] crc;
    sent_bytes.delete();
    for (int unsigned i = 0; i < len; i++) begin
      automatic logic [7:0] b = 8'(i + 8'hA0);
      bytes_q.push_back(b);
      sent_bytes.push_back(b);
    end
    crc = software_crc32(bytes_q);
    for (int unsigned i = 0; i < len; i++) begin
      src_data[0] = bytes_q[i];
      src_sop[0]  = (i == 0);
      src_eop[0]  = (i == len - 1);
      src_crc[0]  = src_eop[0] ? crc : 32'h0;
      src_valid[0] = 1'b1;
      @(negedge src_clk);
      while (!src_taken) @(negedge src_clk);
    end
    src_valid[0] = 1'b0;
  endtask

  // ---- shared AXI4 memory model, clk domain -------------------------------------

  logic [AxiDw-1:0] mem [logic [31:0]];
  function automatic logic [31:0] word_addr(input logic [31:0] a);
    word_addr = a & ~(32'(BeatBytes) - 32'd1);
  endfunction

  // read side (descriptor fetch)
  logic              arm_taken;
  logic [31:0]       arm_taken_addr;
  logic [7:0]        arm_taken_len;
  always @(posedge clk) begin
    arm_taken      = arvalid_m & arready_m;
    arm_taken_addr = araddr_m;
    arm_taken_len  = arlen_m;
  end
  logic rm_taken;
  always @(posedge clk) rm_taken = rvalid_m & rready_m;

  always @(negedge clk) arready_m = 1'b1;

  int unsigned ar_count = 0;
  initial begin
    rvalid_m = 1'b0; rdata_m = '0; rresp_m = RespOkay; rlast_m = 1'b0; rid_m = '0;
    forever begin
      @(negedge clk);
      if (rst_n && arm_taken) begin
        automatic logic [31:0] base   = arm_taken_addr;
        automatic int unsigned nbeats = int'(arm_taken_len) + 1;
        ar_count++;
        for (int unsigned i = 0; i < nbeats; i++) begin
          rdata_m = mem.exists(word_addr(base + 32'(i * BeatBytes))) ?
                    mem[word_addr(base + 32'(i * BeatBytes))] : '0;
          rresp_m = RespOkay;
          rlast_m = (i == nbeats - 1);
          rid_m   = '0;
          rvalid_m = 1'b1;
          @(negedge clk);
          while (!rm_taken) @(negedge clk);
        end
        rvalid_m = 1'b0;
      end
    end
  end

  // write side (payload)
  logic              awm_taken;
  logic [31:0]       awm_taken_addr;
  logic [7:0]        awm_taken_len;
  always @(posedge clk) begin
    awm_taken      = awvalid_m & awready_m;
    awm_taken_addr = awaddr_m;
    awm_taken_len  = awlen_m;
  end
  logic             wm_taken;
  logic [AxiDw-1:0] wm_taken_data;
  always @(posedge clk) begin
    wm_taken      = wvalid_m & wready_m;
    wm_taken_data = wdata_m;
  end
  logic bm_taken;
  always @(posedge clk) bm_taken = bvalid_m & bready_m;

  always @(negedge clk) awready_m = 1'b1;
  always @(negedge clk) wready_m  = 1'b1;

  int unsigned aw_count = 0;
  initial begin
    bvalid_m = 1'b0; bresp_m = RespOkay; bid_m = '0;
    forever begin
      @(negedge clk);
      if (rst_n && awm_taken) begin
        automatic logic [31:0] base   = awm_taken_addr;
        automatic int unsigned nbeats = int'(awm_taken_len) + 1;
        aw_count++;
        for (int unsigned i = 0; i < nbeats; i++) begin
          @(negedge clk);
          while (!wm_taken) @(negedge clk);
          mem[word_addr(base + 32'(i * BeatBytes))] = wm_taken_data;
        end
        bresp_m = RespOkay; bid_m = '0; bvalid_m = 1'b1;
        @(negedge clk);
        while (!bm_taken) @(negedge clk);
        bvalid_m = 1'b0;
      end
    end
  end

  // ---- descriptor packing, per daq_pkg::desc_t's bit layout --------------------
  // beat0 = {length[31:0], addr[31:0]}, beat1 = {next_ptr[31:0], ctrl[31:0]}.

  function automatic logic [AxiDw-1:0] desc_beat0(input logic [31:0] addr, input logic [31:0] length);
    desc_beat0 = {length, addr};
  endfunction
  function automatic logic [AxiDw-1:0] desc_beat1(input logic [31:0] next_ptr, input logic ctrl_valid,
                                                    input logic ctrl_last, input logic ctrl_link);
    automatic logic [31:0] ctrl_bits;
    ctrl_bits = {16'h0, 12'h0, ctrl_link, ctrl_last, 1'b0 /*irq_en*/, ctrl_valid};
    desc_beat1 = {next_ptr, ctrl_bits};
  endfunction

  localparam logic [31:0] DescBase    = 32'h0000_1000;
  localparam logic [31:0] PayloadAddr = 32'h0000_2000;

  task automatic reset_dut();
    awvalid = 0; awaddr = '0; wvalid = 0; wdata = '0; wstrb = '0; bready = 0;
    arvalid = 0; araddr = '0; rready = 0;
    src_valid = '0; src_data[0] = '0; src_sop = '0; src_eop = '0; src_crc[0] = '0;
    rst_n = 1'b0;
    repeat (5) @(negedge clk);
    rst_n = 1'b1;
    repeat (3) @(negedge clk);
  endtask

  initial begin
    reset_dut();

    // ---- preload the descriptor: one beat, valid, last, no link ---------------
    mem[DescBase]     = desc_beat0(PayloadAddr, 32'(BeatBytes));
    mem[DescBase + 8] = desc_beat1(32'h0, 1'b1, 1'b1, 1'b0);

    // ---- configure over AXI4-Lite ----------------------------------------------
    begin
      automatic logic [1:0] resp;
      axil_write(chan_addr(OffDescBase), DescBase, 4'hF, resp);
      check(resp == RespOkay, "CH_DESC_BASE write should be OKAY");
      axil_write(chan_addr(OffCtrl), 32'h1, 4'hF, resp);          // CH_CTRL.enable
      check(resp == RespOkay, "CH_CTRL write should be OKAY");
      axil_write(AddrGlobalCtrl, 32'h1, 4'hF, resp);              // GLOBAL_CTRL.enable
      check(resp == RespOkay, "GLOBAL_CTRL write should be OKAY");
      axil_write(chan_addr(OffIrqEnable), 32'hF, 4'hF, resp);     // CH_IRQ_ENABLE, all causes
      check(resp == RespOkay, "CH_IRQ_ENABLE write should be OKAY");
      axil_write(AddrIrqEnable, 32'h1, 4'hF, resp);               // IRQ_ENABLE, channel 0
      check(resp == RespOkay, "IRQ_ENABLE write should be OKAY");
      axil_write(chan_addr(OffDescCtrl), 32'h1, 4'hF, resp);      // CH_DESC_CTRL.go
      check(resp == RespOkay, "CH_DESC_CTRL write should be OKAY");
    end

    // ---- poll CH_STATUS.busy until desc_fetch has validated the descriptor -----
    begin
      automatic logic [31:0] status;
      automatic logic [1:0]  resp;
      automatic int unsigned tries = 0;
      status = 32'h0;
      while (!status[0] && tries < 200) begin
        axil_read(chan_addr(OffStatus), status, resp);
        tries++;
        repeat (2) @(negedge clk);
      end
      check(status[0], "CH_STATUS.busy should assert once the descriptor is fetched");
    end

    // ---- send one CRC-correct packet, exactly one beat long ---------------------
    send_packet(BeatBytes);

    // ---- wait for the descriptor's completion (CH_IRQ_STATE Done cause) --------
    begin
      automatic logic [31:0] irq_state;
      automatic logic [1:0]  resp;
      automatic int unsigned tries = 0;
      irq_state = 32'h0;
      while (!irq_state[IrqCauseDone] && tries < 2000) begin
        axil_read(chan_addr(OffIrqState), irq_state, resp);
        tries++;
        repeat (2) @(negedge clk);
      end
      check(irq_state[IrqCauseDone], "CH_IRQ_STATE should latch the Done cause after the transfer");
      check(irq, "irq_o should be asserted once IRQ_ENABLE/CH_IRQ_ENABLE unmask the Done cause");
    end

    // ---- check the payload actually landed in memory ----------------------------
    check(ar_count >= 1, "descriptor fetch should have issued at least one AR");
    check(aw_count == 1, "the one-beat payload write should be exactly one AW");
    begin
      automatic logic [AxiDw-1:0] got;
      got = mem.exists(PayloadAddr) ? mem[PayloadAddr] : '0;
      for (int unsigned i = 0; i < BeatBytes; i++) begin
        check(got[i*8+:8] == sent_bytes[i],
              $sformatf("payload byte %0d mismatch: got %0h expected %0h", i, got[i*8+:8], sent_bytes[i]));
      end
    end

    // ---- check the counters over AXI4-Lite --------------------------------------
    begin
      automatic logic [31:0] byte_cnt, pkt_cnt;
      automatic logic [1:0]  resp;
      axil_read(chan_addr(OffByteCnt), byte_cnt, resp);
      check(byte_cnt == 32'(BeatBytes), "CH_BYTE_CNT should read back the one beat's bytes");
      axil_read(chan_addr(OffPktCnt), pkt_cnt, resp);
      check(pkt_cnt == 32'd1, "CH_PKT_CNT should read back exactly one packet");
    end

    $display("");
    if (errors == 0) begin $display("[DAQ_SUBSYSTEM_TB] PASS"); $finish; end
    else begin $display("[DAQ_SUBSYSTEM_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_daq_subsystem failed"); end
  end

  initial begin #500_000; $fatal(1, "tb_daq_subsystem timeout"); end

endmodule
