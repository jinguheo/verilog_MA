// Formal harness for daq_csr - the register file (global bank + NumCh
// per-channel banks) behind axil_slave's regbus port. Single clock, single
// reset, no CDC of its own (that is chan_top's/daq_subsystem's job).
//
// NumCh fixed to 2 via -DDAQ_NUM_CH=2 (the package's own override, same
// mechanism dma_sched's proof already uses): 2 is the minimum that can
// exercise per-channel isolation at all ("writing channel 0 must not
// perturb channel 1"), and AxilAw/AxilDw are fixed widths independent of
// NumCh, so nothing here loses coverage by keeping the channel count small.
// Per-channel RO counter inputs (byte/pkt/err/stall/crc/ecc counts) are tied
// to fixed values, the same reasoning dma_sched_formal.sv's data/strobe
// ports use: they are pure read-mux pass-throughs no property below
// inspects, tying them off just keeps the cone of influence (and therefore
// the solve) small.
//
// What is proved
// -----------------------------------------------------------------------
//   - The address decode is genuinely one-hot: at most one sel_* signal
//     live at a time, matching the module header's own claim that the read
//     mux and the write-commit path cannot independently drift because they
//     share these signals - proved here rather than just asserted in prose.
//   - reg_error_o tracks addr_valid exactly (targets MUT_CSR_NODECERR).
//   - CH_DESC_CTRL's go pulse fires for the addressed channel only, and
//     only on the write cycle that asks for it - never sticky, never
//     broadcast (targets MUT_CSR_GOALL).
//   - GLOBAL_CTRL's soft_rst pulse tracks its own write condition exactly.
//   - CH_DESC_CTRL always reads back 0 (it stores nothing).
//   - irq_o is exactly the per-channel-enabled summary the header claims.
//   - Channel isolation: a write that does not name channel c leaves
//     channel c's own CH_CTRL/CH_DESC_BASE/CH_IRQ_ENABLE storage
//     byte-for-byte unchanged - the property that actually backs the
//     "hand-duplicated decode can't drift" claim for the *storage* side,
//     complementing the one-hot check on the *decode* side.
//   - CH_IRQ_STATE's W1C-with-simultaneous-hardware-set semantics, split
//     into the same three properties Sample Test 3's daq_status_sync.sby
//     already proved for its own single-register version of this pattern:
//     hardware always wins a same-cycle race, a clear takes effect on any
//     bit it names that hardware did not also set, and an untouched bit is
//     preserved exactly. Targets MUT_CSR_IRQNOHW.
//   - Reset defaults, once, on the first cycle out of reset.
module daq_csr_formal
  import daq_pkg::*;
