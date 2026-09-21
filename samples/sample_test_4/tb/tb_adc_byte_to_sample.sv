module tb_adc_byte_to_sample;
  logic clk=0; always #5 clk=~clk;
  logic rst_n=0, src_valid, src_ready, sample_valid, sample_ready;
  logic [7:0] src_data; logic [11:0] sample; logic [3:0] flags;
  int errors=0;
  logic out_taken; logic [11:0] taken_sample; logic [3:0] taken_flags;
  always @(posedge clk) begin
    out_taken = sample_valid && sample_ready;
    taken_sample = sample;
    taken_flags = flags;
  end
  adc_byte_to_sample dut (
    .clk_i(clk), .rst_ni(rst_n), .src_valid_i(src_valid), .src_ready_o(src_ready),
    .src_data_i(src_data), .sample_valid_o(sample_valid),
    .sample_ready_i(sample_ready), .sample_o(sample), .sample_flags_o(flags));
  task automatic check(input bit c,input string s); if(!c) begin $display("ERROR: %s",s); errors++; end endtask
  task automatic put(input logic [7:0] b);
    src_data=b; src_valid=1; @(negedge clk); while(!src_ready) @(negedge clk); src_valid=0;
  endtask
  initial begin
    src_valid=0; src_data=0; sample_ready=1; repeat(3) @(negedge clk); rst_n=1;
    put(8'hBC); sample_ready=0; src_data=8'h0A; src_valid=1; @(negedge clk);
    check(sample_valid && sample==12'hABC && !src_ready, "backpressure stability failed");
    sample_ready=1; @(negedge clk); src_valid=0;
    check(out_taken && taken_sample==12'hABC && taken_flags==0, "12-bit reconstruction failed");
    put(8'h34); src_data=8'hF2; src_valid=1; @(negedge clk); src_valid=0;
    check(out_taken && taken_sample==12'h234 && taken_flags[0], "malformed high-byte flag missing");
    if(errors==0) begin $display("[ADC_BYTE_TO_SAMPLE_TB] PASS"); $finish; end
    else $fatal(1,"%0d errors",errors);
  end
  initial begin #100000; $fatal(1,"timeout"); end
endmodule
