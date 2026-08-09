// Block-level testbench for the CSR block: axil_slave.sv + daq_csr.sv wired
// together exactly as they will be inside daq_subsystem.sv (phase 5), driven
// over AXI4-Lite from this TB. No other block exists yet, so daq_csr's
// status/counter/cause inputs are driven directly by the TB - this is the
// "block level, not integration" test point the plan calls for: CSR gets its
// own testbench with its own status stimulus, not just whatever an
// integration environment happens to exercise.
//
// Built with NumCh=4 (+define+DAQ_NUM_CH=4 in scripts/run_block_tb.ps1), a
// value the lint sweep already proved elaborates but the phase-1 block TBs
// never exercised at runtime.
//
// Coverage:
//   1. ID/VERSION readback
//   2. GLOBAL_CTRL: enable readback, soft_rst pulse (one cycle, always reads 0)
//   3. GLOBAL_STATUS: busy bitmap + dma_busy readback
//   4. Per-channel CH_CTRL/CH_DESC_BASE: RW readback, byte-strobe partial write
//   5. CH_DESC_CTRL go pulse: one cycle, always reads 0
//   6. CH_IRQ_STATE W1C: hardware set, software clear, and the simultaneous
//      case where a hardware cause lands on the exact cycle software tries to
//      clear the same bit - hardware must win
//   7. IRQ_STATE (global, RO) mirrors CH_IRQ_STATE & CH_IRQ_ENABLE live,
//      never needs clearing itself
//   8. irq_o asserts only once IRQ_ENABLE unmasks the channel
//   9. RO counters (byte/pkt/err/stall/crc/ecc) readback from driven inputs
//  10. Unmapped address (beyond NumCh, and a channel's reserved intra-offset)
//      -> DECERR; write to an RO address -> legal no-op, OKAY

