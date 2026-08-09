interface daq_if;
  logic ctrl_clk, src_clk, dma_clk;
  logic rst_n;
  // CSR, ctrl_clk domain. csr_rdata is combinational off csr_addr.
  logic csr_we, csr_re;
  logic [3:0] csr_addr;
  logic [31:0] csr_wdata, csr_rdata;
  logic src_valid, src_ready, src_sop, src_eop;
  logic [7:0] src_data;
  // DMA write port. dma_wready / dma_wresp_err are driven by the testbench
  // memory model; the rest are DUT outputs the tests observe.
  logic dma_wready, dma_wresp_err;
  logic dma_wvalid;
  logic [3:0] dma_waddr;
  logic [7:0] dma_wdata;
  logic irq, done, crc_error, bus_error, fifo_overflow;
  logic [7:0] mem0, mem1, mem2, mem3;
endinterface