(
  input logic clk_i,
  input logic reg_valid_i,
  input logic reg_write_i,
  input logic [15:0] reg_addr_i,
  input logic [31:0] reg_wdata_i,
  input logic [3:0]  reg_wstrb_i,
  input logic [1:0]  ch_busy_i,
  input logic        dma_busy_i,
  input logic [1:0]  ch_err_i,
  input logic [3:0]  ch_cause_i0,
  input logic [3:0]  ch_cause_i1
);
  logic rst_ni;

  wire [31:0] reg_rdata_o;
  wire        reg_error_o;
  wire        global_enable_o, soft_rst_pulse_o, irq_o;
  wire [31:0] err_inject_o;
  wire [7:0]  axi_max_burst_o, axi_outstanding_o;
  wire [1:0]  ch_enable_o, ch_abort_o, ch_desc_go_o;
  wire [31:0] ch_desc_base_o [2];

  logic [3:0]  ch_cause_i [2];
  assign ch_cause_i[0] = ch_cause_i0;
  assign ch_cause_i[1] = ch_cause_i1;

  // RO counter inputs - irrelevant to every property below, tied off.
  logic [31:0] zero32 [2];
  assign zero32[0] = 32'h0; assign zero32[1] = 32'h0;

  daq_csr dut(
    .clk_i(clk_i), .rst_ni(rst_ni),
    .reg_valid_i(reg_valid_i), .reg_write_i(reg_write_i),
    .reg_addr_i(reg_addr_i), .reg_wdata_i(reg_wdata_i), .reg_wstrb_i(reg_wstrb_i),
    .reg_rdata_o(reg_rdata_o), .reg_error_o(reg_error_o),
    .global_enable_o(global_enable_o), .soft_rst_pulse_o(soft_rst_pulse_o),
    .err_inject_o(err_inject_o),
    .axi_max_burst_o(axi_max_burst_o), .axi_outstanding_o(axi_outstanding_o),
    .ch_busy_i(ch_busy_i), .dma_busy_i(dma_busy_i), .irq_o(irq_o),
    .ch_enable_o(ch_enable_o), .ch_abort_o(ch_abort_o),
    .ch_desc_base_o(ch_desc_base_o), .ch_desc_go_o(ch_desc_go_o),
    .ch_err_i(ch_err_i), .ch_cause_i(ch_cause_i),
    .ch_byte_cnt_i(zero32), .ch_pkt_cnt_i(zero32), .ch_err_cnt_i(zero32),
    .ch_stall_cnt_i(zero32), .ch_crc_status_i(zero32), .ch_ecc_status_i(zero32)
  );

  reg [1:0] cyc = 0;
  always @(posedge clk_i) if (cyc < 3) cyc <= cyc + 1;
  assign rst_ni = (cyc >= 2);

  // ---- one-hot decode (current cycle, no history needed) ---------------------
  wire [18:0] all_sel = {
    dut.sel_id, dut.sel_version, dut.sel_global_ctrl, dut.sel_global_status,
    dut.sel_irq_state, dut.sel_irq_enable, dut.sel_err_inject, dut.sel_axi_cfg,
    dut.sel_ch_ctrl, dut.sel_ch_status, dut.sel_ch_desc_base, dut.sel_ch_desc_ctrl,
    dut.sel_ch_irq_state, dut.sel_ch_irq_enable, dut.sel_ch_byte_cnt,
    dut.sel_ch_pkt_cnt, dut.sel_ch_err_cnt, dut.sel_ch_stall_cnt,
    dut.sel_ch_crc_status
  };

  // clear_mask, recomputed here from the same inputs the RTL's own
  // (procedural-automatic, not hierarchically referenceable) clear_mask
  // uses, rather than reaching into the loop-local RTL variable itself.
  wire [3:0] clear_mask0 = (dut.is_write & dut.sel_ch_irq_state & dut.sel_chan_valid &
                             (dut.sel_chan_idx == 1'd0) & reg_wstrb_i[0]) ? reg_wdata_i[3:0] : 4'b0;
  wire [3:0] clear_mask1 = (dut.is_write & dut.sel_ch_irq_state & dut.sel_chan_valid &
                             (dut.sel_chan_idx == 1'd1) & reg_wstrb_i[0]) ? reg_wdata_i[3:0] : 4'b0;

  reg past_valid;
  reg p_is_write, p_sel_ch_ctrl, p_sel_ch_desc_base, p_sel_ch_irq_enable,
      p_sel_chan_valid;
  reg [0:0] p_sel_chan_idx;
  reg [3:0] p_wstrb;
  reg [3:0] p_clear_mask0, p_clear_mask1;
  reg [3:0] p_cause0, p_cause1;
  reg [1:0] p_ch_ctrl0, p_ch_ctrl1;
  reg [31:0] p_ch_desc_base0, p_ch_desc_base1;
  reg [3:0] p_ch_irq_enable0, p_ch_irq_enable1;
  reg [3:0] p_ch_irq_state0, p_ch_irq_state1;

  always @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      past_valid           <= 0;
      p_is_write           <= 0;
      p_sel_ch_ctrl        <= 0;
      p_sel_ch_desc_base   <= 0;
      p_sel_ch_irq_enable  <= 0;
      p_sel_chan_valid     <= 0;
      p_sel_chan_idx       <= 0;
      p_wstrb              <= 0;
      p_clear_mask0        <= 0;
      p_clear_mask1        <= 0;
      p_cause0             <= 0;
      p_cause1             <= 0;
      p_ch_ctrl0           <= 0;
      p_ch_ctrl1           <= 0;
      p_ch_desc_base0      <= 0;
      p_ch_desc_base1      <= 0;
      p_ch_irq_enable0     <= 0;
      p_ch_irq_enable1     <= 0;
      p_ch_irq_state0      <= 0;
      p_ch_irq_state1      <= 0;
    end else begin
      past_valid   <= 1;
      p_is_write          <= dut.is_write;
      p_sel_ch_ctrl        <= dut.sel_ch_ctrl;
      p_sel_ch_desc_base   <= dut.sel_ch_desc_base;
      p_sel_ch_irq_enable  <= dut.sel_ch_irq_enable;
      p_sel_chan_valid     <= dut.sel_chan_valid;
      p_sel_chan_idx       <= dut.sel_chan_idx;
      p_wstrb              <= reg_wstrb_i;
      p_clear_mask0        <= clear_mask0;
      p_clear_mask1        <= clear_mask1;
      p_cause0             <= ch_cause_i[0];
      p_cause1             <= ch_cause_i[1];
      p_ch_ctrl0           <= dut.ch_ctrl_q[0];
      p_ch_ctrl1           <= dut.ch_ctrl_q[1];
      p_ch_desc_base0      <= dut.ch_desc_base_q[0];
      p_ch_desc_base1      <= dut.ch_desc_base_q[1];
      p_ch_irq_enable0     <= dut.ch_irq_enable_q[0];
      p_ch_irq_enable1     <= dut.ch_irq_enable_q[1];
      p_ch_irq_state0      <= dut.ch_irq_state_q[0];
      p_ch_irq_state1      <= dut.ch_irq_state_q[1];
    end
  end

  always @(posedge clk_i) begin
    if (rst_ni) begin
      // Decode is genuinely one-hot (or all-zero for an unmapped address).
      assert ($countones(all_sel) <= 1);

      // reg_error_o tracks addr_valid exactly - MUT_CSR_NODECERR forces it
      // to 0 always, which this catches the instant addr_valid is 0 (any
      // address that decodes to nothing, freely explored since reg_addr_i
      // is unconstrained).
      assert (reg_error_o == ~dut.addr_valid);

      // go pulse: exactly the addressed channel, only on the cycle that
      // asks for it. Targets MUT_CSR_GOALL (fires on every channel).
      if (dut.is_write & dut.sel_ch_desc_ctrl & dut.sel_chan_valid &
          reg_wstrb_i[0] & reg_wdata_i[0]) begin
        assert (ch_desc_go_o == (2'b01 << dut.sel_chan_idx));
      end else begin
        assert (ch_desc_go_o == 2'b00);
      end

      // soft_rst pulse tracks its own write condition exactly.
      assert (soft_rst_pulse_o == (dut.is_write & dut.sel_global_ctrl &
                                    reg_wstrb_i[0] & reg_wdata_i[1]));

      // CH_DESC_CTRL stores nothing - always reads back 0.
      if (dut.sel_ch_desc_ctrl) assert (reg_rdata_o == 32'b0);

      // irq_o is exactly the per-channel-enabled summary.
      assert (dut.channel_summary[0] == |(dut.ch_irq_state_q[0] & dut.ch_irq_enable_q[0]));
      assert (dut.channel_summary[1] == |(dut.ch_irq_state_q[1] & dut.ch_irq_enable_q[1]));
      assert (irq_o == |(dut.channel_summary & dut.irq_enable_q));
    end

    if (rst_ni && past_valid) begin
      // Channel isolation: a write that did not target channel c leaves
      // its CH_CTRL/CH_DESC_BASE/CH_IRQ_ENABLE storage untouched. Covers
      // both "a write to a different channel" and "a write to a different
      // register entirely" in one property per register.
      if (!(p_sel_ch_ctrl && p_sel_chan_valid && p_wstrb[0] && p_sel_chan_idx == 1'd0))
        assert (dut.ch_ctrl_q[0] == p_ch_ctrl0);
      if (!(p_sel_ch_ctrl && p_sel_chan_valid && p_wstrb[0] && p_sel_chan_idx == 1'd1))
        assert (dut.ch_ctrl_q[1] == p_ch_ctrl1);

      if (!(p_sel_ch_desc_base && p_sel_chan_valid && p_sel_chan_idx == 1'd0))
        assert (dut.ch_desc_base_q[0] == p_ch_desc_base0);
      if (!(p_sel_ch_desc_base && p_sel_chan_valid && p_sel_chan_idx == 1'd1))
        assert (dut.ch_desc_base_q[1] == p_ch_desc_base1);

      if (!(p_sel_ch_irq_enable && p_sel_chan_valid && p_wstrb[0] && p_sel_chan_idx == 1'd0))
        assert (dut.ch_irq_enable_q[0] == p_ch_irq_enable0);
      if (!(p_sel_ch_irq_enable && p_sel_chan_valid && p_wstrb[0] && p_sel_chan_idx == 1'd1))
        assert (dut.ch_irq_enable_q[1] == p_ch_irq_enable1);

      // CH_IRQ_STATE W1C, hardware-set-wins-a-same-cycle-race, per channel -
      // same three-property split Sample Test 3's daq_status_sync.sby uses.
      // (1) hardware always wins: every bit set last cycle is set now,
      //     regardless of any clear that also targeted it.
      assert ((dut.ch_irq_state_q[0] & p_cause0) == p_cause0);
      assert ((dut.ch_irq_state_q[1] & p_cause1) == p_cause1);
      // (2) a clear takes effect on any bit it names that hardware did not
      //     also set this same cycle.
      assert ((dut.ch_irq_state_q[0] & p_clear_mask0 & ~p_cause0) == 4'b0);
      assert ((dut.ch_irq_state_q[1] & p_clear_mask1 & ~p_cause1) == 4'b0);
      // (3) a bit neither cleared nor set is preserved exactly.
      assert ((dut.ch_irq_state_q[0] & ~p_clear_mask0 & ~p_cause0) ==
              (p_ch_irq_state0 & ~p_clear_mask0 & ~p_cause0));
      assert ((dut.ch_irq_state_q[1] & ~p_clear_mask1 & ~p_cause1) ==
              (p_ch_irq_state1 & ~p_clear_mask1 & ~p_cause1));
    end

    // Reset defaults, checked once on the first cycle out of reset.
    if (rst_ni && !past_valid) begin
      assert (dut.global_enable_q == 1'b0);
      assert (dut.err_inject_q == 32'b0);
      assert (dut.axi_cfg_q == {16'b0, 8'(4), MaxBurst[7:0]});
      assert (dut.irq_enable_q == 2'b0);
      assert (dut.ch_ctrl_q[0] == 2'b0 && dut.ch_ctrl_q[1] == 2'b0);
      assert (dut.ch_desc_base_q[0] == 32'b0 && dut.ch_desc_base_q[1] == 32'b0);
      assert (dut.ch_irq_state_q[0] == 4'b0 && dut.ch_irq_state_q[1] == 4'b0);
      assert (dut.ch_irq_enable_q[0] == 4'b0 && dut.ch_irq_enable_q[1] == 4'b0);
    end
  end
endmodule
