interface prim_fifo_sync_if;
  logic clk_i;
  logic rst_ni;
  logic clr_i;
  logic wvalid_i;
  logic wready_o;
  logic [7:0] wdata_i;
  logic rvalid_o;
  logic rready_i;
  logic [7:0] rdata_o;
  logic full_o;
  logic err_o;
  logic [2:0] depth_o;
endinterface
