// Digital bridge between one channel's analog front end (the SKY130
// sky130_ef_ip__adc3v_12bit hard macro - see analog/README.md) and that same
// channel's chan_top src_* byte stream (pkt_align's slave port, phase 3).
//
// The settled interface contract (B3 of the digital+analog integration plan)
// -----------------------------------------------------------------------
// 1. Clock domain: this module runs entirely on the SAME clock as the
//    channel's own src_clk_i. The catalog's ADC hard macro is purely the
//    analog core (CDAC + comparator, per its own port list: adc_dac_val_i,
//    adc_comp_out_o, no on-board SAR sequencer) - the successive-
//    approximation control logic that walks the DAC code bit by bit is
//    digital and belongs here, and there is no reason to invent a ninth
//    (ADC-specific) clock domain and its own CDC into src_clk when the
//    plan's own architecture already gives every channel an independent
//    clock for exactly this kind of per-channel analog front end. This
//    keeps the crossing count at what PLAN.md already budgeted for.
// 2. Packet framing: SamplesPerPacket consecutive 12-bit conversions are
//    batched into one packet, 2 bytes per sample (low byte first, high
//    byte = {4'b0, code[11:8]}), sop on the packet's first byte and eop on
//    its last, with a running CRC-32 presented on src_crc_o at eop -
//    exactly daq_pkg's sideband-CRC convention (see pkt_align.sv's own
//    header) and the same crc32_byte_step algorithm pkt_check.sv and this
//    project's testbenches already use, so a software reference model
//    written against those is directly reusable here. One packet per
//    sample would work too but wastes almost all of pkt_check's per-packet
//    overhead on 2 bytes of payload; SamplesPerPacket is a parameter
//    rather than a hardcoded batch size specifically so this tradeoff can
//    be retuned once real sample-rate/latency requirements exist.
// 3. Conversion timing: one src_clk_i cycle per bit decision (12 cycles),
//    plus one cycle to pulse adc_hold_o for sample-and-hold, is assumed
//    sufficient for the comparator/CDAC to settle. This is a documented
//    simplifying assumption, not a measured number - the physical-design
//    side has not yet characterized this macro's actual settling time
//    (see analog/README.md's 2026-09-20 LVS section for the macro's
//    current signoff status). Revisit once it has.
// 4. adc_trim_i (per-macro calibration code) and adc_vCM_i (common-mode
//    bias) are analog/static configuration, not part of the per-conversion
//    digital handshake - this module does not drive them. They are
//    top-level integration's concern (a CSR-backed trim register, most
//    likely), out of scope here.

