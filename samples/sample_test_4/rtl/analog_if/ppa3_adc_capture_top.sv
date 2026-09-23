// PPA experiment 3 integration top.
module ppa3_adc_capture_top (
  input  logic adc_clk_i, sys_clk_i, rst_ni,
  input  logic arm_i, trigger_i, read_start_i, read_ready_i, adc_trim_i,
  input  wire adc_in,
  inout  wire adc_vrefL, adc_vrefH, adc_vCM, vccd, vssd, vdda, vssa,
  output logic armed_o, triggered_o, capture_done_o,
  output logic [11:0] sample_count_o,
  output logic read_valid_o,
  output logic [31:0] read_data_o,
  output logic read_first_o, read_last_o, read_done_o
);
  logic [11:0] adc_dac_val;
  logic adc_comp_out, adc_ena, adc_reset, adc_hold;
  logic src_valid, src_ready, src_sop, src_eop;
  logic [7:0] src_data;
  logic [31:0] src_crc;

  sky130_ef_ip__adc3v_12bit u_adc (
    .adc_dac_val(adc_dac_val), .adc_ena(adc_ena), .adc_reset(adc_reset),
    .adc_comp_out(adc_comp_out), .adc_hold(adc_hold), .adc_vrefL(adc_vrefL),
    .vssd(vssd), .adc_vrefH(adc_vrefH), .adc_trim(adc_trim_i),
    .adc_vCM(adc_vCM), .adc_in(adc_in), .vccd(vccd), .vdda(vdda), .vssa(vssa)
  );

  sar_adc_ch #(.AdcBits(12), .SamplesPerPacket(128)) u_sar (
    .clk_i(adc_clk_i), .rst_ni(rst_ni), .adc_dac_val_o(adc_dac_val),
    .adc_comp_out_i(adc_comp_out), .adc_ena_o(adc_ena),
    .adc_reset_o(adc_reset), .adc_hold_o(adc_hold), .src_valid_o(src_valid),
    .src_ready_i(src_ready), .src_data_o(src_data), .src_sop_o(src_sop),
    .src_eop_o(src_eop), .src_crc_o(src_crc)
  );

  adc_stream_capture #(.FifoDepth(8), .DepthWords(1024), .PostTriggerSamples(512))
  u_capture_path (
    .adc_clk_i(adc_clk_i), .sys_clk_i(sys_clk_i), .rst_ni(rst_ni),
    .src_valid_i(src_valid), .src_ready_o(src_ready), .src_data_i(src_data),
    .arm_i(arm_i), .trigger_i(trigger_i), .armed_o(armed_o),
    .triggered_o(triggered_o), .capture_done_o(capture_done_o),
    .sample_count_o(sample_count_o), .read_start_i(read_start_i),
    .read_valid_o(read_valid_o), .read_ready_i(read_ready_i),
    .read_data_o(read_data_o), .read_first_o(read_first_o),
    .read_last_o(read_last_o), .read_done_o(read_done_o)
  );

  logic unused_packet_sidebands;
  assign unused_packet_sidebands = ^{src_sop, src_eop, src_crc};
endmodule
