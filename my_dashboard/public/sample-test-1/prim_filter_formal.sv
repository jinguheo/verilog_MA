module formal_top(input clk_i, input rst_ni, input enable_i, input filter_i);
  wire filter_o;
  prim_filter #(.Cycles(4), .AsyncOn(0)) dut (.*);
  always @* if (!enable_i) assert(filter_o == filter_i);
endmodule
