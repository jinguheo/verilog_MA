module prim_filter_tb;
  logic clk_i = 0, rst_ni = 1, enable_i = 0, filter_i = 0;
  logic filter_o;
  prim_filter #(.Cycles(4), .AsyncOn(0)) dut (.*);
  always #5 clk_i = ~clk_i;
  task automatic check_value(input logic value, input string label);
    #1; if (filter_o !== value) $fatal(1, "%s expected=%b got=%b", label, value, filter_o);
    $display("PASS %s -> filter_o=%b", label, filter_o);
  endtask
  initial begin
    #1 rst_ni = 1; #1 rst_ni = 0;
    repeat (2) @(posedge clk_i); rst_ni = 1; @(posedge clk_i);
    filter_i = 1; enable_i = 0; check_value(1, "bypass follows input");
    rst_ni = 0; #1; rst_ni = 1; filter_i = 1; enable_i = 1;
    check_value(0, "enabled output holds reset value initially");
    repeat (4) @(posedge clk_i); check_value(1, "four stable high cycles update output");
    filter_i = 0; repeat (4) @(posedge clk_i); check_value(0, "four stable low cycles update output");
    $display("SAMPLE_TEST_1_PRIM_FILTER_SIMULATION_PASS"); $finish;
  end
endmodule
