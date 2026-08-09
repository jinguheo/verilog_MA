// Formal harness for daq_top's register file, DMA FSM and write-port
// protocol. All three clocks are free inputs and the proof runs with
// `multiclock on`, so the control, source and DMA domains are modelled as
// genuinely asynchronous.
//
// These properties are the formal counterparts of the `ifndef SYNTHESIS` SVA
// inside daq_top, restated without `disable iff` / `|=>` / `$stable` because
// the bundled slang frontend rejects those constructs (see
// samples/sample_test_2/formal/prim_fifo_sync.sby for the same tooling gap).
// The one-cycle history they need is kept in explicit registers instead.
module status_formal_top(
  input logic ctrl_clk, src_clk, dma_clk,
  input logic csr_we, csr_re,
  input logic [3:0] csr_addr,
  input logic [31:0] csr_wdata,
  input logic src_valid, src_sop, src_eop,
  input logic [7:0] src_data,
  input logic dma_wready, dma_wresp_err
);
  // FSM encodings, mirroring the typedef inside daq_top. The raw encoding is
  // used rather than the enum so the properties do not depend on a
  // hierarchical type reference.
  localparam logic [2:0] S_IDLE=3'd0, S_ARMED=3'd1, S_XFER=3'd2, S_COMPLETE=3'd3, S_ERROR=3'd4;

  logic rst_n;
  wire src_ready, dma_wvalid, irq, done, crc_error, bus_error, fifo_overflow;
  wire [3:0] dma_waddr;
  wire [7:0] dma_wdata, mem0, mem1, mem2, mem3;
  wire [31:0] csr_rdata;

  daq_top dut(
    .ctrl_clk(ctrl_clk), .src_clk(src_clk), .dma_clk(dma_clk), .rst_n(rst_n),
    .csr_we(csr_we), .csr_re(csr_re), .csr_addr(csr_addr), .csr_wdata(csr_wdata), .csr_rdata(csr_rdata),
    .src_valid(src_valid), .src_ready(src_ready), .src_sop(src_sop), .src_eop(src_eop), .src_data(src_data),
    .dma_wready(dma_wready), .dma_wresp_err(dma_wresp_err),
    .dma_wvalid(dma_wvalid), .dma_waddr(dma_waddr), .dma_wdata(dma_wdata),
    .irq(irq), .done(done), .crc_error(crc_error), .bus_error(bus_error), .fifo_overflow(fifo_overflow),
    .mem0(mem0), .mem1(mem1), .mem2(mem2), .mem3(mem3)
  );

  // Drive reset from a counter rather than assuming it, so the trace always
  // starts from the real post-reset state.
  reg [1:0] cyc = 0;
  always @(posedge dma_clk) if (cyc < 3) cyc <= cyc + 1;
  assign rst_n = (cyc >= 2);

  // bad_irq is the deliberate "raise IRQ with no cause" hook that
  // +ASSERT_FAIL_DEMO uses to prove p_irq_has_cause can fail. It is
  // fault-injection, so it is held disabled here. The constraint is placed on
  // the registers rather than on the CSR write, so that it also holds in the
  // induction step's arbitrary start state.
  always @* assume(!dut.bad_irq_ctrl && !dut.bad_irq_d1 && !dut.bad_irq_d2);

  // One-cycle history, sampled in the DMA domain.
  reg past_valid, p_wvalid, p_wready, p_enable, p_pop, p_crc_consume;
  reg p_cmd_clear, p_w1c;
  reg [3:0] p_mask, p_intr, p_set;
  reg [2:0] p_state;
  reg [3:0] p_waddr;
  reg [7:0] p_wdata;
  always @(posedge dma_clk or negedge rst_n) begin
    if (!rst_n) begin
      past_valid <= 0; p_wvalid <= 0; p_wready <= 0; p_enable <= 0;
      p_pop <= 0; p_crc_consume <= 0; p_cmd_clear <= 0; p_w1c <= 0;
      p_mask <= '0; p_intr <= '0; p_set <= '0; p_state <= S_IDLE;
      p_waddr <= '0; p_wdata <= '0;
    end else begin
      past_valid <= 1;
      p_wvalid <= dma_wvalid; p_wready <= dma_wready; p_enable <= dut.enable_d2;
      p_pop <= dut.fifo_pop; p_crc_consume <= dut.crc_consume;
      p_cmd_clear <= dut.cmd_clear; p_w1c <= dut.w1c_apply; p_mask <= dut.w1c_mask_d;
      p_intr <= dut.intr_state; p_set <= dut.intr_set; p_state <= dut.state;
      p_waddr <= dma_waddr; p_wdata <= dma_wdata;
    end
  end

  // Harness self-check. Every property below compares a value registered one
  // dma_clk edge ago against the value visible now, which is only sound if
  // "one assertion evaluation" really is "one edge later" once clk2fflogic has
  // lowered the design. This counter pair states exactly that and nothing
  // else: if it holds, the one-edge-history model is sound and any other
  // failure is about the DUT; if it fails, the history registers are
  // misaligned and every property here is measuring the wrong pair of states.
  reg [3:0] tick, p_tick;
  always @(posedge dma_clk or negedge rst_n) begin
    if (!rst_n) begin tick <= 0; p_tick <= 0; end
    else begin tick <= tick + 1; p_tick <= tick; end
  end

  always @(posedge dma_clk) begin
    if (rst_n && past_valid) begin
      assert (tick == 4'(p_tick + 1));

      // --- Interrupt ------------------------------------------------------
      // An interrupt always has a cause, and the mask is honoured exactly.
      assert (irq == (|(dut.intr_state & dut.intr_en_d2)));
      assert (!irq || |dut.intr_state);

      // --- Interrupt state: sticky, per-bit W1C, set wins over clear -------
      for (int i = 0; i < 4; i++) begin
        // A pending cause stays pending unless cleared by the command or by a
        // W1C write that names that specific bit.
        if (p_intr[i] && !p_cmd_clear && !(p_w1c && p_mask[i]))
          assert (dut.intr_state[i]);
        // A W1C write clears exactly the bits it names - no more.
        if (p_w1c && p_mask[i] && !p_set[i] && !p_cmd_clear)
          assert (!dut.intr_state[i]);
        // A cause arriving in the same cycle as a clear is not lost.
        if (p_set[i] && !p_cmd_clear)
          assert (dut.intr_state[i]);
      end
      // The command clear takes everything down at once.
      if (p_cmd_clear) assert (dut.intr_state == 4'b0);

      // --- DMA FSM --------------------------------------------------------
      // The encoding is never outside the declared states ...
      assert (dut.state <= S_ERROR);
      // ... and every transition is one of the legal ones.
      case (p_state)
        S_IDLE:     assert (dut.state == S_IDLE || dut.state == S_ARMED);
        S_ARMED:    assert (dut.state == S_IDLE || dut.state == S_ARMED || dut.state == S_XFER);
        S_XFER:     assert (dut.state == S_IDLE || dut.state == S_XFER ||
                            dut.state == S_COMPLETE || dut.state == S_ERROR);
        S_COMPLETE: assert (dut.state == S_IDLE || dut.state == S_COMPLETE);
        S_ERROR:    assert (dut.state == S_IDLE || dut.state == S_ERROR);
        default:    assert (dut.state == S_IDLE);
      endcase
      // The clear command always returns the engine to idle.
      if (p_cmd_clear) assert (dut.state == S_IDLE);
      // The bus is only ever driven from the transfer state.
      assert (!dma_wvalid || dut.state == S_XFER);

      // --- DMA write-port protocol ----------------------------------------
      // Backpressure safety: a beat that goes to the bus is only retired on an
      // accepted handshake. The CRC beat never reaches the bus, is consumed
      // internally, and is carved out.
      assert (!(dut.fifo_pop && !dut.crc_consume) || dma_wready);
      // AXI-style request stability: a stalled request keeps its address and
      // data until it is accepted. Disabling the block or issuing the clear
      // command is a deliberate abort.
      //
      // The enable carve-out has to be on BOTH sides of the edge. The FSM
      // decides to abort using enable as it was at the sampling edge, but
      // enable can go back up before the next one - the engine found exactly
      // that trace: enable low for a single cycle in S_XFER with a stalled
      // request, state to IDLE, and enable already high again by the time this
      // fires. Checking only the current enable makes the property strictly
      // stronger than the design contract; checking only the sampled one lets
      // a genuine violation through.
      if (p_wvalid && !p_wready && p_enable && !p_cmd_clear && !dut.cmd_clear)
        assert (!dut.enable_d2 || (dma_wvalid && dma_waddr == p_waddr && dma_wdata == p_wdata));
      // The DMA write pointer must stay inside the 16-entry memory window.
      assert (dma_waddr == dut.wr_ptr[3:0]);
    end
  end
endmodule

// Single-clock abstraction of the same properties.
//
// Why it exists: under `multiclock on` the clocks are free inputs, and an
// induction trace of any depth may contain zero clock edges. Every property
// above compares a registered value against the current one, so on such a
// trace the engine simply picks an arbitrary, unreachable pair and reports it
// - a spurious counterexample that no depth increase can fix. Tying the three
// clocks together removes the free-clock degree of freedom and gives induction
// real leverage.
//
// What it costs: this proves the logic only for the case where control,
// source and DMA advance together. It says nothing about clock-domain
// crossing - that is what daq_status.sby (bounded, multiclock) and the UVM
// clock-ratio sweep cover. The two results are complementary, and neither one
// alone is a full proof of the block.
module status_sync_formal_top(
  input logic clk,
  input logic csr_we, csr_re,
  input logic [3:0] csr_addr,
  input logic [31:0] csr_wdata,
  input logic src_valid, src_sop, src_eop,
  input logic [7:0] src_data,
  input logic dma_wready, dma_wresp_err
);
  status_formal_top u_props(
    .ctrl_clk(clk), .src_clk(clk), .dma_clk(clk),
    .csr_we(csr_we), .csr_re(csr_re), .csr_addr(csr_addr), .csr_wdata(csr_wdata),
    .src_valid(src_valid), .src_sop(src_sop), .src_eop(src_eop), .src_data(src_data),
    .dma_wready(dma_wready), .dma_wresp_err(dma_wresp_err)
  );

  // FIFO invariants, needed as induction helpers.
  //
  // Without them the request-stability property fails from an arbitrary start
  // state: with w_full low while the buffer is actually full, a write lands on
  // mem[rbin] and changes dma_wdata underneath a stalled request. That state is
  // unreachable, but induction has no way to know it.
  //
  // These are asserted, not assumed, so they are proof obligations too - and
  // they are stated only here, in the single-clock abstraction, where the
  // one-edge lag bounds genuinely hold (each pointer advances by at most one
  // per edge and each synchronizer stage is that pointer delayed by one edge).
  // The same bounds are NOT true of the multiclock model and are deliberately
  // absent from daq_fifo_formal.sv.
  localparam int FDEPTH = 8;
  function automatic [3:0] g2b(input [3:0] g);
    g2b[3] = g[3]; g2b[2] = g[2] ^ g2b[3]; g2b[1] = g[1] ^ g2b[2]; g2b[0] = g[0] ^ g2b[1];
  endfunction
  wire [3:0] wbin    = u_props.dut.u_fifo.wbin;
  wire [3:0] rbin    = u_props.dut.u_fifo.rbin;
  wire [3:0] rbin_w1 = g2b(u_props.dut.u_fifo.rgray_w1);
  wire [3:0] rbin_w2 = g2b(u_props.dut.u_fifo.rgray_w2);
  wire [3:0] wbin_r1 = g2b(u_props.dut.u_fifo.wgray_r1);
  wire [3:0] wbin_r2 = g2b(u_props.dut.u_fifo.wgray_r2);
  wire [3:0] occ     = wbin - rbin;

  // w_full and r_empty are registered from a comparison that used the
  // synchronizer stage's value *before* the edge, so pinning them down needs
  // one more stage of history than the FIFO itself keeps.
  reg [3:0] rbin_w2_d, wbin_r2_d;
  always @(posedge clk or negedge u_props.rst_n) begin
    if (!u_props.rst_n) begin rbin_w2_d <= 0; wbin_r2_d <= 0; end
    else begin rbin_w2_d <= rbin_w2; wbin_r2_d <= wbin_r2; end
  end

  always @* begin
    if (u_props.rst_n) begin
      // Gray encoding is maintained.
      assert (u_props.dut.u_fifo.wgray == 4'((wbin >> 1) ^ wbin));
      assert (u_props.dut.u_fifo.rgray == 4'((rbin >> 1) ^ rbin));
      // Each stage lags its source by at most one edge.
      assert (4'(rbin - rbin_w1)     <= 1);
      assert (4'(rbin_w1 - rbin_w2)  <= 1);
      assert (4'(rbin_w2 - rbin_w2_d)<= 1);
      assert (4'(wbin - wbin_r1)     <= 1);
      assert (4'(wbin_r1 - wbin_r2)  <= 1);
      assert (4'(wbin_r2 - wbin_r2_d)<= 1);
      // Exact definitions of the two flags, one edge after they were computed.
      assert (u_props.dut.u_fifo.w_full  == (4'(wbin - rbin_w2_d) == FDEPTH));
      assert (u_props.dut.u_fifo.r_empty == (4'(rbin - wbin_r2_d) == 0));
      // Note the direction: the writer runs ahead of its stale view of the
      // reader, while the reader runs *behind* its stale view of the writer.
      assert (4'(wbin - rbin_w2_d) <= FDEPTH);
      assert (4'(wbin_r2_d - rbin) <= FDEPTH);
      // The consequences that the status properties actually rely on.
      assert (occ <= FDEPTH);
      assert (u_props.dut.u_fifo.w_full  || occ < FDEPTH);
      assert (u_props.dut.u_fifo.r_empty || occ > 0);
    end
  end
endmodule
