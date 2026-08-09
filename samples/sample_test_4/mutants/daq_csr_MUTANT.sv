// Mutant copy of rtl/csr/daq_csr.sv. See mutants/skid_buffer_MUTANT.sv for
// why these exist and what -Mutant does with them.
//
//   MUT_CSR_IRQNOHW    software clear wins a same-cycle race against a
//                      hardware-set cause, instead of hardware winning as
//                      designed - a new event landing on the exact cycle
//                      software polls-and-clears would be silently lost.
//                      Only tb_daq_csr's simultaneous hw-set/sw-clear
//                      directed case can catch this; the separate set-then-
//                      clear checks earlier in the same test cannot, because
//                      they never issue both on the same cycle.
//   MUT_CSR_NODECERR   reg_error_o is always 0 - every address, mapped or
//                      not, reports success.
//   MUT_CSR_GOALL      CH_DESC_CTRL's go pulse fires on every channel
//                      instead of only the addressed one.

module daq_csr
  import daq_pkg::*;
(
  input  logic                  clk_i,
  input  logic                  rst_ni,
  input  logic                    reg_valid_i,
  input  logic                    reg_write_i,
  input  logic [AxilAw-1:0]       reg_addr_i,
  input  logic [AxilDw-1:0]       reg_wdata_i,
  input  logic [(AxilDw/8)-1:0]   reg_wstrb_i,
  output logic [AxilDw-1:0]       reg_rdata_o,
  output logic                     reg_error_o,
  output logic                     global_enable_o,
  output logic                     soft_rst_pulse_o,
  output logic [31:0]              err_inject_o,
  output logic [7:0]               axi_max_burst_o,
  output logic [7:0]               axi_outstanding_o,
  input  logic [NumCh-1:0]         ch_busy_i,
  input  logic                     dma_busy_i,
  output logic                     irq_o,
  output logic [NumCh-1:0]         ch_enable_o,
  output logic [NumCh-1:0]         ch_abort_o,
  output logic [31:0]              ch_desc_base_o  [NumCh],
  output logic [NumCh-1:0]         ch_desc_go_o,
  input  logic [NumCh-1:0]         ch_err_i,
  input  logic [3:0]               ch_cause_i      [NumCh],
  input  logic [31:0]              ch_byte_cnt_i   [NumCh],
  input  logic [31:0]              ch_pkt_cnt_i    [NumCh],
  input  logic [31:0]              ch_err_cnt_i    [NumCh],
  input  logic [31:0]              ch_stall_cnt_i  [NumCh],
  input  logic [31:0]              ch_crc_status_i [NumCh],
  input  logic [31:0]              ch_ecc_status_i [NumCh]
);

  if (NumCh > 8) begin : gen_bad_num_ch
    initial $fatal(1, "daq_csr: NumCh (%0d) exceeds 8, the global-bank bit layout is fixed-width", NumCh);
  end

  logic             global_enable_q;
  logic [31:0]      err_inject_q;
  logic [31:0]      axi_cfg_q;
  logic [NumCh-1:0] irq_enable_q;

  logic [1:0]  ch_ctrl_q       [NumCh];
  logic [31:0] ch_desc_base_q  [NumCh];
  logic [3:0]  ch_irq_state_q  [NumCh];
  logic [3:0]  ch_irq_enable_q [NumCh];

  logic       sel_id, sel_version, sel_global_ctrl, sel_global_status,
              sel_irq_state, sel_irq_enable, sel_err_inject, sel_axi_cfg;
  logic       sel_ch_ctrl, sel_ch_status, sel_ch_desc_base, sel_ch_desc_ctrl,
              sel_ch_irq_state, sel_ch_irq_enable, sel_ch_byte_cnt,
              sel_ch_pkt_cnt, sel_ch_err_cnt, sel_ch_stall_cnt,
              sel_ch_crc_status, sel_ch_ecc_status;
  logic                sel_chan_valid;
  logic [ChIdxW-1:0]   sel_chan_idx;
  logic                addr_valid;

  always_comb begin
    sel_id = 1'b0; sel_version = 1'b0; sel_global_ctrl = 1'b0;
    sel_global_status = 1'b0; sel_irq_state = 1'b0; sel_irq_enable = 1'b0;
    sel_err_inject = 1'b0; sel_axi_cfg = 1'b0;
    sel_ch_ctrl = 1'b0; sel_ch_status = 1'b0; sel_ch_desc_base = 1'b0;
    sel_ch_desc_ctrl = 1'b0; sel_ch_irq_state = 1'b0; sel_ch_irq_enable = 1'b0;
    sel_ch_byte_cnt = 1'b0; sel_ch_pkt_cnt = 1'b0; sel_ch_err_cnt = 1'b0;
    sel_ch_stall_cnt = 1'b0; sel_ch_crc_status = 1'b0; sel_ch_ecc_status = 1'b0;
    sel_chan_valid = 1'b0;
    sel_chan_idx   = '0;
    addr_valid     = 1'b0;

    if (!addr_is_chan(reg_addr_i)) begin
      unique case (reg_addr_i)
        AddrId:           begin sel_id = 1'b1; addr_valid = 1'b1; end
        AddrVersion:      begin sel_version = 1'b1; addr_valid = 1'b1; end
        AddrGlobalCtrl:   begin sel_global_ctrl = 1'b1; addr_valid = 1'b1; end
        AddrGlobalStatus: begin sel_global_status = 1'b1; addr_valid = 1'b1; end
        AddrIrqState:     begin sel_irq_state = 1'b1; addr_valid = 1'b1; end
        AddrIrqEnable:    begin sel_irq_enable = 1'b1; addr_valid = 1'b1; end
        AddrErrInject:    begin sel_err_inject = 1'b1; addr_valid = 1'b1; end
        AddrAxiCfg:       begin sel_axi_cfg = 1'b1; addr_valid = 1'b1; end
        default: ;
      endcase
    end else begin
      automatic int unsigned idx = chan_of_addr(reg_addr_i);
      if (idx < NumCh) begin
        sel_chan_valid = 1'b1;
        sel_chan_idx   = ChIdxW'(idx);
        unique case (reg_addr_i[5:0])
          OffCtrl:      begin sel_ch_ctrl = 1'b1; addr_valid = 1'b1; end
          OffStatus:    begin sel_ch_status = 1'b1; addr_valid = 1'b1; end
          OffDescBase:  begin sel_ch_desc_base = 1'b1; addr_valid = 1'b1; end
          OffDescCtrl:  begin sel_ch_desc_ctrl = 1'b1; addr_valid = 1'b1; end
          OffIrqState:  begin sel_ch_irq_state = 1'b1; addr_valid = 1'b1; end
          OffIrqEnable: begin sel_ch_irq_enable = 1'b1; addr_valid = 1'b1; end
          OffByteCnt:   begin sel_ch_byte_cnt = 1'b1; addr_valid = 1'b1; end
          OffPktCnt:    begin sel_ch_pkt_cnt = 1'b1; addr_valid = 1'b1; end
          OffErrCnt:    begin sel_ch_err_cnt = 1'b1; addr_valid = 1'b1; end
          OffStallCnt:  begin sel_ch_stall_cnt = 1'b1; addr_valid = 1'b1; end
          OffCrcStatus: begin sel_ch_crc_status = 1'b1; addr_valid = 1'b1; end
          OffEccStatus: begin sel_ch_ecc_status = 1'b1; addr_valid = 1'b1; end
          default: ;
        endcase
      end
    end
  end

