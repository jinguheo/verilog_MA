module prim_fifo_sync_tb;
  logic clk_i = 0, rst_ni = 1, clr_i = 0;
  logic wvalid_i, wready_o;
  logic [7:0] wdata_i;
  logic rvalid_o, rready_i;
  logic [7:0] rdata_o;
  logic full_o, err_o;
  logic [2:0] depth_o;
  prim_fifo_sync #(.Width(8), .Depth(4), .Pass(0), .Secure(0)) dut (.*);
  always #5 clk_i = ~clk_i;
  task automatic push(input logic [7:0] value);
    @(negedge clk_i); wdata_i=value; wvalid_i=1; rready_i=0;
    @(posedge clk_i); #1; if (!wready_o) $fatal(1,"push rejected");
    @(negedge clk_i); wvalid_i=0;
  endtask
  task automatic pop(input logic [7:0] value);
    // The FIFO advances its output after the read handshake.  Check the
    // fall-through word before asserting rready_i for the active edge.
    @(negedge clk_i); if (!rvalid_o || rdata_o!==value) $fatal(1,"pop expected=%h got=%h valid=%b",value,rdata_o,rvalid_o); rready_i=1;
    @(posedge clk_i); #1;
    @(negedge clk_i); rready_i=0;
  endtask
  initial begin
    wvalid_i=0; wdata_i=0; rready_i=0; #1 rst_ni=0;
    repeat(2) @(posedge clk_i); rst_ni=1; repeat(2) @(posedge clk_i);
    if (depth_o!==0 || rvalid_o) $fatal(1,"reset state incorrect");
    push(8'h3c); push(8'ha5); if (depth_o!==2) $fatal(1,"depth expected 2");
    pop(8'h3c); pop(8'ha5); if (depth_o!==0) $fatal(1,"fifo not empty");
    $display("SAMPLE_TEST_1_FIFO_PASS"); $finish;
  end
endmodule
