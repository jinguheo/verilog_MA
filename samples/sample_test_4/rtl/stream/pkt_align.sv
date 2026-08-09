// Packs an 8-bit-per-cycle source stream into AxiDw-wide beats with byte
// strobes, for the partial last beat of a packet.
//
// Protocol: src_valid_i/src_ready_o/src_data_i is a plain byte stream.
// src_sop_i marks the packet's first byte, src_eop_i its last. Nothing else
// about packet framing is assumed - length is whatever falls between one
// src_sop_i and the next src_eop_i, and pkt_check.sv is the one that judges
// whether that length is legal.
//
// Byte accumulation and output backpressure are two separate concerns here,
// deliberately: the accumulator (byte_cnt_q/cur_data_q/cur_strb_q) only ever
// holds the beat currently being assembled, while skid_buffer absorbs
// whatever downstream backpressure shows up once a beat is ready to leave.
// Without that split, a stalled downstream would force src_ready_o low for
// the entire time a beat sits waiting, even though bytes for the *next*
// beat could otherwise keep accumulating.
//
// src_ready_o only ever needs to gate on the byte that would COMPLETE the
// current beat - every other byte is accepted unconditionally, because
// accepting it only ever grows the in-progress accumulator, which nothing
// downstream can backpressure.

module pkt_align
  import daq_pkg::*;
(
  input  logic                  clk_i,
  input  logic                  rst_ni,

  // source stream, one byte per accepted cycle
  input  logic                  src_valid_i,
  output logic                  src_ready_o,
  input  logic [SrcDw-1:0]      src_data_i,
  input  logic                  src_sop_i,
  input  logic                  src_eop_i,
  input  logic [31:0]           src_crc_i,   // expected CRC-32, valid with src_eop_i

  // packed beat out
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

  // Is the byte on offer this cycle the one that completes the beat -
  // either the accumulator is about to fill (AxiBw bytes) or the source
  // says this is the packet's last byte, which always finalises the beat
  // regardless of fill level (a partial last beat).
  logic is_final_byte;
  assign is_final_byte = (byte_cnt_q == ByteCntW'(AxiBw - 1)) | src_eop_i;

  logic skid_ready;
  assign src_ready_o = ~is_final_byte | skid_ready;

  logic accept_byte;
  assign accept_byte = src_valid_i & src_ready_o;

  // Accumulator state as it would be immediately after absorbing this
  // cycle's byte (if any) - used both as "what to push out" when this byte
  // finalises the beat, and as "what to hold" otherwise.
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
  // sop can only ever land on the accumulator's first byte (byte_cnt_q==0);
  // a well-formed source never asserts it elsewhere, and this module does
  // not police that - pkt_check's length/framing checks are downstream of a
  // trusted source model in phase 3, same scoping as desc_check() not
  // validating next_ptr unconditionally.
  assign nxt_sop = (byte_cnt_q == '0) ? (accept_byte & src_sop_i) : cur_sop_q;

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
        // This beat is being handed to the skid buffer this cycle (below);
        // the accumulator resets for the next one.
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
  assign skid_in[PktBeatCrcLsb+:32]     = src_crc_i;
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
