// CRC-32 verification and length checking on the packed beat stream, sitting
// downstream of the per-channel CDC FIFO (axi_clk domain).
//
// The beat itself passes through untouched and at full rate - pkt_check is a
// pure monitor, adding no latency and no backpressure of its own. The crc
// field carried on eop (daq_pkg::PktBeatCrcLsb) is consumed here and dropped
// from the output beat - daq_pkg::PktBeatClean* - since nothing downstream
// needs it once verification has happened.
//
// Detection is after the fact, matching Sample Test 3's own CRC checker: a
// packet's bytes are not held back pending the CRC result, so a bad packet
// has already been forwarded by the time crc_err_o/len_err_o report it.
// Store-and-forward (buffering a whole packet before releasing any of it)
// would need unbounded buffering sized to the largest legal packet and
// still only turns "corrupt data reached memory" into "corrupt data reached
// memory slightly later" for anything already past the check - chan_ctrl
// and the CSR error/interrupt path are what a bad packet's aftermath is for.
//
// Why this is not prim_crc32
// ---------------------------
// prim_crc32 has no byte-enable input: it always processes exactly
// BytesPerWord bytes on the cycle data_valid_i is asserted, full stop. Fed a
// partial last beat (fewer than AxiBw real bytes, the rest zero-padded by
// pkt_align), it silently also consumes the padding as if those were real
// trailing zero bytes of the packet - CRC-32 is not indifferent to trailing
// zeros, so this produces a value that is wrong except for a packet whose
// length happens to be an exact multiple of AxiBw. An earlier version of
// this file reused prim_crc32 anyway (with a one-cycle "arming stall" to work
// around its other limitation, set_crc_i and data_valid_i being mutually
// exclusive) and the block TB caught the padding problem immediately: every
// packet needing a partial last beat came back with the wrong CRC.
//
// The fix is the same principle as skid_buffer.sv and cnt_sat.sv in phase 1:
// where a reused prim genuinely does not fit, write the small piece that
// does, rather than force the reused block to do something it cannot. Here
// that piece is a byte-enable-aware combine step, structurally identical to
// prim_crc32's own internal chain (same reflected-polynomial byte update,
// unrolled bit-serially instead of table-driven since this project has no
// synthesis/PDK target yet to make a table's area/timing advantage matter -
// see RESULTS.md) but indexed by the beat's *actual* byte count instead of
// always the full BytesPerWord. crc_stages[n] is exactly the state after
// processing n real bytes; a full beat reads crc_stages[AxiBw], a partial
// one reads crc_stages[n] for whatever n<AxiBw it actually carried, and nothing
// downstream of index n was ever computed from padding. Being purely
// combinational and free of prim_crc32's own reset/data mutual exclusion, it
// also does not need the one-cycle stall the prim_crc32 version needed to
// support back-to-back packets, or the deferred compare needed to wait for a
// registered crc_out_o to catch up - both drop out entirely.

module pkt_check
  import daq_pkg::*;
