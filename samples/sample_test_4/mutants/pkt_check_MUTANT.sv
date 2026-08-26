// Mutant copy of rtl/stream/pkt_check.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them.
//
//   MUT_CHECK_WRONGIDX  crc_result always reads crc_stages[AxiBw] instead of
//                       crc_stages[beat_bytes] - this is the exact bug the
//                       golden module's header documents finding when it
//                       still reused prim_crc32 (which has the same defect
//                       baked in structurally: no byte-enable, always
//                       processes the full width). Caught by any packet
//                       needing a partial last beat.
//   MUT_CHECK_NOSOPRESET crc_stages[0] always continues from crc_q, never
//                       resets to Crc32Init on sop - a fresh packet's CRC
//                       silently continues from wherever the previous
//                       packet's computation left off. Caught by the second
//                       packet onward (the very first packet's CRC still
//                       happens to be right, since crc_q correctly starts at
//                       Crc32Init out of reset).
//   MUT_CHECK_NOLENERR  len_err_o is always 0. Caught by the zero-length
//                       packet test.

module pkt_check
  import daq_pkg::*;
(
  input  logic               clk_i,
  input  logic                rst_ni,
  input  logic                 beat_valid_i,
  output logic                 beat_ready_o,
  input  logic [AxiDw-1:0]     beat_data_i,
  input  logic [AxiBw-1:0]     beat_strb_i,
  input  logic                 beat_sop_i,
  input  logic                 beat_eop_i,
  input  logic [31:0]          beat_crc_i,
  output logic                  beat_valid_o,
  input  logic                   beat_ready_i,
  output logic [AxiDw-1:0]       beat_data_o,
  output logic [AxiBw-1:0]       beat_strb_o,
  output logic                   beat_sop_o,
  output logic                   beat_eop_o,
  output logic                    pkt_done_o,
  output logic                    crc_err_o,
  output logic                    len_err_o
);

  assign beat_ready_o = beat_ready_i;
  assign beat_valid_o = beat_valid_i;
  assign beat_data_o  = beat_data_i;
  assign beat_strb_o  = beat_strb_i;
  assign beat_sop_o   = beat_sop_i;
  assign beat_eop_o   = beat_eop_i;

  logic accept;
  assign accept = beat_valid_i & beat_ready_i;

  logic [$clog2(AxiBw+1)-1:0] beat_bytes;
  always_comb begin
    beat_bytes = '0;
    for (int unsigned i = 0; i < AxiBw; i++) if (beat_strb_i[i]) beat_bytes = beat_bytes + 1'b1;
  end

  logic [31:0] byte_cnt_q;
  logic [31:0] running_total;
  assign running_total = beat_sop_i ? 32'(beat_bytes) : (byte_cnt_q + 32'(beat_bytes));

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) byte_cnt_q <= '0;
    else if (accept) byte_cnt_q <= running_total;
  end

  localparam logic [31:0] Crc32Init = 32'hFFFF_FFFF;

  function automatic logic [31:0] crc32_byte_step(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) begin
      c = c[0] ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    end
    crc32_byte_step = c;
  endfunction

  logic [AxiDw-1:0] masked_data;
  always_comb begin
    for (int unsigned i = 0; i < AxiBw; i++) begin
      masked_data[i*8+:8] = beat_strb_i[i] ? beat_data_i[i*8+:8] : 8'h0;
    end
  end

  logic [31:0] crc_q;
  logic [31:0] crc_stages [AxiBw+1];
`ifdef MUT_CHECK_NOSOPRESET
  assign crc_stages[0] = crc_q;
`else
  assign crc_stages[0] = beat_sop_i ? Crc32Init : crc_q;
`endif
  for (genvar i = 0; i < AxiBw; i++) begin : g_crc_stage
    assign crc_stages[i+1] = crc32_byte_step(crc_stages[i], masked_data[i*8+:8]);
  end

  logic [31:0] crc_result;
`ifdef MUT_CHECK_WRONGIDX
  assign crc_result = crc_stages[AxiBw];
`else
  assign crc_result = crc_stages[beat_bytes];
`endif

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) crc_q <= Crc32Init;
    else if (accept) crc_q <= crc_result;
  end

  logic [31:0] crc_public;
  assign crc_public = ~crc_result;

  assign pkt_done_o = accept & beat_eop_i;
  assign crc_err_o  = pkt_done_o & (crc_public != beat_crc_i);
`ifdef MUT_CHECK_NOLENERR
  assign len_err_o  = 1'b0;
`else
  assign len_err_o  = pkt_done_o & ((running_total == 32'd0) | (running_total > MaxPacketBytes));
`endif

endmodule