module sar_adc_ch #(
  parameter int unsigned AdcBits          = 12,
  parameter int unsigned SamplesPerPacket = 128
) (
  input  logic clk_i,   // = this channel's src_clk_i
  input  logic rst_ni,

  // ---- analog-macro-facing digital pins (sky130_ef_ip__adc3v_12bit) --------
  output logic [AdcBits-1:0] adc_dac_val_o,
  input  logic                adc_comp_out_i,
  output logic                 adc_ena_o,
  output logic                 adc_reset_o,
  output logic                 adc_hold_o,

  // ---- digital source stream, to this channel's chan_top (pkt_align) ------
  output logic       src_valid_o,
  input  logic        src_ready_i,
  output logic [7:0]   src_data_o,
  output logic         src_sop_o,
  output logic         src_eop_o,
  output logic [31:0]  src_crc_o
);

  localparam int unsigned PacketBytes = SamplesPerPacket * 2;
  localparam int unsigned BitIdxW     = (AdcBits  > 1) ? $clog2(AdcBits)     : 1;
  localparam int unsigned ByteCntW    = (PacketBytes > 1) ? $clog2(PacketBytes) : 1;

  localparam logic [31:0] Crc32Init = 32'hFFFF_FFFF;

  // Same reflected-polynomial byte step pkt_check.sv and this project's
  // testbenches already use - kept local (not a shared daq_pkg function)
  // for the same reason pkt_check.sv's own copy is local: it is small, and
  // a shared function would need daq_pkg to depend on nothing macro-
  // specific, which is not worth it for one loop.
  function automatic logic [31:0] crc32_byte_step(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) c = c[0] ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    crc32_byte_step = c;
  endfunction

  typedef enum logic [2:0] { StReset, StHold, StBit, StEmitLo, StEmitHi } state_e;
  state_e state_q;

  logic [1:0]         reset_cnt_q;      // hold adc_reset_o for a couple of cycles
  logic [AdcBits-1:0] code_q;           // bits above bit_idx_q are decided; at/below are still 0
  logic [BitIdxW-1:0] bit_idx_q;
  logic [ByteCntW-1:0] byte_cnt_q;      // byte position within the current packet
  logic [31:0]         crc_q;           // raw (non-inverted) running CRC state

  // ---- SAR trial code presented to the DAC this cycle -------------------------
  logic [AdcBits-1:0] trial_code;
  assign trial_code = code_q | (AdcBits'(1) << bit_idx_q);

  assign adc_dac_val_o = (state_q == StBit) ? trial_code : code_q;
  assign adc_ena_o      = ~adc_reset_o;
  assign adc_reset_o    = (state_q == StReset);
  assign adc_hold_o     = (state_q == StHold);

  // ---- byte packing --------------------------------------------------------------
  logic [7:0] lo_byte, hi_byte;
  assign lo_byte = code_q[7:0];
  assign hi_byte = {4'b0, code_q[AdcBits-1:8]};

  logic       is_last_byte;
  assign is_last_byte = (byte_cnt_q == ByteCntW'(PacketBytes - 1));

  assign src_valid_o = (state_q == StEmitLo) | (state_q == StEmitHi);
  assign src_data_o  = (state_q == StEmitLo) ? lo_byte : hi_byte;
  assign src_sop_o   = (state_q == StEmitLo) & (byte_cnt_q == '0);
  assign src_eop_o   = (state_q == StEmitHi) & is_last_byte;

  logic accept;
  assign accept = src_valid_o & src_ready_i;

  logic [31:0] crc_next;
  assign crc_next = crc32_byte_step(crc_q, src_data_o);
  assign src_crc_o = crc_next ^ 32'hFFFF_FFFF;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      state_q     <= StReset;
      reset_cnt_q <= '0;
      code_q      <= '0;
      bit_idx_q   <= BitIdxW'(AdcBits - 1);
      byte_cnt_q  <= '0;
      crc_q       <= Crc32Init;
    end else begin
      unique case (state_q)
        StReset: begin
          if (reset_cnt_q == 2'd2) begin
            reset_cnt_q <= '0;
            state_q     <= StHold;
          end else begin
            reset_cnt_q <= reset_cnt_q + 2'd1;
          end
        end

        StHold: begin
          code_q    <= '0;
          bit_idx_q <= BitIdxW'(AdcBits - 1);
          state_q   <= StBit;
        end

        StBit: begin
          // comp_out_i convention: 1 means the trial DAC code is above the
          // sampled input (bit stays 0), 0 means the input is at or above
          // the trial code (bit is kept).
          if (!adc_comp_out_i) code_q <= trial_code;
          if (bit_idx_q == '0) begin
            state_q <= StEmitLo;
          end else begin
            bit_idx_q <= bit_idx_q - BitIdxW'(1);
          end
        end

        StEmitLo: begin
          if (accept) begin
            crc_q      <= crc_next;
            byte_cnt_q <= byte_cnt_q + ByteCntW'(1);
            state_q    <= StEmitHi;
          end
        end

        StEmitHi: begin
          if (accept) begin
            if (is_last_byte) begin
              crc_q      <= Crc32Init;
              byte_cnt_q <= '0;
            end else begin
              crc_q      <= crc_next;
              byte_cnt_q <= byte_cnt_q + ByteCntW'(1);
            end
            state_q <= StHold;
          end
        end

        default: state_q <= StReset;
      endcase
    end
  end

endmodule
