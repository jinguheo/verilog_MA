module prim_fifo_sync_uvm_tb;
  import uvm_pkg::*;
  import prim_fifo_sync_uvm_pkg::*;
  prim_fifo_sync_if vif();
  prim_fifo_sync #(.Width(8), .Depth(4), .Pass(0), .Secure(0)) dut (
    .clk_i(vif.clk_i), .rst_ni(vif.rst_ni), .clr_i(vif.clr_i),
    .wvalid_i(vif.wvalid_i), .wready_o(vif.wready_o), .wdata_i(vif.wdata_i),
    .rvalid_o(vif.rvalid_o), .rready_i(vif.rready_i), .rdata_o(vif.rdata_o),
    .full_o(vif.full_o), .depth_o(vif.depth_o), .err_o(vif.err_o));
  initial vif.clk_i=0;
  always #5 vif.clk_i=~vif.clk_i;
  initial begin
    uvm_config_db#(virtual prim_fifo_sync_if)::set(null,"*","vif",vif);
    run_test("fifo_requirements_test");
  end
endmodule
