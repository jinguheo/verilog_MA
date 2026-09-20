// Block-level testbench for rtl/analog_if/sar_adc_ch.sv.
//
// Stands in for the analog macro with a behavioral comparator model
// (adc_comp_out = trial_code > true_code, the standard SAR convention this
// module's own header documents) rather than anything transistor-level -
// this is exactly the "real-number/behavioral ADC model" the digital-analog
// integration plan flagged as missing before any of this could be verified
// at the digital-testbench level. It proves the digital bridge's own logic
// (SAR convergence, packet framing, CRC) is correct; it says nothing about
// the analog macro's own electrical behavior, which is CACE/SPICE territory
// (see analog/README.md).
//
// Built at SamplesPerPacket=4 (8 bytes/packet) rather than the RTL's own
// default of 128 - small enough to run many packets quickly while
// exercising the exact same sop/eop/CRC logic a real-sized packet would.
//
// Phases:
//   1. randomised true codes, many packets - SAR convergence is exact for
//      every sample (binary search with this comparator convention always
//      reconstructs an integer target exactly - proven per-sample, not
//      just spot-checked), byte packing/order, CRC-32 against a software
//      reference, sop/eop framing
//   2. all-zero and all-ones codes - the two extremes of the input range
//   3. backpressure on src_ready_i through several packets

