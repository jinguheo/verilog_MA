// Formal safety properties for prim_fifo_sync as configured in Sample Test 2
// (Width=8, Depth=4, Pass=0, Secure=0 — matches prim_fifo_sync_uvm_tb.sv).
module formal_top(
  input        clk_i,
  input        rst_ni,
  input        clr_i,
  input        wvalid_i,
  input  [7:0] wdata_i,
  input        rready_i
);
  wire       wready_o, rvalid_o, full_o, err_o;
  wire [7:0] rdata_o;
  wire [2:0] depth_o;

  prim_fifo_sync #(.Width(8), .Depth(4), .Pass(0), .Secure(0)) dut (
    .clk_i, .rst_ni, .clr_i,
    .wvalid_i, .wready_o, .wdata_i,
    .rvalid_o, .rready_i, .rdata_o,
    .full_o, .depth_o, .err_o
  );

  // Force a real reset at the start of every trace so the base case of
  // k-induction starts from a known-good state, instead of an arbitrary
  // (possibly out-of-range) initial register value.
  reg [1:0] cyc = 0;
  always @(posedge clk_i) if (cyc < 3) cyc <= cyc + 1;
  always @* assume(cyc < 2 ? !rst_ni : rst_ni);

  always @* begin
    // No overflow: depth_o can never exceed the configured Depth.
    assert (depth_o <= 4);
    // full_o and depth_o must agree on capacity in both directions.
    assert (full_o == (depth_o == 4));
    // Pass==0: rvalid_o must exactly track non-empty, not just imply it.
    assert (rvalid_o == (depth_o != 0));
    // Never accept a write while genuinely full (no silent overflow).
    assert (!(full_o && wvalid_i && wready_o));
    // Never present valid read data while empty (no silent underflow).
    assert (!((depth_o == 0) && rvalid_o));
  end
endmodule
