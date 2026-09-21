module tb_adc_capture_buffer;
  localparam int DepthWords = 8;
  logic clk = 0; always #5 clk = ~clk;
  logic rst_n = 0, arm, trigger, sample_valid, sample_ready;
  logic [11:0] sample; logic [3:0] flags;
  logic armed, triggered, done;
  logic [$clog2(DepthWords*2+1)-1:0] sample_count;
  logic read_start, read_valid, read_ready, read_first, read_last, read_done;
  logic [31:0] read_data;
  int errors = 0, words_seen = 0;
  logic sample_taken;
  always @(posedge clk) sample_taken = sample_valid && sample_ready;

  adc_capture_buffer #(.DepthWords(DepthWords), .PostTriggerSamples(4)) dut (
    .clk_i(clk), .rst_ni(rst_n), .arm_i(arm), .trigger_i(trigger),
    .sample_valid_i(sample_valid), .sample_ready_o(sample_ready),
    .sample_i(sample), .sample_flags_i(flags), .armed_o(armed),
    .triggered_o(triggered), .capture_done_o(done), .sample_count_o(sample_count),
    .read_start_i(read_start), .read_valid_o(read_valid), .read_ready_i(read_ready),
    .read_data_o(read_data), .read_first_o(read_first), .read_last_o(read_last),
    .read_done_o(read_done)
  );

  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask
  function automatic logic [15:0] enc(input int value);
    enc = {4'(value >> 12), 12'(value)};
  endfunction
  task automatic send_sample(input int value, input bit trig);
    sample = 12'(value); flags = 4'(value >> 12); trigger = trig; sample_valid = 1;
    @(negedge clk); while (!sample_taken) @(negedge clk);
    sample_valid = 0; trigger = 0;
  endtask

  always @(posedge clk) if (read_valid && read_ready) begin
    check(read_data === {enc(words_seen*2 + 9), enc(words_seen*2 + 8)},
          $sformatf("word %0d got %08x", words_seen, read_data));
    check(read_first == (words_seen == 0), "read_first mismatch");
    check(read_last == (words_seen == DepthWords-1), "read_last mismatch");
    words_seen++;
  end

  initial begin
    arm=0; trigger=0; sample_valid=0; sample=0; flags=0; read_start=0; read_ready=0;
    repeat (3) @(negedge clk); rst_n=1; arm=1; @(negedge clk); arm=0;
    for (int i=0; i<20; i++) send_sample(i, 0);
    for (int i=20; i<24; i++) send_sample(i, i==20);
    @(negedge clk);
    check(done && !armed && triggered, "capture did not freeze");
    check(sample_count == $bits(sample_count)'(DepthWords*2), "sample count mismatch");
    check(!sample_ready, "sample_ready high while frozen");
    read_start=1; @(negedge clk); read_start=0; read_ready=1;
    repeat (3) @(negedge clk); read_ready=0; repeat (4) @(negedge clk); read_ready=1;
    wait(read_done); @(negedge clk);
    check(words_seen == DepthWords, "wrong read word count");
    arm=1; @(negedge clk); arm=0;
    check(armed && !done && sample_ready, "re-arm failed");
    if (errors == 0) begin $display("[ADC_CAPTURE_BUFFER_TB] PASS"); $finish; end
    else begin $display("[ADC_CAPTURE_BUFFER_TB] FAIL: %0d", errors); $fatal(1); end
  end
  initial begin
    #1_000_000;
    $display("TIMEOUT armed=%0b triggered=%0b done=%0b count=%0d read_valid=%0b read_last=%0b words=%0d read_words=%0d read_index=%0d",
             armed, triggered, done, sample_count, read_valid, read_last,
             words_seen, dut.read_words_q, dut.read_index_q);
    $fatal(1, "timeout");
  end
endmodule
