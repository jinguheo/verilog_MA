module formal_top(input a);
  wire b;
  top dut (.a(a), .b(b));
  always @* assert (b == !a);
endmodule
