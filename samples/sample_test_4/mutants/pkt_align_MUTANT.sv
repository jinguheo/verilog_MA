// Mutant copy of rtl/stream/pkt_align.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them.
//
//   MUT_ALIGN_NOEOP    is_final_byte ignores src_eop_i - a partial last beat
//                      never flushes; its bytes get folded into whatever
//                      beat comes next instead. Caught by the per-packet
//                      length check (bytes migrate across the packet
//                      boundary) and, once enough packets run together, the
//                      overall byte-count check.
//   MUT_ALIGN_SOPFROZEN nxt_sop ignores src_sop_i entirely and just tracks
//                      cur_sop_q - since cur_sop_q resets to 0 and nothing
//                      ever sets it, sop never fires on any beat. Caught by
//                      the "first beat of a packet did not carry sop" check.
//   MUT_ALIGN_NOCRC     beat_crc_o is always 0 instead of passing src_crc_i
//                      through. Caught by the per-packet CRC check.
//
// Not offered: forcing cur_sop_q to stay 1 across a beat boundary instead of
// clearing to 0 at finalisation. That looks like a plausible "sop leaks into
// the next beat" defect but is an EQUIVALENT MUTANT: nxt_sop's byte_cnt_q==0
// branch (accept_byte & src_sop_i) always recomputes cur_sop_q fresh at the
// start of the very next beat, before the stuck value is ever read again -
// so whatever the finalisation branch leaves behind is provably overwritten
// before it can affect anything. It was tried, it passed, and the
// testbench was right to pass it.

module pkt_align
  import daq_pkg::*;
(
  input  logic                  clk_i,
  input  logic                  rst_ni,
  input  logic                  src_valid_i,
  output logic                  src_ready_o,
  input  logic [SrcDw-1:0]      src_data_i,
  input  logic                  src_sop_i,
  input  logic                  src_eop_i,
  input  logic [31:0]           src_crc_i,
  output logic                  beat_valid_o,
  input  logic                  beat_ready_i,
  output logic [AxiDw-1:0]      beat_data_o,
  output logic [AxiBw-1:0]      beat_strb_o,
  output logic                  beat_sop_o,
  output logic                  beat_eop_o,
  output logic [31:0]           beat_crc_o
);

  localparam int unsigned ByteCntW = (AxiBw > 1) ? $clog2(AxiBw) : 1;

  logic [ByteCntW-1:0] byte_cnt_q;
  logic [AxiDw-1:0]    cur_data_q;
  logic [AxiBw-1:0]    cur_strb_q;
  logic                cur_sop_q;

  logic is_final_byte;
`ifdef MUT_ALIGN_NOEOP
  assign is_final_byte = (byte_cnt_q == ByteCntW'(AxiBw - 1));
`else
  assign is_final_byte = (byte_cnt_q == ByteCntW'(AxiBw - 1)) | src_eop_i;
`endif

  logic skid_ready;
  assign src_ready_o = ~is_final_byte | skid_ready;

  logic accept_byte;
  assign accept_byte = src_valid_i & src_ready_o;

  logic [AxiDw-1:0] nxt_data;
  logic [AxiBw-1:0] nxt_strb;
  logic             nxt_sop;
  always_comb begin
    nxt_data = cur_data_q;
    nxt_strb = cur_strb_q;
    if (accept_byte) begin
      nxt_data[byte_cnt_q*8+:8] = src_data_i;
      nxt_strb[byte_cnt_q] = 1'b1;
    end
  end
`ifdef MUT_ALIGN_SOPFROZEN
  assign nxt_sop = cur_sop_q;
`else
  assign nxt_sop = (byte_cnt_q == '0) ? (accept_byte & src_sop_i) : cur_sop_q;
`endif

  logic pre_valid;
  assign pre_valid = accept_byte & is_final_byte;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      byte_cnt_q <= '0;
      cur_data_q <= '0;
      cur_strb_q <= '0;
      cur_sop_q  <= 1'b0;
    end else if (accept_byte) begin
      if (is_final_byte) begin
        byte_cnt_q <= '0;
        cur_data_q <= '0;
        cur_strb_q <= '0;
        cur_sop_q  <= 1'b0;
      end else begin
        byte_cnt_q <= byte_cnt_q + ByteCntW'(1);
        cur_data_q <= nxt_data;
        cur_strb_q <= nxt_strb;
        cur_sop_q  <= nxt_sop;
      end
    end
  end

  logic [PktBeatBits-1:0] skid_in, skid_out;
  assign skid_in[PktBeatDataLsb+:AxiDw] = nxt_data;
  assign skid_in[PktBeatStrbLsb+:AxiBw] = nxt_strb;
`ifdef MUT_ALIGN_NOCRC
  assign skid_in[PktBeatCrcLsb+:32]     = 32'h0;
`else
  assign skid_in[PktBeatCrcLsb+:32]     = src_crc_i;
`endif
  assign skid_in[PktBeatEopBit]         = src_eop_i;
  assign skid_in[PktBeatSopBit]         = nxt_sop;

  skid_buffer #(.Width(PktBeatBits)) u_skid (
    .clk_i,
    .rst_ni,
    .valid_i (pre_valid),
    .ready_o (skid_ready),
    .data_i  (skid_in),
    .valid_o (beat_valid_o),
    .ready_i (beat_ready_i),
    .data_o  (skid_out)
  );

  assign beat_data_o = skid_out[PktBeatDataLsb+:AxiDw];
  assign beat_strb_o = skid_out[PktBeatStrbLsb+:AxiBw];
  assign beat_crc_o  = skid_out[PktBeatCrcLsb+:32];
  assign beat_eop_o  = skid_out[PktBeatEopBit];
  assign beat_sop_o  = skid_out[PktBeatSopBit];

endmodule
