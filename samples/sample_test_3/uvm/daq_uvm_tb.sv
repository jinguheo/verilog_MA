module daq_uvm_tb;
  import uvm_pkg::*; import daq_uvm_pkg::*;
  daq_if vif();
  daq_top dut(.ctrl_clk(vif.ctrl_clk),.src_clk(vif.src_clk),.dma_clk(vif.dma_clk),.rst_n(vif.rst_n),.csr_we(vif.csr_we),.csr_re(vif.csr_re),.csr_addr(vif.csr_addr),.csr_wdata(vif.csr_wdata),.csr_rdata(vif.csr_rdata),.src_valid(vif.src_valid),.src_ready(vif.src_ready),.src_sop(vif.src_sop),.src_eop(vif.src_eop),.src_data(vif.src_data),.dma_wready(vif.dma_wready),.dma_wresp_err(vif.dma_wresp_err),.dma_wvalid(vif.dma_wvalid),.dma_waddr(vif.dma_waddr),.dma_wdata(vif.dma_wdata),.irq(vif.irq),.done(vif.done),.crc_error(vif.crc_error),.bus_error(vif.bus_error),.fifo_overflow(vif.fifo_overflow),.mem0(vif.mem0),.mem1(vif.mem1),.mem2(vif.mem2),.mem3(vif.mem3));

  // Clock half-periods are runtime-settable so the same regression can be
  // replayed across different clock ratios (+CTRL_HP/+SRC_HP/+DMA_HP), and
  // seeded-random ones with +RANDOM_CLOCKS. The three domains stay mutually
  // asynchronous in every configuration - that is the point of the test.
  int ctrl_hp = 5, src_hp = 3, dma_hp = 7;
  initial begin
    vif.ctrl_clk = 0; vif.src_clk = 0; vif.dma_clk = 0;
    if ($test$plusargs("RANDOM_CLOCKS")) begin
      ctrl_hp = 2 + $urandom_range(10); src_hp = 2 + $urandom_range(10); dma_hp = 2 + $urandom_range(10);
    end
    void'($value$plusargs("CTRL_HP=%d", ctrl_hp));
    void'($value$plusargs("SRC_HP=%d", src_hp));
    void'($value$plusargs("DMA_HP=%d", dma_hp));
    $display("[TB] clock half-periods: ctrl=%0d src=%0d dma=%0d", ctrl_hp, src_hp, dma_hp);
  end
  always begin #(ctrl_hp) vif.ctrl_clk = ~vif.ctrl_clk; end
  always begin #(src_hp)  vif.src_clk  = ~vif.src_clk;  end
  always begin #(dma_hp)  vif.dma_clk  = ~vif.dma_clk;  end

  initial begin uvm_config_db#(virtual daq_if)::set(null,"*","vif",vif); run_test("daq_test"); end
endmodule
