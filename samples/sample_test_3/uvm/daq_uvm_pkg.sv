package daq_uvm_pkg;
  import uvm_pkg::*;
  `include "uvm_macros.svh"

  class daq_test extends uvm_test;
    virtual daq_if vif;
    `uvm_component_utils(daq_test)
    function new(string name="daq_test",uvm_component parent=null); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase); if(!uvm_config_db#(virtual daq_if)::get(this,"","vif",vif)) `uvm_fatal("NOVIF","interface missing") endfunction

    // Register map - kept in step with rtl/daq_top.sv.
    localparam bit [3:0] A_CTRL=4'd0, A_CMD=4'd1, A_INTR_EN=4'd2, A_INTR_STATE=4'd3,
                         A_STATUS=4'd4, A_ID=4'd5;
    localparam int I_DONE=0, I_CRC=1, I_BUS=2, I_OVF=3;
    localparam bit [31:0] ID_VALUE = 32'h0DA0_0001;

    // ---------------------------------------------------------------------
    // DMA memory model and end-to-end stream scoreboard. src_q records every
    // payload byte the DUT accepted on the source port, wr_q every byte it
    // wrote out on the DMA port. The CRC beat is not payload and is excluded
    // from src_q, because it is consumed internally and never reaches the bus.
    // ---------------------------------------------------------------------
    int unsigned stall_pct;
    bit          force_stall;
    int          err_on_beat = -1;
    int unsigned beat_count;
    byte         src_q[$], wr_q[$];
    int unsigned addr_q[$];
    int unsigned checks_passed;

    function void clear_tracking();
      src_q.delete(); wr_q.delete(); addr_q.delete(); beat_count = 0;
    endfunction

    // Reference CRC-8, polynomial 0x07, init 0x00. Must match crc8_next in the RTL.
    function automatic bit [7:0] crc8_next(bit [7:0] crc, bit [7:0] d);
      bit [7:0] c = crc ^ d;
      for (int i = 0; i < 8; i++) c = c[7] ? bit'(8'((c << 1)) ^ 8'h07) : 8'((c << 1));
      return c;
    endfunction
    function automatic bit [7:0] crc8_of(const ref byte payload[$]);
      bit [7:0] c = 8'h00;
      foreach (payload[i]) c = crc8_next(c, payload[i]);
      return c;
    endfunction

    task automatic mem_responder();
      forever begin
        @(negedge vif.dma_clk);
        if (force_stall)          vif.dma_wready <= 0;
        else if (stall_pct == 0)  vif.dma_wready <= 1;
        else                      vif.dma_wready <= ($urandom_range(99) >= stall_pct);
        vif.dma_wresp_err <= (err_on_beat >= 0 && beat_count == unsigned'(err_on_beat));
      end
    endtask

    task automatic dma_monitor();
      forever begin
        @(posedge vif.dma_clk);
        if (vif.rst_n && vif.dma_wvalid && vif.dma_wready) begin
          wr_q.push_back(vif.dma_wdata);
          addr_q.push_back(vif.dma_waddr);
          beat_count++;
        end
      end
    endtask

    task automatic src_monitor();
      forever begin
        @(posedge vif.src_clk);
        // src_eop marks the CRC beat, which is metadata rather than payload.
        if (vif.rst_n && vif.src_valid && vif.src_ready && !vif.src_eop) src_q.push_back(vif.src_data);
      end
    endtask

    // ---------------------------------------------------------------------
    // CSR access
    // ---------------------------------------------------------------------
    task csr_write(bit [3:0] addr, bit [31:0] data);
      @(negedge vif.ctrl_clk); vif.csr_addr<=addr; vif.csr_wdata<=data; vif.csr_we<=1;
      @(posedge vif.ctrl_clk); @(negedge vif.ctrl_clk); vif.csr_we<=0;
    endtask

    // csr_rdata is combinational off csr_addr; csr_re is driven for protocol
    // realism only.
    task csr_read(bit [3:0] addr, output bit [31:0] data);
      @(negedge vif.ctrl_clk); vif.csr_addr<=addr; vif.csr_re<=1;
      @(posedge vif.ctrl_clk); data = vif.csr_rdata;
      @(negedge vif.ctrl_clk); vif.csr_re<=0;
    endtask

    task set_ctrl(bit enable, bit inject, bit bad_irq=0);
      csr_write(A_CTRL, {29'b0, bad_irq, inject, enable});
    endtask

    // ---------------------------------------------------------------------
    // Stimulus
    // ---------------------------------------------------------------------
    task send_beat(byte data, bit sop, bit eop);
      @(negedge vif.src_clk); while(!vif.src_ready) @(negedge vif.src_clk);
      vif.src_data<=data; vif.src_sop<=sop; vif.src_eop<=eop; vif.src_valid<=1;
      @(posedge vif.src_clk); @(negedge vif.src_clk); vif.src_valid<=0;
    endtask

    // Deliberately ignores src_ready - used by the overflow stress test to
    // offer more bytes than the FIFO can hold.
    task send_beat_nowait(byte data, bit sop, bit eop);
      @(negedge vif.src_clk); vif.src_data<=data; vif.src_sop<=sop; vif.src_eop<=eop; vif.src_valid<=1;
      @(posedge vif.src_clk); @(negedge vif.src_clk); vif.src_valid<=0;
    endtask

    // A packet is payload with sop on the first byte, then one final beat with
    // eop=1 carrying the CRC-8 of the payload. bad_crc corrupts the appended
    // value so the DUT's comparison is what fails.
    task send_packet(const ref byte payload[$], input bit bad_crc = 0);
      bit [7:0] c = crc8_of(payload);
      foreach (payload[i]) send_beat(payload[i], i == 0, 1'b0);
      send_beat(bad_crc ? byte'(c ^ 8'h5A) : byte'(c), 1'b0, 1'b1);
    endtask

    task reset_dut();
      vif.csr_we<=0; vif.csr_re<=0; vif.csr_addr<=0; vif.csr_wdata<=0;
      vif.src_valid<=0; vif.src_data<=0; vif.src_sop<=0; vif.src_eop<=0;
      vif.dma_wready<=1; vif.dma_wresp_err<=0;
      vif.rst_n<=0; repeat(3) @(posedge vif.ctrl_clk); repeat(3) @(posedge vif.dma_clk);
      vif.rst_n<=1; repeat(5) @(posedge vif.dma_clk);
      // irq is masked out of reset, so every test that expects an interrupt
      // has to enable the causes it cares about first.
      csr_write(A_INTR_EN, 32'hF);
      clear_tracking();
    endtask

    // Cycle counts are never hardcoded against a clock ratio: the three
    // domains can be re-randomized per run (+RANDOM_CLOCKS), so every wait is
    // a bounded poll on the condition it actually cares about.
    task wait_done(int unsigned max_cycles, string tag);
      int unsigned n = 0;
      while (!vif.done && n < max_cycles) begin @(posedge vif.dma_clk); n++; end
      if (!vif.done) `uvm_error(tag, $sformatf("timeout after %0d dma cycles waiting for done", max_cycles))
    endtask

    task wait_bit(int unsigned idx, int unsigned max_cycles, string tag);
      int unsigned n = 0;
      bit hit = 0;
      while (!hit && n < max_cycles) begin
        case (idx)
          I_DONE: hit = vif.done;
          I_CRC:  hit = vif.crc_error;
          I_BUS:  hit = vif.bus_error;
          default: hit = 1;
        endcase
        if (!hit) begin @(posedge vif.dma_clk); n++; end
      end
      if (!hit) `uvm_error(tag, $sformatf("timeout after %0d dma cycles waiting for intr bit %0d", max_cycles, idx))
    endtask

    task wait_drain(int unsigned expected, int unsigned max_cycles, string tag);
      int unsigned n = 0;
      while (wr_q.size() < expected && n < max_cycles) begin @(posedge vif.dma_clk); n++; end
      if (wr_q.size() < expected)
        `uvm_error(tag, $sformatf("timeout: DMA wrote %0d of %0d accepted bytes", wr_q.size(), expected))
    endtask

    // Readback crosses back into ctrl_clk through two-flop synchronizers, so
    // poll rather than assume it has landed.
    task wait_readback(bit [3:0] addr, bit [31:0] mask, bit [31:0] expect_val,
                       int unsigned max_reads, string tag);
      bit [31:0] rd;
      int unsigned n = 0;
      forever begin
        csr_read(addr, rd);
        if ((rd & mask) == expect_val) break;
        n++;
        if (n >= max_reads) begin
          `uvm_error(tag, $sformatf("readback of reg %0d stuck at %08h, expected %08h under mask %08h", addr, rd, expect_val, mask))
          break;
        end
      end
    endtask

    // ---------------------------------------------------------------------
    // Checks
    // ---------------------------------------------------------------------
    function void check_stream(string tag);
      if (src_q.size() == 0) begin `uvm_error(tag, "no payload bytes were accepted on the source port") return; end
      if (wr_q.size() != src_q.size()) begin
        `uvm_error(tag, $sformatf("stream length mismatch: accepted %0d, written %0d", src_q.size(), wr_q.size()))
        return;
      end
      foreach (src_q[i])
        if (wr_q[i] !== src_q[i]) begin
          `uvm_error(tag, $sformatf("stream mismatch at index %0d: accepted %02h, written %02h", i, src_q[i], wr_q[i]))
          return;
        end
      foreach (addr_q[i])
        if (addr_q[i] !== (i % 16)) begin
          `uvm_error(tag, $sformatf("DMA address out of order at beat %0d: expected %0d, got %0d", i, i%16, addr_q[i]))
          return;
        end
      checks_passed++;
      `uvm_info(tag, $sformatf("stream PASS: %0d bytes in order, addresses sequential", wr_q.size()), UVM_NONE)
    endfunction

    task check_good_packet();
      byte pl[$] = '{8'h11, 8'h22, 8'h33, 8'h44};
      bit [31:0] rd;
      reset_dut();
      set_ctrl(1, 0);
      send_packet(pl);
      wait_done(400, "DAQ-NOMINAL");
      if(!vif.done || !vif.irq || vif.crc_error || vif.bus_error) `uvm_error("DAQ-NOMINAL","done/irq/CRC/bus status mismatch")
      if(vif.mem0!==8'h11 || vif.mem1!==8'h22 || vif.mem2!==8'h33 || vif.mem3!==8'h44) `uvm_error("DAQ-SB","memory ordering mismatch")
      else `uvm_info("DAQ-SB","nominal memory scoreboard PASS: 4 bytes",UVM_NONE);
      // The CRC beat must not land in memory - byte_count counts payload only.
      wait_readback(A_STATUS, 32'h0000FF01, 32'h00000400, 40, "DAQ-NOMINAL");
      csr_read(A_STATUS, rd);
      `uvm_info("DAQ-NOMINAL",$sformatf("STATUS readback: byte_count=%0d busy=%0d",rd[15:8],rd[0]),UVM_NONE)
      checks_passed++;
      check_stream("DAQ-NOMINAL");
    endtask

    // A corrupted CRC must be caught by the DUT's own comparison, and the
    // payload must still have been delivered.
    task check_crc_fault();
      byte pl[$] = '{8'ha1, 8'hb2};
      reset_dut(); set_ctrl(1, 0);
      send_packet(pl, .bad_crc(1));
      wait_bit(I_CRC, 400, "DAQ-CRC");
      if(!vif.done || !vif.irq || !vif.crc_error) `uvm_error("DAQ-CRC","corrupted CRC did not create done+irq+sticky crc_error")
      else begin checks_passed++; `uvm_info("DAQ-CRC","CRC mismatch PASS: detected by the DUT's own comparison",UVM_NONE); end
      check_stream("DAQ-CRC");
    endtask

    // The inject bit corrupts the computed CRC instead of the transmitted one,
    // so a well-formed packet is flagged. Same detector, opposite side.
    task check_crc_inject();
      byte pl[$] = '{8'h5a, 8'h6b, 8'h7c};
      reset_dut(); set_ctrl(1, 1);
      send_packet(pl);
      wait_bit(I_CRC, 400, "DAQ-CRCINJ");
      if(!vif.crc_error || !vif.irq) `uvm_error("DAQ-CRCINJ","injected CRC fault did not raise crc_error+irq")
      else begin checks_passed++; `uvm_info("DAQ-CRCINJ","CRC fault injection PASS",UVM_NONE); end
      check_stream("DAQ-CRCINJ");
    endtask

    // Heavy random backpressure. The pipeline must stall all the way back to
    // src_ready instead of dropping or duplicating beats.
    task check_backpressure();
      byte pl[$];
      reset_dut();
      for (int i = 0; i < 8; i++) pl.push_back(8'h50 + byte'(i));
      stall_pct = 60;
      set_ctrl(1, 0);
      send_packet(pl);
      wait_done(3000, "DAQ-BACKPRESSURE");
      wait_drain(8, 3000, "DAQ-BACKPRESSURE");
      stall_pct = 0;
      if (vif.fifo_overflow) `uvm_error("DAQ-BACKPRESSURE","fifo_overflow asserted although the source honoured src_ready")
      if (vif.bus_error)     `uvm_error("DAQ-BACKPRESSURE","bus_error asserted with no injected write-response error")
      if (vif.crc_error)     `uvm_error("DAQ-BACKPRESSURE","crc_error asserted on a well-formed packet")
      check_stream("DAQ-BACKPRESSURE");
    endtask

    // A failing write response aborts the transfer: the FSM goes to ERROR,
    // bus_error latches, and no further beats are issued.
    task check_bus_error();
      byte pl[$] = '{8'h90, 8'h91, 8'h92, 8'h93};
      int unsigned n_after;
      reset_dut();
      err_on_beat = 1;
      set_ctrl(1, 0);
      // The transfer aborts on the error, so the FIFO stops draining and this
      // sender blocks on src_ready forever. It has to be killed by label - a
      // bare `disable fork` here would also take out the monitors, which are
      // children of the same run_phase process.
      fork : buserr_sender
        send_packet(pl);
      join_none
      wait_bit(I_BUS, 600, "DAQ-BUSERR");
      err_on_beat = -1;
      if (!vif.bus_error) `uvm_error("DAQ-BUSERR","injected write-response error did not latch bus_error")
      else if (!vif.irq)  `uvm_error("DAQ-BUSERR","bus_error did not raise irq")
      else if (vif.done)  `uvm_error("DAQ-BUSERR","transfer reported done despite a bus error")
      else begin checks_passed++; `uvm_info("DAQ-BUSERR","write-response error PASS: sticky bus_error, irq, no completion",UVM_NONE); end
      n_after = wr_q.size();
      repeat (30) @(posedge vif.dma_clk);
      if (wr_q.size() != n_after) `uvm_error("DAQ-BUSERR",$sformatf("DMA kept writing after the error: %0d -> %0d beats", n_after, wr_q.size()))
      else begin checks_passed++; `uvm_info("DAQ-BUSERR",$sformatf("transfer aborted after %0d beats",n_after),UVM_NONE); end
      disable buserr_sender;
      vif.src_valid <= 0;
      set_ctrl(0, 0); csr_write(A_CMD, 32'h1); repeat (10) @(posedge vif.dma_clk);
    endtask

    // Offer 12 bytes into an 8-deep FIFO with the DMA side disabled. No CRC
    // beat here - this test is about the FIFO limit, not packet framing.
    task check_overflow_stress();
      int unsigned accepted;
      reset_dut();
      set_ctrl(0, 0);
      for (int i = 0; i < 12; i++) send_beat_nowait(8'hd0 + byte'(i), i==0, 1'b0);
      repeat (4) @(posedge vif.src_clk);
      accepted = src_q.size();
      if (!vif.fifo_overflow) `uvm_error("DAQ-OVERFLOW","offered 12 bytes into an 8-deep FIFO but fifo_overflow never asserted")
      if (vif.src_ready)      `uvm_error("DAQ-OVERFLOW","src_ready still high after the FIFO should have filled")
      if (accepted != 8)      `uvm_error("DAQ-OVERFLOW",$sformatf("FIFO accepted %0d bytes; an 8-deep FIFO with no drain must accept exactly 8", accepted))
      if (wr_q.size() != 0)   `uvm_error("DAQ-OVERFLOW",$sformatf("%0d DMA writes happened while the block was disabled", wr_q.size()))
      set_ctrl(1, 0);
      wait_drain(accepted, 3000, "DAQ-OVERFLOW");
      check_stream("DAQ-OVERFLOW");
      `uvm_info("DAQ-OVERFLOW",$sformatf("backpressure held at %0d accepted of 12 offered; overflow flagged",accepted),UVM_NONE)
    endtask

    // Reset asserted mid-packet must clear every status bit, empty the FIFO,
    // return the FSM to idle, and leave the block able to complete a packet.
    task check_reset_during_traffic();
      byte pl[$] = '{8'h81, 8'h82, 8'h83, 8'h84};
      reset_dut();
      set_ctrl(1, 0);
      send_beat(8'h71, 1'b1, 1'b0); send_beat(8'h72, 1'b0, 1'b0); // packet left unterminated
      vif.rst_n<=0; repeat(3) @(posedge vif.ctrl_clk); repeat(3) @(posedge vif.dma_clk);
      vif.rst_n<=1; repeat(5) @(posedge vif.dma_clk);
      clear_tracking();
      if (vif.done || vif.irq || vif.crc_error || vif.bus_error || vif.fifo_overflow)
        `uvm_error("DAQ-RESET","status bits not cleared by reset during traffic")
      if (!vif.src_ready) `uvm_error("DAQ-RESET","src_ready low after reset - FIFO did not return to empty")
      if (vif.dma_wvalid) `uvm_error("DAQ-RESET","dma_wvalid still asserted after reset")
      csr_write(A_INTR_EN, 32'hF);
      set_ctrl(1, 0);
      send_packet(pl);
      wait_done(600, "DAQ-RESET");
      wait_drain(4, 600, "DAQ-RESET");
      if (vif.mem0!==8'h81 || vif.mem1!==8'h82 || vif.mem2!==8'h83 || vif.mem3!==8'h84)
        `uvm_error("DAQ-RESET","post-reset packet did not land in memory from address 0")
      else begin checks_passed++; `uvm_info("DAQ-RESET","reset-during-traffic PASS: recovered and completed a full packet",UVM_NONE); end
      check_stream("DAQ-RESET");
    endtask

    // Register file: readback, per-bit W1C, and interrupt masking.
    task check_register_map();
      byte pl[$] = '{8'h01, 8'h02};
      bit [31:0] rd;
      reset_dut();

      csr_read(A_ID, rd);
      if (rd !== ID_VALUE) `uvm_error("DAQ-CSR",$sformatf("ID readback %08h, expected %08h", rd, ID_VALUE))
      else checks_passed++;

      set_ctrl(1, 1, 0);
      csr_read(A_CTRL, rd);
      if (rd[2:0] !== 3'b011) `uvm_error("DAQ-CSR",$sformatf("CTRL readback %03b, expected 011", rd[2:0]))
      else checks_passed++;

      // Mask every cause off, run a packet, and confirm the interrupt stays
      // low while the state bits still record what happened.
      csr_write(A_INTR_EN, 32'h0);
      set_ctrl(1, 0);
      send_packet(pl);
      wait_done(600, "DAQ-CSR");
      if (vif.irq) `uvm_error("DAQ-CSR","irq asserted with every cause masked off")
      else checks_passed++;
      wait_readback(A_INTR_STATE, 32'h1, 32'h1, 40, "DAQ-CSR");

      // Unmasking an already-pending cause must raise the interrupt.
      csr_write(A_INTR_EN, 32'h1);
      repeat (10) @(posedge vif.dma_clk);
      if (!vif.irq) `uvm_error("DAQ-CSR","irq did not assert after unmasking a pending cause")
      else begin checks_passed++; `uvm_info("DAQ-CSR","interrupt mask PASS",UVM_NONE); end

      // The FSM parks in COMPLETE until software acknowledges, so a second
      // transfer needs the clear command first. Leaving this out is what made
      // the first version of this test hang waiting for the next packet.
      csr_write(A_CMD, 32'h1);
      wait_readback(A_INTR_STATE, 32'hF, 32'h0, 40, "DAQ-CSR");

      // W1C clears only the bits written. A corrupted-CRC packet sets done and
      // crc_error together, so there is something that must survive the clear.
      csr_write(A_INTR_EN, 32'hF);
      send_packet(pl, .bad_crc(1));
      wait_bit(I_CRC, 600, "DAQ-CSR");
      wait_readback(A_INTR_STATE, 32'h3, 32'h3, 40, "DAQ-CSR");
      csr_write(A_INTR_STATE, 32'h1);            // clear done only
      wait_readback(A_INTR_STATE, 32'h3, 32'h2, 40, "DAQ-CSR");
      csr_read(A_INTR_STATE, rd);
      if (rd[I_DONE] !== 1'b0 || rd[I_CRC] !== 1'b1)
        `uvm_error("DAQ-CSR",$sformatf("W1C cleared the wrong bits: INTR_STATE=%04b", rd[3:0]))
      else begin checks_passed++; `uvm_info("DAQ-CSR","W1C PASS: cleared done, left crc_error pending",UVM_NONE); end

      csr_write(A_INTR_STATE, 32'hF);
      wait_readback(A_INTR_STATE, 32'hF, 32'h0, 40, "DAQ-CSR");
      checks_passed++;
      `uvm_info("DAQ-CSR","register map PASS: readback, masking and per-bit W1C",UVM_NONE)
      set_ctrl(0, 0); csr_write(A_CMD, 32'h1); repeat (10) @(posedge vif.dma_clk);
    endtask

    // The CMD clear must return the FSM to idle from a completed transfer and
    // leave the block ready to run another one.
    task check_fsm_recovery();
      byte pl[$] = '{8'hc1, 8'hc2, 8'hc3};
      bit [31:0] rd;
      reset_dut();
      set_ctrl(1, 0);
      send_packet(pl);
      wait_done(600, "DAQ-FSM");
      wait_readback(A_STATUS, 32'h1, 32'h0, 40, "DAQ-FSM");   // busy low once complete
      csr_write(A_CMD, 32'h1);
      wait_readback(A_INTR_STATE, 32'hF, 32'h0, 40, "DAQ-FSM");
      if (vif.done || vif.irq) `uvm_error("DAQ-FSM","CMD clear did not drop done/irq")
      else checks_passed++;
      clear_tracking();
      send_packet(pl);
      wait_done(600, "DAQ-FSM");
      wait_drain(3, 600, "DAQ-FSM");
      csr_read(A_STATUS, rd);
      if (rd[15:8] !== 8'd3) `uvm_error("DAQ-FSM",$sformatf("byte_count after restart is %0d, expected 3", rd[15:8]))
      else begin checks_passed++; `uvm_info("DAQ-FSM","FSM recovery PASS: cleared and ran a second transfer",UVM_NONE); end
      check_stream("DAQ-FSM");
    endtask

    task run_phase(uvm_phase phase);
      phase.raise_objection(this);
      fork mem_responder(); dma_monitor(); src_monitor(); join_none
      reset_dut();
      if ($test$plusargs("ASSERT_FAIL_DEMO")) begin
        `uvm_info("ASSERT_DEMO","Enabling deliberate IRQ-without-cause mutant; p_irq_has_cause must fail",UVM_NONE)
        set_ctrl(0, 0, 1); repeat(20) @(posedge vif.dma_clk);
      end else begin
        check_good_packet();
        check_crc_fault();
        check_crc_inject();
        check_backpressure();
        check_bus_error();
        check_overflow_stress();
        check_reset_during_traffic();
        check_register_map();
        check_fsm_recovery();
        `uvm_info("DAQ-SUMMARY",$sformatf("9 subtests run, %0d individual checks passed",checks_passed),UVM_NONE)
      end
      phase.drop_objection(this);
    endtask
  endclass
endpackage
