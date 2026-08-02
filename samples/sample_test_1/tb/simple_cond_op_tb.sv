module simple_cond_op_tb;
  logic a;
  wire b;
  top dut (.a(a), .b(b));

  task automatic check(input logic input_value, input logic expected);
    a = input_value;
    #1;
    if (b !== expected) $fatal(1, "a=%b: expected b=%b, got b=%b", a, expected, b);
    $display("PASS a=%b -> b=%b", a, b);
  endtask

  initial begin
    check(1'b0, 1'b1);
    check(1'b1, 1'b0);
    $display("SAMPLE_TEST_1_SIMULATION_PASS");
    $finish;
  end
endmodule
