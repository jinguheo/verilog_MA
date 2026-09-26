// Single-port storage wrapper for the PPA2 capture buffer.
//
// Default simulation uses a cycle-accurate behavioral model. Defining
// ADC_CAPTURE_USE_SRAM22 selects the foundry macro's own Verilog view;
// that define must be paired with sram22_1024x32m8w8.v in the file list.
// Both implementations have the same registered-read contract.
module adc_capture_sram (
  input  logic        clk_i,
  input  logic        en_i,
  input  logic        we_i,
  input  logic [3:0]  wmask_i,
  input  logic [9:0]  addr_i,
  input  logic [31:0] wdata_i,
  output logic [31:0] rdata_o
);
`ifdef ADC_CAPTURE_USE_SRAM22
  sram22_1024x32m8w8 u_sram22 (
    // SRAM contents are intentionally not reset. The controller holds en_i
    // low throughout reset, so rstb is safely deasserted for normal access.
    .clk(clk_i), .rstb(1'b1), .ce(en_i), .we(we_i), .wmask(wmask_i),
    .addr(addr_i), .din(wdata_i), .dout(rdata_o)
  );
`else
  logic [31:0] mem [0:1023];
  always_ff @(posedge clk_i) begin
    // The controller never asserts en_i during reset. Keeping reset out of
    // this behavioral clocked block matches the macro's no-operation reset
    // contract and avoids treating the same reset net as sync and async.
    if (en_i) begin
      if (we_i) begin
        if (wmask_i[0]) mem[addr_i][7:0]   <= wdata_i[7:0];
        if (wmask_i[1]) mem[addr_i][15:8]  <= wdata_i[15:8];
        if (wmask_i[2]) mem[addr_i][23:16] <= wdata_i[23:16];
        if (wmask_i[3]) mem[addr_i][31:24] <= wdata_i[31:24];
      end else begin
        rdata_o <= mem[addr_i];
      end
    end
  end
`endif
endmodule
