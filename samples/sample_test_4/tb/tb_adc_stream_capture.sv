// End-to-end PPA2 check: SAR byte protocol crosses an asynchronous FIFO,
// is packed into the capture SRAM, and is read in chronological order.
module tb_adc_stream_capture;
  localparam int DepthWords = 8;
  logic adc_clk = 0, sys_clk = 0;
  always #3 adc_clk = ~adc_clk;
  always #5 sys_clk = ~sys_clk;
  logic rst_n = 0, src_valid, src_ready, arm, trigger;
  logic [7:0] src_data;
  logic armed, triggered, done;
  logic [$clog2(DepthWords*2+1)-1:0] sample_count;
  logic read_start, read_valid, read_ready, read_first, read_last, read_done;
  logic [31:0] read_data;
  int errors = 0, words_seen = 0;

  adc_stream_capture #(.FifoDepth(8), .DepthWords(DepthWords), .PostTriggerSamples(4)) dut (
    .adc_clk_i(adc_clk), .sys_clk_i(sys_clk), .rst_ni(rst_n),
    .src_valid_i(src_valid), .src_ready_o(src_ready), .src_data_i(src_data),
    .arm_i(arm), .trigger_i(trigger), .armed_o(armed), .triggered_o(triggered),
    .capture_done_o(done), .sample_count_o(sample_count), .read_start_i(read_start),
    .read_valid_o(read_valid), .read_ready_i(read_ready), .read_data_o(read_data),
    .read_first_o(read_first), .read_last_o(read_last), .read_done_o(read_done)
  );

  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask
  function automatic logic [15:0] enc(input int value);
    enc = {4'(value >> 12), 12'(value)};
  endfunction
  task automatic put_byte(input logic [7:0] value);
    src_data = value; src_valid = 1'b1;
    @(negedge adc_clk); while (!src_ready) @(negedge adc_clk);
    src_valid = 1'b0;
  endtask
  task automatic send_sample(input logic [11:0] value);
    put_byte(value[7:0]); put_byte({4'b0, value[11:8]});
  endtask

  always @(posedge sys_clk) if (read_valid && read_ready) begin
    check(read_data === {enc(words_seen*2 + 1), enc(words_seen*2)},
          $sformatf("word %0d got %08x", words_seen, read_data));
    check(read_first == (words_seen == 0), "read_first mismatch");
    check(read_last == (words_seen == 5), "read_last mismatch");
    words_seen++;
  end

  initial begin
    src_valid=0; src_data=0; arm=0; trigger=0; read_start=0; read_ready=0;
    repeat (4) @(negedge sys_clk); rst_n=1;
    // prim_rst_sync releases each clock domain after its synchronizer delay.
    repeat (3) @(negedge sys_clk);
    arm=1; @(negedge sys_clk); arm=0;
    for (int i=0; i<8; i++) send_sample(12'(i));
    repeat (6) @(negedge sys_clk);
    trigger=1; @(negedge sys_clk); trigger=0;
    for (int i=8; i<12; i++) send_sample(12'(i));
    wait(done); @(negedge sys_clk);
    check(triggered && !armed, "capture did not trigger and freeze");
    check(sample_count == 12, "unexpected accepted sample count");
    read_start=1; @(negedge sys_clk); read_start=0; read_ready=1;
    wait(read_done); @(negedge sys_clk);
    check(words_seen == 6, "wrong read word count");
    if (errors == 0) begin $display("[ADC_STREAM_CAPTURE_TB] PASS"); $finish; end
    else $fatal(1, "ADC stream capture errors=%0d", errors);
  end
  initial begin #1_000_000; $fatal(1, "timeout armed=%0b trig=%0b done=%0b count=%0d fifo=%0d", armed, triggered, done, sample_count, dut.u_sample_cdc.rdepth_o); end
endmodule
