// Reuses the project's established chan_top CDC structure:
// sar_adc_ch byte stream -> adc_byte_to_sample -> prim_fifo_async ->
// adc_capture_buffer. arm/trigger/readout live wholly in sys_clk_i.
module adc_stream_capture #(
  parameter int unsigned FifoDepth          = 8,
  parameter int unsigned DepthWords         = 1024,
  parameter int unsigned PostTriggerSamples = 512,
  localparam int unsigned SampleCntW         = $clog2(DepthWords * 2 + 1)
) (
  input  logic adc_clk_i,
  input  logic sys_clk_i,
  input  logic rst_ni,
  input  logic       src_valid_i,
  output logic       src_ready_o,
  input  logic [7:0] src_data_i,
  input  logic       arm_i,
  input  logic       trigger_i,
  output logic       armed_o,
  output logic       triggered_o,
  output logic       capture_done_o,
  output logic [SampleCntW-1:0] sample_count_o,
  input  logic       read_start_i,
  output logic       read_valid_o,
  input  logic       read_ready_i,
  output logic [31:0] read_data_o,
  output logic       read_first_o,
  output logic       read_last_o,
  output logic       read_done_o
);
  logic adc_rst_n, sys_rst_n;
  prim_rst_sync #(.ActiveHigh(1'b0), .SkipScan(1'b1)) u_rst_adc (
    .clk_i(adc_clk_i), .d_i(rst_ni), .q_o(adc_rst_n), .scan_rst_ni(1'b1),
    .scanmode_i(prim_mubi_pkg::MuBi4False)
  );
  prim_rst_sync #(.ActiveHigh(1'b0), .SkipScan(1'b1)) u_rst_sys (
    .clk_i(sys_clk_i), .d_i(rst_ni), .q_o(sys_rst_n), .scan_rst_ni(1'b1),
    .scanmode_i(prim_mubi_pkg::MuBi4False)
  );

  logic sample_valid, sample_ready;
  logic [11:0] sample;
  logic [3:0] sample_flags;
  adc_byte_to_sample u_unpack (
    .clk_i(adc_clk_i), .rst_ni(adc_rst_n), .src_valid_i(src_valid_i),
    .src_ready_o(src_ready_o), .src_data_i(src_data_i),
    .sample_valid_o(sample_valid), .sample_ready_i(sample_ready),
    .sample_o(sample), .sample_flags_o(sample_flags)
  );

  logic [15:0] fifo_rdata;
  logic fifo_rvalid, fifo_rready;
  /* verilator lint_off PINCONNECTEMPTY */
  prim_fifo_async #(.Width(16), .Depth(FifoDepth)) u_sample_cdc (
    .clk_wr_i(adc_clk_i), .rst_wr_ni(adc_rst_n), .wvalid_i(sample_valid),
    .wready_o(sample_ready), .wdata_i({sample_flags, sample}), .wdepth_o(),
    .clk_rd_i(sys_clk_i), .rst_rd_ni(sys_rst_n), .rvalid_o(fifo_rvalid),
    .rready_i(fifo_rready), .rdata_o(fifo_rdata), .rdepth_o()
  );
  /* verilator lint_on PINCONNECTEMPTY */

  adc_capture_buffer #(
    .DepthWords(DepthWords), .PostTriggerSamples(PostTriggerSamples)
  ) u_capture (
    .clk_i(sys_clk_i), .rst_ni(sys_rst_n), .arm_i(arm_i), .trigger_i(trigger_i),
    .sample_valid_i(fifo_rvalid), .sample_ready_o(fifo_rready),
    .sample_i(fifo_rdata[11:0]), .sample_flags_i(fifo_rdata[15:12]),
    .armed_o(armed_o), .triggered_o(triggered_o),
    .capture_done_o(capture_done_o), .sample_count_o(sample_count_o),
    .read_start_i(read_start_i), .read_valid_o(read_valid_o),
    .read_ready_i(read_ready_i), .read_data_o(read_data_o),
    .read_first_o(read_first_o), .read_last_o(read_last_o),
    .read_done_o(read_done_o)
  );
endmodule
