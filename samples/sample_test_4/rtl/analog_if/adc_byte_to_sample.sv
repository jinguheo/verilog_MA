// Adapts sar_adc_ch's existing low-byte/high-byte stream to one calibrated
// 12-bit sample transaction. This preserves the already-verified SAR block
// and its packet/CRC contract instead of creating a second SAR implementation.
module adc_byte_to_sample (
  input  logic clk_i,
  input  logic rst_ni,
  input  logic       src_valid_i,
  output logic       src_ready_o,
  input  logic [7:0] src_data_i,
  output logic        sample_valid_o,
  input  logic         sample_ready_i,
  output logic [11:0]  sample_o,
  output logic [3:0]   sample_flags_o
);
  logic have_lo_q;
  logic [7:0] lo_q;
  assign src_ready_o = !have_lo_q || sample_ready_i;
  assign sample_valid_o = have_lo_q && src_valid_i;
  assign sample_o = {src_data_i[3:0], lo_q};
  // The existing SAR source guarantees high[7:4]==0. Preserve a malformed
  // indication rather than silently discarding it if integration violates it.
  assign sample_flags_o = {3'b000, |src_data_i[7:4]};

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      have_lo_q <= 1'b0;
      lo_q <= '0;
    end else if (src_valid_i && src_ready_o) begin
      if (!have_lo_q) begin
        lo_q <= src_data_i;
        have_lo_q <= 1'b1;
      end else begin
        have_lo_q <= 1'b0;
      end
    end
  end
endmodule