module tb_sar_adc_ch;
  localparam int unsigned AdcBits          = 12;
  localparam int unsigned SamplesPerPacket = 4;
  localparam int unsigned PacketBytes      = SamplesPerPacket * 2;

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [AdcBits-1:0] adc_dac_val;
  logic                adc_comp_out;
  logic                 adc_ena, adc_reset, adc_hold;

  logic       src_valid, src_ready;
  logic [7:0]  src_data;
  logic        src_sop, src_eop;
  logic [31:0] src_crc;

  sar_adc_ch #(.AdcBits(AdcBits), .SamplesPerPacket(SamplesPerPacket)) dut (
    .clk_i (clk), .rst_ni (rst_n),
    .adc_dac_val_o (adc_dac_val), .adc_comp_out_i (adc_comp_out),
    .adc_ena_o (adc_ena), .adc_reset_o (adc_reset), .adc_hold_o (adc_hold),
    .src_valid_o (src_valid), .src_ready_i (src_ready),
    .src_data_o (src_data), .src_sop_o (src_sop), .src_eop_o (src_eop),
    .src_crc_o (src_crc)
  );

  // ---- behavioral comparator model: adc_comp_out = trial > true_code ---------
  logic [AdcBits-1:0] true_code_q;
  logic [AdcBits-1:0] expected_q [$];

  assign adc_comp_out = (adc_dac_val > true_code_q);

  // Fixed sequence of true codes to sample, consumed one per adc_hold_o
  // pulse - queued up front so the testbench (not $urandom mid-flight) owns
  // the schedule and phase 2's directed extremes are easy to splice in.
  logic [AdcBits-1:0] schedule_q [$];
  int unsigned schedule_idx = 0;

  always @(posedge clk) begin
    if (rst_n && adc_hold) begin
      true_code_q <= schedule_q[schedule_idx];
      expected_q.push_back(schedule_q[schedule_idx]);
      schedule_idx <= schedule_idx + 1;
    end
  end

  // ---- posedge-monitor acceptance + software CRC-32 reference ----------------
  logic taken;
  always @(posedge clk) taken = src_valid & src_ready;

  logic [7:0] got_bytes [$];
  bit         out_in_pkt;

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // adc_ena_o must always be the complement of adc_reset_o - checked
  // continuously rather than left as an unread port.
  always @(posedge clk) if (rst_n) check(adc_ena == !adc_reset, "adc_ena_o was not the complement of adc_reset_o");

  function automatic logic [31:0] crc32_byte_step(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) c = c[0] ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    crc32_byte_step = c;
  endfunction

  logic [31:0] ref_crc_q;
  logic [7:0]  pkt_bytes [$];

  always @(posedge clk) begin
    if (rst_n && taken) begin
      if (!out_in_pkt) check(src_sop, "first accepted byte of a packet did not carry sop");
      else             check(!src_sop, "sop set on a non-first byte of a packet");
      out_in_pkt = src_eop ? 1'b0 : 1'b1;

      got_bytes.push_back(src_data);
      pkt_bytes.push_back(src_data);
      ref_crc_q = (pkt_bytes.size() == 1) ? crc32_byte_step(32'hFFFF_FFFF, src_data)
                                          : crc32_byte_step(ref_crc_q, src_data);
      if (src_eop) begin
        automatic logic [31:0] expected_crc = ref_crc_q ^ 32'hFFFF_FFFF;
        check(pkt_bytes.size() == PacketBytes,
              $sformatf("packet had %0d bytes, expected %0d", pkt_bytes.size(), PacketBytes));
        check(src_crc === expected_crc,
              $sformatf("CRC mismatch: got %h expected %h", src_crc, expected_crc));
        pkt_bytes.delete();
      end
    end
  end

  task automatic reset_dut();
    src_ready = 1'b1;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
  endtask

  // Decodes every complete (lo,hi) pair collected so far in got_bytes against
  // expected_q, in order, and clears both queues.
  task automatic check_all_conversions();
    automatic int unsigned n = got_bytes.size() / 2;
    check(got_bytes.size() % 2 == 0, "odd number of bytes collected - a hi byte is missing");
    check(n == expected_q.size(),
          $sformatf("decoded %0d samples, expected %0d", n, expected_q.size()));
    for (int unsigned i = 0; i < n && i < expected_q.size(); i++) begin
      automatic logic [AdcBits-1:0] decoded = {got_bytes[2*i+1][AdcBits-9:0], got_bytes[2*i]};
      if (decoded !== expected_q[i]) begin
        $display("ERROR: sample %0d decoded %0d expected %0d", i, decoded, expected_q[i]);
        errors++;
      end
    end
    got_bytes.delete();
    expected_q.delete();
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: randomised codes, several packets -----------------------------
    for (int unsigned i = 0; i < SamplesPerPacket * 6; i++) schedule_q.push_back(AdcBits'($urandom_range(0, (1 << AdcBits) - 1)));
    // Wait for all of phase 1's conversions to be scheduled and their bytes collected.
    while (schedule_idx < SamplesPerPacket * 6 || got_bytes.size() < (SamplesPerPacket * 6) * 2) @(negedge clk);
    check_all_conversions();

    // ---- phase 2: directed extremes -----------------------------------------------
    schedule_q.push_back('0);
    schedule_q.push_back({AdcBits{1'b1}});
    schedule_q.push_back('0);
    schedule_q.push_back({AdcBits{1'b1}});
    while (schedule_idx < schedule_q.size() || got_bytes.size() < 4 * 2) @(negedge clk);
    check_all_conversions();

    // ---- phase 3: backpressure on src_ready_i ------------------------------------
    // A single loop, gated on the actual completion condition (bytes
    // collected), not on schedule_idx: an earlier version toggled
    // src_ready_i in one fork branch only "while schedule_idx hasn't caught
    // up," which can exit - freezing src_ready_i at whatever it last
    // happened to be, possibly 0 - before the last sample's bytes have
    // actually been emitted, deadlocking the other branch waiting for them
    // forever. Reusing the same one always-correct condition for both
    // "keep toggling" and "are we done" removes the seam that bug lived in.
    begin
      for (int unsigned i = 0; i < SamplesPerPacket * 3; i++) schedule_q.push_back(AdcBits'($urandom_range(0, (1 << AdcBits) - 1)));
      while (got_bytes.size() < (SamplesPerPacket * 3) * 2) begin
        src_ready = ($urandom_range(0, 99) < 60);
        @(negedge clk);
      end
      src_ready = 1'b1;
      check_all_conversions();
    end

    repeat (5) @(negedge clk);
    if (errors == 0) begin $display("[SAR_ADC_CH_TB] PASS"); $finish; end
    else begin $display("[SAR_ADC_CH_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_sar_adc_ch failed"); end
  end

  initial begin #2_000_000; $fatal(1, "tb_sar_adc_ch timeout"); end

endmodule