`ifdef MUT_CSR_NODECERR
  assign reg_error_o = 1'b0;
`else
  assign reg_error_o = ~addr_valid;
`endif

  logic [NumCh-1:0] channel_summary;
  always_comb begin
    for (int unsigned c = 0; c < NumCh; c++) begin
      channel_summary[c] = |(ch_irq_state_q[c] & ch_irq_enable_q[c]);
    end
  end
  assign irq_o = |(channel_summary & irq_enable_q);

  always_comb begin
    reg_rdata_o = '0;
    if (sel_id) begin
      reg_rdata_o = IdValue;
    end else if (sel_version) begin
      reg_rdata_o = VersionValue;
    end else if (sel_global_ctrl) begin
      reg_rdata_o = {30'b0, 1'b0, global_enable_q};
    end else if (sel_global_status) begin
      reg_rdata_o = {23'b0, dma_busy_i, 8'(ch_busy_i)};
    end else if (sel_irq_state) begin
      reg_rdata_o = {24'b0, 8'(channel_summary)};
    end else if (sel_irq_enable) begin
      reg_rdata_o = {24'b0, 8'(irq_enable_q)};
    end else if (sel_err_inject) begin
      reg_rdata_o = err_inject_q;
    end else if (sel_axi_cfg) begin
      reg_rdata_o = {16'b0, axi_cfg_q[15:0]};
    end else if (sel_ch_ctrl) begin
      reg_rdata_o = {30'b0, ch_ctrl_q[sel_chan_idx]};
    end else if (sel_ch_status) begin
      reg_rdata_o = {30'b0, ch_err_i[sel_chan_idx], ch_busy_i[sel_chan_idx]};
    end else if (sel_ch_desc_base) begin
      reg_rdata_o = ch_desc_base_q[sel_chan_idx];
    end else if (sel_ch_desc_ctrl) begin
      reg_rdata_o = 32'b0;
    end else if (sel_ch_irq_state) begin
      reg_rdata_o = {28'b0, ch_irq_state_q[sel_chan_idx]};
    end else if (sel_ch_irq_enable) begin
      reg_rdata_o = {28'b0, ch_irq_enable_q[sel_chan_idx]};
    end else if (sel_ch_byte_cnt) begin
      reg_rdata_o = ch_byte_cnt_i[sel_chan_idx];
    end else if (sel_ch_pkt_cnt) begin
      reg_rdata_o = ch_pkt_cnt_i[sel_chan_idx];
    end else if (sel_ch_err_cnt) begin
      reg_rdata_o = ch_err_cnt_i[sel_chan_idx];
    end else if (sel_ch_stall_cnt) begin
      reg_rdata_o = ch_stall_cnt_i[sel_chan_idx];
    end else if (sel_ch_crc_status) begin
      reg_rdata_o = ch_crc_status_i[sel_chan_idx];
    end else if (sel_ch_ecc_status) begin
      reg_rdata_o = ch_ecc_status_i[sel_chan_idx];
    end
  end

  logic is_write;
  assign is_write = reg_valid_i & reg_write_i;

  assign soft_rst_pulse_o = is_write & sel_global_ctrl & reg_wstrb_i[0] & reg_wdata_i[1];

  always_comb begin
`ifdef MUT_CSR_GOALL
    ch_desc_go_o = {NumCh{1'b0}};
    if (is_write & sel_ch_desc_ctrl & sel_chan_valid & reg_wstrb_i[0] & reg_wdata_i[0]) begin
      ch_desc_go_o = {NumCh{1'b1}};
    end
`else
    ch_desc_go_o = '0;
    if (is_write & sel_ch_desc_ctrl & sel_chan_valid & reg_wstrb_i[0] & reg_wdata_i[0]) begin
      ch_desc_go_o[sel_chan_idx] = 1'b1;
    end
`endif
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      global_enable_q <= 1'b0;
      err_inject_q    <= '0;
      axi_cfg_q       <= {16'b0, 8'(4), MaxBurst[7:0]};
      irq_enable_q    <= '0;
      for (int unsigned c = 0; c < NumCh; c++) begin
        ch_ctrl_q[c]       <= '0;
        ch_desc_base_q[c]  <= '0;
        ch_irq_state_q[c]  <= '0;
        ch_irq_enable_q[c] <= '0;
      end
    end else begin
      if (is_write & sel_global_ctrl & reg_wstrb_i[0]) begin
        global_enable_q <= reg_wdata_i[0];
      end
      if (is_write & sel_irq_enable & reg_wstrb_i[0]) begin
        irq_enable_q <= reg_wdata_i[NumCh-1:0];
      end
      if (is_write & sel_err_inject) begin
        err_inject_q <= apply_wstrb(err_inject_q, reg_wdata_i, reg_wstrb_i);
      end
      if (is_write & sel_axi_cfg) begin
        axi_cfg_q <= apply_wstrb(axi_cfg_q, reg_wdata_i, reg_wstrb_i);
      end
      if (is_write & sel_ch_ctrl & sel_chan_valid & reg_wstrb_i[0]) begin
        ch_ctrl_q[sel_chan_idx] <= reg_wdata_i[1:0];
      end
      if (is_write & sel_ch_desc_base & sel_chan_valid) begin
        ch_desc_base_q[sel_chan_idx] <=
            apply_wstrb(ch_desc_base_q[sel_chan_idx], reg_wdata_i, reg_wstrb_i);
      end
      if (is_write & sel_ch_irq_enable & sel_chan_valid & reg_wstrb_i[0]) begin
        ch_irq_enable_q[sel_chan_idx] <= reg_wdata_i[3:0];
      end

      for (int unsigned c = 0; c < NumCh; c++) begin
        automatic logic [3:0] clear_mask;
        clear_mask = (is_write & sel_ch_irq_state & sel_chan_valid &
                      (sel_chan_idx == ChIdxW'(c)) & reg_wstrb_i[0])
                     ? reg_wdata_i[3:0] : 4'b0;
`ifdef MUT_CSR_IRQNOHW
        ch_irq_state_q[c] <= (ch_irq_state_q[c] | ch_cause_i[c]) & ~clear_mask;
`else
        ch_irq_state_q[c] <= (ch_irq_state_q[c] & ~clear_mask) | ch_cause_i[c];
`endif
      end
    end
  end

  always_comb begin
    for (int unsigned c = 0; c < NumCh; c++) begin
      ch_enable_o[c] = ch_ctrl_q[c][0];
      ch_abort_o[c]  = ch_ctrl_q[c][1];
    end
  end

  assign global_enable_o   = global_enable_q;
  assign err_inject_o      = err_inject_q;
  assign ch_desc_base_o    = ch_desc_base_q;
  assign axi_max_burst_o   = axi_cfg_q[7:0];
  assign axi_outstanding_o = axi_cfg_q[15:8];

endmodule
