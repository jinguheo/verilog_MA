// Mutant copy of rtl/stream/chan_ctrl.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them.
//
//   MUT_CTRL_NODRAIN   ch_enable_i dropping mid-packet goes straight to
//                      ChIdle instead of ChDraining - the in-flight packet
//                      is abandoned rather than finished. Caught by phase 4
//                      (Draining path) and phase 6 (Draining -> Error).
//   MUT_CTRL_NOABORT   ch_abort_i is ignored while in ChError - the only
//                      way out of the error state is gone. Caught by every
//                      phase that clears an error with abort (5, 6, 8).
//   MUT_CTRL_BUSYWRONG ch_busy_o also asserts in ChArmed, not just
//                      Running/Draining - caught by phase 2's explicit
//                      "busy clears back in Armed" check.

module chan_ctrl
  import daq_pkg::*;
(
  input  logic               clk_i,
  input  logic                rst_ni,
  input  logic                 ch_enable_i,
  input  logic                 ch_abort_i,
  input  logic                  beat_valid_i,
  output logic                  beat_ready_o,
  input  logic [AxiDw-1:0]      beat_data_i,
  input  logic [AxiBw-1:0]      beat_strb_i,
  input  logic                  beat_sop_i,
  input  logic                  beat_eop_i,
  output logic                   beat_valid_o,
  input  logic                    beat_ready_i,
  output logic [AxiDw-1:0]        beat_data_o,
  output logic [AxiBw-1:0]        beat_strb_o,
  output logic                    beat_sop_o,
  output logic                    beat_eop_o,
  input  logic                     pkt_done_i,
  input  logic                     crc_err_i,
  input  logic                     len_err_i,
  output logic                      ch_busy_o,
  output logic                      ch_err_o,
  output logic [NumIrqCause-1:0]    ch_cause_o
);

  ch_state_e state_q, state_d;

  logic accepting;
  assign accepting = (state_q == ChArmed) | (state_q == ChRunning) | (state_q == ChDraining);

  assign beat_ready_o = accepting & beat_ready_i;
  assign beat_valid_o = accepting & beat_valid_i;
  assign beat_data_o  = beat_data_i;
  assign beat_strb_o  = beat_strb_i;
  assign beat_sop_o   = beat_sop_i;
  assign beat_eop_o   = beat_eop_i;

  logic accept;
  assign accept = beat_valid_i & beat_ready_o;

  always_comb begin
    state_d = state_q;
    unique case (state_q)
      ChIdle: begin
        if (ch_enable_i) state_d = ChArmed;
      end

      ChArmed: begin
        if (accept & beat_sop_i)   state_d = ChRunning;
        else if (!ch_enable_i)     state_d = ChIdle;
        if (ch_abort_i)            state_d = ChIdle;
      end

      ChRunning: begin
        if (pkt_done_i) begin
          if (crc_err_i | len_err_i) state_d = ChError;
          else if (ch_enable_i)      state_d = ChArmed;
          else                       state_d = ChIdle;
        end else if (!ch_enable_i) begin
`ifdef MUT_CTRL_NODRAIN
          state_d = ChIdle;
`else
          state_d = ChDraining;
`endif
        end
        if (ch_abort_i) state_d = ChIdle;
      end

      ChDraining: begin
        if (pkt_done_i) begin
          state_d = (crc_err_i | len_err_i) ? ChError : ChIdle;
        end
        if (ch_abort_i) state_d = ChIdle;
      end

      ChError: begin
`ifndef MUT_CTRL_NOABORT
        if (ch_abort_i) state_d = ChIdle;
`endif
      end

      default: state_d = ChIdle;
    endcase
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) state_q <= ChIdle;
    else         state_q <= state_d;
  end

`ifdef MUT_CTRL_BUSYWRONG
  assign ch_busy_o = (state_q == ChArmed) | (state_q == ChRunning) | (state_q == ChDraining);
`else
  assign ch_busy_o = (state_q == ChRunning) | (state_q == ChDraining);
`endif
  assign ch_err_o  = (state_q == ChError);

  assign ch_cause_o[IrqCauseDone]    = pkt_done_i & ~crc_err_i & ~len_err_i;
  assign ch_cause_o[IrqCauseErr]     = pkt_done_i & len_err_i;
  assign ch_cause_o[IrqCauseCrc]     = pkt_done_i & crc_err_i;
  assign ch_cause_o[IrqCauseFifoOvf] = 1'b0;

endmodule