module tb_daq_csr;

  localparam int unsigned Aw = daq_pkg::AxilAw;
  localparam int unsigned Dw = daq_pkg::AxilDw;
  localparam int unsigned NumCh = daq_pkg::NumCh;  // set via +define+DAQ_NUM_CH

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic [Aw-1:0]      awaddr;  logic awvalid, awready;
  logic [Dw-1:0]       wdata;  logic [(Dw/8)-1:0] wstrb; logic wvalid, wready;
  logic [1:0]          bresp;  logic bvalid, bready;
  logic [Aw-1:0]      araddr;  logic arvalid, arready;
  logic [Dw-1:0]       rdata;  logic [1:0] rresp; logic rvalid, rready;

  logic                 reg_valid, reg_write;
  logic [Aw-1:0]         reg_addr;
  logic [Dw-1:0]          reg_wdata;
  logic [(Dw/8)-1:0]       reg_wstrb;
  logic [Dw-1:0]            reg_rdata;
  logic                      reg_error;

  axil_slave dut_bridge (
    .clk_i (clk), .rst_ni (rst_n),
    .awaddr_i (awaddr), .awvalid_i (awvalid), .awready_o (awready),
    .wdata_i  (wdata),  .wstrb_i (wstrb), .wvalid_i (wvalid), .wready_o (wready),
    .bresp_o  (bresp),  .bvalid_o (bvalid), .bready_i (bready),
    .araddr_i (araddr), .arvalid_i (arvalid), .arready_o (arready),
    .rdata_o  (rdata),  .rresp_o (rresp), .rvalid_o (rvalid), .rready_i (rready),
    .reg_valid_o (reg_valid), .reg_write_o (reg_write), .reg_addr_o (reg_addr),
    .reg_wdata_o (reg_wdata), .reg_wstrb_o (reg_wstrb),
    .reg_rdata_i (reg_rdata), .reg_error_i (reg_error)
  );

  logic [NumCh-1:0] ch_busy;
  logic             dma_busy;
  logic [NumCh-1:0] ch_err;
  logic [3:0]       ch_cause [NumCh];
  logic [31:0]      ch_byte_cnt   [NumCh];
  logic [31:0]      ch_pkt_cnt    [NumCh];
  logic [31:0]      ch_err_cnt    [NumCh];
  logic [31:0]      ch_stall_cnt  [NumCh];
  logic [31:0]      ch_crc_status [NumCh];
  logic [31:0]      ch_ecc_status [NumCh];

  logic              global_enable, soft_rst_pulse, irq_o;
  logic [31:0]       err_inject;
  logic [7:0]        axi_max_burst, axi_outstanding;
  logic [NumCh-1:0]  ch_enable, ch_abort, ch_desc_go;
  logic [31:0]       ch_desc_base [NumCh];

  daq_csr dut_csr (
    .clk_i (clk), .rst_ni (rst_n),
    .reg_valid_i (reg_valid), .reg_write_i (reg_write), .reg_addr_i (reg_addr),
    .reg_wdata_i (reg_wdata), .reg_wstrb_i (reg_wstrb),
    .reg_rdata_o (reg_rdata), .reg_error_o (reg_error),
    .global_enable_o (global_enable), .soft_rst_pulse_o (soft_rst_pulse),
    .err_inject_o (err_inject),
    .axi_max_burst_o (axi_max_burst), .axi_outstanding_o (axi_outstanding),
    .ch_busy_i (ch_busy), .dma_busy_i (dma_busy), .irq_o (irq_o),
    .ch_enable_o (ch_enable), .ch_abort_o (ch_abort),
    .ch_desc_base_o (ch_desc_base), .ch_desc_go_o (ch_desc_go),
    .ch_err_i (ch_err), .ch_cause_i (ch_cause),
    .ch_byte_cnt_i (ch_byte_cnt), .ch_pkt_cnt_i (ch_pkt_cnt),
    .ch_err_cnt_i (ch_err_cnt), .ch_stall_cnt_i (ch_stall_cnt),
    .ch_crc_status_i (ch_crc_status), .ch_ecc_status_i (ch_ecc_status)
  );

  int unsigned errors = 0;

  // "Was this channel's handshake accepted at the edge that just happened?"
  // See tb_axil_slave.sv for why this monitor - not a re-read of the raw
  // ready signals - is required: awready/wready/arready are combinational and
  // drop on the very edge they accept a transfer, so a negedge-driven
  // testbench that re-reads them afterwards never observes the acceptance.
  logic aw_taken, w_taken, ar_taken, b_taken, r_taken;
  always @(posedge clk) begin
    aw_taken = awvalid & awready;
    w_taken  = wvalid  & wready;
    ar_taken = arvalid & arready;
    b_taken  = bvalid  & bready;
    r_taken  = rvalid  & rready;
  end

  // ---- drivers ---------------------------------------------------------------
  task automatic reset_dut();
    awvalid=0; awaddr='0; wvalid=0; wdata='0; wstrb='0; bready=0;
    arvalid=0; araddr='0; rready=0;
    ch_busy = '0; dma_busy = 1'b0; ch_err = '0;
    for (int unsigned c = 0; c < NumCh; c++) begin
      ch_cause[c] = '0; ch_byte_cnt[c] = '0; ch_pkt_cnt[c] = '0;
      ch_err_cnt[c] = '0; ch_stall_cnt[c] = '0; ch_crc_status[c] = '0; ch_ecc_status[c] = '0;
    end
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  task automatic axil_write(input logic [Aw-1:0] a, input logic [Dw-1:0] d,
                             input logic [(Dw/8)-1:0] s, output logic [1:0] resp);
    awaddr = a; awvalid = 1'b1;
    wdata  = d; wstrb = s; wvalid = 1'b1;
    bready = 1'b1;
    do @(negedge clk); while (!aw_taken);
    awvalid = 1'b0;
    if (!w_taken) begin
      do @(negedge clk); while (!w_taken);
    end
    wvalid = 1'b0;
    if (!b_taken) begin
      do @(negedge clk); while (!b_taken);
    end
    resp = bresp;
    bready = 1'b0;
  endtask

  task automatic axil_read(input logic [Aw-1:0] a, output logic [Dw-1:0] d, output logic [1:0] resp);
    araddr = a; arvalid = 1'b1; rready = 1'b1;
    do @(negedge clk); while (!ar_taken);
    arvalid = 1'b0;
    if (!r_taken) begin
      do @(negedge clk); while (!r_taken);
    end
    d = rdata; resp = rresp;
    rready = 1'b0;
  endtask

  // Callers pass loop counters (int unsigned) up to NumCh (<=8), so ch's
  // upper bits are genuinely unused - not a truncation bug, just a narrower
  // range than the type says.
  /* verilator lint_off UNUSEDSIGNAL */
  function automatic logic [Aw-1:0] chan_addr(input int unsigned ch, input logic [5:0] off);
    chan_addr = daq_pkg::ChanBase + Aw'(ch) * daq_pkg::ChanStride + Aw'(off);
  endfunction
  /* verilator lint_on UNUSEDSIGNAL */

  initial begin
    logic [Dw-1:0] rd; logic [1:0] resp;

    reset_dut();

    // ---- 1: ID / VERSION -----------------------------------------------------
    axil_read(daq_pkg::AddrId, rd, resp);
    if (rd !== daq_pkg::IdValue || resp !== 2'b00) begin
      $display("ERROR: ID readback got %0h/%0d", rd, resp); errors++;
    end
    axil_read(daq_pkg::AddrVersion, rd, resp);
    if (rd !== daq_pkg::VersionValue || resp !== 2'b00) begin
      $display("ERROR: VERSION readback got %0h, expected %0h", rd, daq_pkg::VersionValue); errors++;
    end

    // ---- 2: GLOBAL_CTRL enable + soft_rst pulse -------------------------------
    axil_write(daq_pkg::AddrGlobalCtrl, 32'h1, 4'hF, resp);
    if (global_enable !== 1'b1) begin $display("ERROR: global_enable_o did not go high"); errors++; end
    axil_read(daq_pkg::AddrGlobalCtrl, rd, resp);
    if (rd !== 32'h1) begin $display("ERROR: GLOBAL_CTRL readback %0h, expected 1 (soft_rst never sticks)", rd); errors++; end

    fork
      begin : watch_pulse
        @(posedge clk);
        if (!soft_rst_pulse) begin $display("ERROR: soft_rst_pulse_o did not fire on the write cycle"); errors++; end
        @(posedge clk);
        if (soft_rst_pulse) begin $display("ERROR: soft_rst_pulse_o did not clear after one cycle"); errors++; end
      end
      axil_write(daq_pkg::AddrGlobalCtrl, 32'h3, 4'hF, resp);  // enable=1, soft_rst=1
    join
    axil_read(daq_pkg::AddrGlobalCtrl, rd, resp);
    if (rd !== 32'h1) begin $display("ERROR: GLOBAL_CTRL after soft_rst write reads %0h, expected 1", rd); errors++; end

    // ---- 3: GLOBAL_STATUS -----------------------------------------------------
    ch_busy = NumCh'(4'b0101 & ((1 << NumCh) - 1));
    dma_busy = 1'b1;
    @(negedge clk);
    axil_read(daq_pkg::AddrGlobalStatus, rd, resp);
    if (rd[7:0] !== 8'(ch_busy) || rd[8] !== 1'b1) begin
      $display("ERROR: GLOBAL_STATUS got %0h, expected busy=%0h dma_busy=1", rd, ch_busy); errors++;
    end
    ch_busy = '0; dma_busy = 1'b0;

    // ---- 4: per-channel CTRL / DESC_BASE --------------------------------------
    for (int unsigned c = 0; c < NumCh; c++) begin
      axil_write(chan_addr(c, daq_pkg::OffCtrl), 32'h3, 4'hF, resp);  // enable+abort
      if (resp !== 2'b00) begin $display("ERROR: ch%0d CTRL write resp=%0d", c, resp); errors++; end
      if (ch_enable[c] !== 1'b1 || ch_abort[c] !== 1'b1) begin
        $display("ERROR: ch%0d enable/abort outputs did not follow CTRL write", c); errors++;
      end
      axil_read(chan_addr(c, daq_pkg::OffCtrl), rd, resp);
      if (rd !== 32'h3) begin $display("ERROR: ch%0d CTRL readback %0h, expected 3", c, rd); errors++; end

      axil_write(chan_addr(c, daq_pkg::OffDescBase), 32'hDEAD_0000 | c, 4'hF, resp);
      axil_write(chan_addr(c, daq_pkg::OffDescBase), 32'h0000_BEEF, 4'h3, resp);  // low 2 bytes only
      // Byte-strobe partial write: the second write's wstrb=4'h3 only covers
      // the low two bytes, so the high halfword from the first write must
      // survive untouched.
      axil_read(chan_addr(c, daq_pkg::OffDescBase), rd, resp);
      if (rd !== {16'hDEAD, 16'hBEEF}) begin
        $display("ERROR: ch%0d DESC_BASE after partial write got %0h, expected deadbeef", c, rd); errors++;
      end
      if (ch_desc_base[c] !== rd) begin
        $display("ERROR: ch%0d ch_desc_base_o does not match register readback", c); errors++;
      end
    end

    // ---- 5: DESC_CTRL go pulse -------------------------------------------------
    for (int unsigned c = 0; c < NumCh; c++) begin
      fork
        begin
          @(posedge clk);
          if (!ch_desc_go[c]) begin $display("ERROR: ch%0d desc_go did not pulse", c); errors++; end
          if (|(ch_desc_go & ~(NumCh'(1) << c))) begin
            $display("ERROR: ch%0d desc_go write also pulsed another channel: %0b", c, ch_desc_go); errors++;
          end
          @(posedge clk);
          if (ch_desc_go[c]) begin $display("ERROR: ch%0d desc_go did not clear after one cycle", c); errors++; end
        end
        axil_write(chan_addr(c, daq_pkg::OffDescCtrl), 32'h1, 4'hF, resp);
      join
      axil_read(chan_addr(c, daq_pkg::OffDescCtrl), rd, resp);
      if (rd !== 32'h0) begin $display("ERROR: ch%0d DESC_CTRL readback %0h, expected 0 (never stored)", c, rd); errors++; end
    end

    // ---- 6/7/8: CH_IRQ_STATE W1C, IRQ_STATE live summary, irq_o ---------------
    // Channel 0: hardware sets IrqCauseDone, enable it, expect summary+irq_o.
    ch_cause[0] = 4'b0001;
    @(negedge clk);
    ch_cause[0] = 4'b0000;
    axil_read(chan_addr(0, daq_pkg::OffIrqState), rd, resp);
    if (rd[3:0] !== 4'b0001) begin $display("ERROR: ch0 IRQ_STATE after hw set got %0h, expected 1", rd); errors++; end

    axil_write(daq_pkg::AddrIrqEnable, 32'h1, 4'hF, resp);  // unmask channel 0's summary
    axil_write(chan_addr(0, daq_pkg::OffIrqEnable), 32'h1, 4'hF, resp);  // unmask cause 0
    @(negedge clk);
    if (irq_o !== 1'b1) begin $display("ERROR: irq_o did not assert once ch0 done was enabled at both levels"); errors++; end
    axil_read(daq_pkg::AddrIrqState, rd, resp);
    if (rd[0] !== 1'b1) begin $display("ERROR: global IRQ_STATE bit0 not set while ch0 cause is pending"); errors++; end

    // Software clears it - no hardware event this cycle.
    axil_write(chan_addr(0, daq_pkg::OffIrqState), 32'h1, 4'hF, resp);
    @(negedge clk);
    if (irq_o !== 1'b0) begin $display("ERROR: irq_o still asserted after CH_IRQ_STATE cleared"); errors++; end
    axil_read(daq_pkg::AddrIrqState, rd, resp);
    if (rd[0] !== 1'b0) begin $display("ERROR: global IRQ_STATE bit0 still set after clear"); errors++; end

    // Simultaneous case: hardware sets the same cycle software writes 1 to
    // clear it. Hardware must win - a new event must never be silently lost
    // to a software poll that raced it.
    //
    // ch_cause[0] must be a one-edge pulse spanning exactly the commit edge,
    // not held high for axil_write's whole duration: an earlier version held
    // it until the call returned, which covers several clock edges (AW/W
    // capture, then the BVALID wait), and on every edge after the real race
    // where ch_cause stayed asserted but no write was committing, the
    // ordinary (non-racing) hardware-set path set the bit right back to 1
    // regardless of what the race edge itself had done - hiding the mutant
    // this test exists to catch. Clearing it at the first negedge (which
    // lands right after the commit edge, same as axil_write's own internal
    // accept check) confines the pulse to just that one edge.
    ch_cause[0] = 4'b0001;
    fork
      axil_write(chan_addr(0, daq_pkg::OffIrqState), 32'h1, 4'hF, resp);
      begin
        @(negedge clk);
        ch_cause[0] = 4'b0000;
      end
    join
    axil_read(chan_addr(0, daq_pkg::OffIrqState), rd, resp);
    if (rd[0] !== 1'b1) begin
      $display("ERROR: simultaneous hw-set/sw-clear lost the event, CH_IRQ_STATE=%0h", rd); errors++;
    end
    axil_write(chan_addr(0, daq_pkg::OffIrqState), 32'h1, 4'hF, resp);  // clean up for later checks

    // ---- 8b: ERR_INJECT / AXI_CFG ---------------------------------------------
    axil_write(daq_pkg::AddrErrInject, 32'hDEAD_BEEF, 4'hF, resp);
    if (err_inject !== 32'hDEAD_BEEF) begin
      $display("ERROR: err_inject_o=%0h did not follow ERR_INJECT write", err_inject); errors++;
    end
    axil_read(daq_pkg::AddrErrInject, rd, resp);
    if (rd !== 32'hDEAD_BEEF) begin $display("ERROR: ERR_INJECT readback %0h, expected deadbeef", rd); errors++; end

    // AXI_CFG: bits[7:0]=max_burst, bits[15:8]=outstanding, [31:16] writable
    // but forced to 0 on readback (reserved) - both are exercised together.
    axil_write(daq_pkg::AddrAxiCfg, 32'hFFFF_2008, 4'hF, resp);
    if (axi_max_burst !== 8'h08 || axi_outstanding !== 8'h20) begin
      $display("ERROR: axi_max_burst_o/axi_outstanding_o=%0h/%0h, expected 08/20", axi_max_burst, axi_outstanding);
      errors++;
    end
    axil_read(daq_pkg::AddrAxiCfg, rd, resp);
    if (rd !== 32'h0000_2008) begin
      $display("ERROR: AXI_CFG readback %0h, expected 00002008 (reserved bits forced to 0)", rd); errors++;
    end

    // ---- 9: RO counters ---------------------------------------------------------
    for (int unsigned c = 0; c < NumCh; c++) begin
      ch_byte_cnt[c]   = 32'h1000_0000 + c;
      ch_pkt_cnt[c]    = 32'h2000_0000 + c;
      ch_err_cnt[c]    = 32'h3000_0000 + c;
      ch_stall_cnt[c]  = 32'h4000_0000 + c;
      ch_crc_status[c] = 32'h5000_0000 + c;
      ch_ecc_status[c] = 32'h6000_0000 + c;
    end
    @(negedge clk);
    for (int unsigned c = 0; c < NumCh; c++) begin
      axil_read(chan_addr(c, daq_pkg::OffByteCnt), rd, resp);
      if (rd !== ch_byte_cnt[c]) begin $display("ERROR: ch%0d BYTE_CNT readback mismatch", c); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffPktCnt), rd, resp);
      if (rd !== ch_pkt_cnt[c]) begin $display("ERROR: ch%0d PKT_CNT readback mismatch", c); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffErrCnt), rd, resp);
      if (rd !== ch_err_cnt[c]) begin $display("ERROR: ch%0d ERR_CNT readback mismatch", c); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffStallCnt), rd, resp);
      if (rd !== ch_stall_cnt[c]) begin $display("ERROR: ch%0d STALL_CNT readback mismatch", c); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffCrcStatus), rd, resp);
      if (rd !== ch_crc_status[c]) begin $display("ERROR: ch%0d CRC_STATUS readback mismatch", c); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffEccStatus), rd, resp);
      if (rd !== ch_ecc_status[c]) begin $display("ERROR: ch%0d ECC_STATUS readback mismatch", c); errors++; end

      // RO addresses accept writes as no-ops: OKAY, and the value must not move.
      axil_write(chan_addr(c, daq_pkg::OffByteCnt), 32'hFFFF_FFFF, 4'hF, resp);
      if (resp !== 2'b00) begin $display("ERROR: write to RO ch%0d BYTE_CNT got resp=%0d, expected OKAY no-op", c, resp); errors++; end
      axil_read(chan_addr(c, daq_pkg::OffByteCnt), rd, resp);
      if (rd !== ch_byte_cnt[c]) begin $display("ERROR: RO ch%0d BYTE_CNT moved after a write", c); errors++; end
    end

    // ---- 10: unmapped addresses --------------------------------------------------
    axil_read(chan_addr(NumCh, daq_pkg::OffCtrl), rd, resp);  // one past the last channel
    if (resp !== 2'b11) begin $display("ERROR: read past last channel got resp=%0d, expected DECERR", resp); errors++; end
    axil_read(chan_addr(0, 6'h30), rd, resp);  // reserved intra-channel offset
    if (resp !== 2'b11) begin $display("ERROR: reserved intra-channel offset got resp=%0d, expected DECERR", resp); errors++; end
    axil_read(16'h020, rd, resp);  // reserved global offset, between AXI_CFG and ChanBase
    if (resp !== 2'b11) begin $display("ERROR: reserved global offset got resp=%0d, expected DECERR", resp); errors++; end

    $display("");
    if (errors == 0) begin $display("[DAQ_CSR_TB] PASS"); $finish; end
    else begin $display("[DAQ_CSR_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_daq_csr failed"); end
  end

  initial begin #2_000_000; $fatal(1, "tb_daq_csr timeout"); end

endmodule