(
  input  logic               clk_i,
  input  logic                rst_ni,

  // packed beat in, from the channel CDC FIFO
  input  logic                 beat_valid_i,
  output logic                 beat_ready_o,
  input  logic [AxiDw-1:0]     beat_data_i,
  input  logic [AxiBw-1:0]     beat_strb_i,
  input  logic                 beat_sop_i,
  input  logic                 beat_eop_i,
  input  logic [31:0]          beat_crc_i,

  // packed beat out - crc field dropped, everything else forwarded
  output logic                  beat_valid_o,
  input  logic                   beat_ready_i,
  output logic [AxiDw-1:0]       beat_data_o,
  output logic [AxiBw-1:0]       beat_strb_o,
  output logic                   beat_sop_o,
  output logic                   beat_eop_o,

  // per-packet result, a one-cycle pulse on the same cycle the eop beat is
  // accepted (no extra latency - see the module comment)
  output logic                    pkt_done_o,
  output logic                    crc_err_o,
  output logic                    len_err_o
);

  // ---- pure pass-through -----------------------------------------------------

  assign beat_ready_o = beat_ready_i;
  assign beat_valid_o = beat_valid_i;
  assign beat_data_o  = beat_data_i;
  assign beat_strb_o  = beat_strb_i;
  assign beat_sop_o   = beat_sop_i;
  assign beat_eop_o   = beat_eop_i;

  logic accept;
  assign accept = beat_valid_i & beat_ready_i;

  // ---- byte count for this beat, and the running per-packet total -----------

  logic [$clog2(AxiBw+1)-1:0] beat_bytes;
  always_comb begin
    beat_bytes = '0;
    for (int unsigned i = 0; i < AxiBw; i++) if (beat_strb_i[i]) beat_bytes = beat_bytes + 1'b1;
  end

  // Running total INCLUDING this beat. Computed once and shared by the
  // running counter's own update and the eop-time capture, rather than two
  // sites separately reading byte_cnt_q's registered (pre-edge) value - for
  // a beat that is both sop and eop (a single-beat packet), byte_cnt_q has
  // not been reset for it yet on this same edge, so an independent second
  // computation of "byte_cnt_q + beat_bytes" would add onto the *previous*
  // packet's leftover total instead of starting fresh.
  logic [31:0] byte_cnt_q;
  logic [31:0] running_total;
  assign running_total = beat_sop_i ? 32'(beat_bytes) : (byte_cnt_q + 32'(beat_bytes));

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) byte_cnt_q <= '0;
    else if (accept) byte_cnt_q <= running_total;
  end

  // ---- byte-enable-aware CRC-32 ------------------------------------------------

  localparam logic [31:0] Crc32Init = 32'hFFFF_FFFF;

  // One reflected-polynomial byte update - the same standard CRC-32
  // (IEEE 802.3 / zlib) algorithm prim_crc32's header comment says it
  // matches, just unrolled bit-serially instead of table-driven.
  function automatic logic [31:0] crc32_byte_step(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) begin
      c = c[0] ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    end
    crc32_byte_step = c;
  endfunction

  // Unstrobed lanes are zeroed defensively (pkt_align already zero-fills
  // them; this does not rely on that). It does not matter what value sits in
  // a lane beyond beat_bytes, since crc_stages[] beyond that index is never
  // selected below - this is just hygiene, not correctness-load-bearing.
  logic [AxiDw-1:0] masked_data;
  always_comb begin
    for (int unsigned i = 0; i < AxiBw; i++) begin
      masked_data[i*8+:8] = beat_strb_i[i] ? beat_data_i[i*8+:8] : 8'h0;
    end
  end

  logic [31:0] crc_q;  // persistent internal (non-inverted) accumulator state
  logic [31:0] crc_stages [AxiBw+1];
  assign crc_stages[0] = beat_sop_i ? Crc32Init : crc_q;
  for (genvar i = 0; i < AxiBw; i++) begin : g_crc_stage
    assign crc_stages[i+1] = crc32_byte_step(crc_stages[i], masked_data[i*8+:8]);
  end

  // State after this beat's *real* bytes only - crc_stages[AxiBw] for a full
  // beat, crc_stages[n] for a partial one, never a padding-corrupted value.
  logic [31:0] crc_result;
  assign crc_result = crc_stages[beat_bytes];

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) crc_q <= Crc32Init;
    else if (accept) crc_q <= crc_result;
  end

  // ---- result, same cycle as the eop beat's acceptance -------------------------

  logic [31:0] crc_public;  // the standard, publicly-compared CRC-32 value
  assign crc_public = ~crc_result;

  assign pkt_done_o = accept & beat_eop_i;
  assign crc_err_o  = pkt_done_o & (crc_public != beat_crc_i);
  assign len_err_o  = pkt_done_o & ((running_total == 32'd0) | (running_total > MaxPacketBytes));

endmodule
