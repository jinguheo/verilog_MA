// Mutant copy of rtl/stream/chan_ctrl.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them. Regenerated from the
// current golden file (2026-08-26) after the previous copy went stale across
// three real chan_ctrl.sv bugfixes (the ChIdle drain-and-discard feature -
// idle_drain, drain_pending_q - did not exist yet in the earlier copy) and
// was silently getting "killed" for that unrelated reason rather than for
// the specific defect each MUT_CTRL_* claims to inject - see
// samples/sample_test_4/RESULTS.md's phase 3 section for the full story.
//
//   MUT_CTRL_NODRAIN   ch_enable_i dropping mid-packet (ChRunning) goes
//                      straight to ChIdle instead of ChDraining - the
//                      in-flight packet is abandoned rather than finished.
//   MUT_CTRL_NOABORT   ch_abort_i is ignored while in ChError - the only
//                      way out of the error state is gone.
//   MUT_CTRL_BUSYWRONG ch_busy_o also asserts in ChArmed, not just
//                      Running/Draining.
//
// Per-channel FSM: idle, armed, running, draining, error.
//
// Sits between pkt_check and whatever eventually arbitrates across channels
// (dma_sched, phase 4 - not built yet, so beat_valid_o/beat_ready_i here are
// exercised only by this block's own testbench for now). Two jobs: gate
// whether the beat stream is even allowed to flow (accepting only while
// enabled and not in error), and turn pkt_check's per-packet pkt_done_i/
// crc_err_i/len_err_i pulses into the level/cause outputs daq_csr's
// register map expects.
//
// State meanings
// --------------
//   ChIdle     disabled. Nothing accepted.
//   ChArmed    enabled, no packet currently in flight. Ready to accept the
//              next packet's sop.
//   ChRunning  mid-packet (between an accepted sop and that packet's
//              pkt_done_i), channel still enabled.
//   ChDraining mid-packet, but ch_enable_i has already dropped. The current
//              packet is still accepted and forwarded to completion rather
//              than truncated - dropping a packet mid-flight because
//              software happened to clear enable one beat early would be a
//              worse outcome than finishing it. No further packet is
//              started after this one.
//   ChError    entered when a just-completed packet's pkt_done_i arrives
//              with crc_err_i or len_err_i set. Nothing is accepted while
//              here; only ch_abort_i clears it, matching Sample Test 3's
//              CMD-clear precedent (an error state that a status register
//              alone cannot walk back from).
//
// ch_abort_i is a hard abort from any state, including mid-packet: it
// abandons whatever was in flight rather than waiting for pkt_done_i. What
// that leaves behind for a not-yet-built downstream consumer (a partially
// forwarded packet) is out of scope here and needs revisiting once
// dma_sched/desc_fetch exist in phase 4.
//
// ChIdle drains and discards, found the hard way
// -----------------------------------------------
// pkt_align has no idea what ch_enable_i is - it packs whatever bytes arrive
// on the source stream regardless, and the CDC FIFO between it and this
// block can already hold a beat or several by the time chan_ctrl sees any of
// it. A block TB scenario that enables the channel and disables it again
// before axi_clk had seen a single beat of the packet that was already
// crossing exposed the consequence directly: chan_ctrl went ChArmed ->
// ChIdle exactly as ChArmed's own transition rule says it should (nothing
// had been accepted yet, so there was nothing to drain), but the packet's
// bytes were still sitting in the FIFO. The next enable treated the FIRST of
// those leftover bytes as a brand new packet's sop - two bytes short of the
// original length in the block TB's own byte-for-byte count, because that
// is exactly how much of the stale packet's final partial beat the FIFO
// still hadn't finished delivering by the time the corruption was scored.
// ChDraining already protects the case where axi_clk *had* started accepting
// (Running -> Draining on disable); it does nothing for a packet that never
// got that far. So ChIdle now unconditionally accepts and discards
// (beat_ready_o high, beat_valid_o always low) anything still in the pipe.
// ch_enable_i only moves it to ChArmed once the pipe is provably empty AND
// no drained beat is known to still be mid-packet (drain_pending_q, a sticky
// bit cleared only when a drained beat's own eop is observed) - a first
// version checked only "is anything being offered this exact cycle", which
// is not the same thing: the CDC FIFO's read side can present a momentary
// gap between two beats of the same still-arriving abandoned packet, and
// checking only the instantaneous signal caught that gap as "done" one beat
// too early, leaking the tail of the abandoned packet into the next enabled
// session. A block TB scenario - enable, then disable again before axi_clk
// had seen a single beat of a packet already crossing - is what exposed
// this, twice (see the block TB's own comments for how each version failed).
//
// ch_busy_o is deliberately the narrower of two readings available for
// "busy": ChRunning/ChDraining only, not ChArmed. This distinguishes
// "enabled and idle between packets" from "actively moving data" for
// software polling GLOBAL_STATUS - the wider reading (anything not ChIdle)
// would make busy indistinguishable from "just enabled."
//
// ch_cause_o's FifoOvf bit is always 0: nothing in phase 3 detects a FIFO
// overflow condition, because the backpressure-complete design (skid_buffer
// in pkt_align, plain valid/ready everywhere else) makes silent overflow
// structurally unreachable - see rtl/stream/pkt_align.sv's header. The bit
// is wired to a constant rather than omitted so daq_csr's four-cause
// contract does not need a phase-3 special case.

module chan_ctrl
  import daq_pkg::*;
(
  input  logic               clk_i,
  input  logic                rst_ni,

  // control, from the CSR (already in this clock domain - CDC across a
  // channel boundary is chan_top's/daq_subsystem's job, not this block's)
  input  logic                 ch_enable_i,
  input  logic                 ch_abort_i,

  // beat stream in, from pkt_check
  input  logic                  beat_valid_i,
  output logic                  beat_ready_o,
  input  logic [AxiDw-1:0]      beat_data_i,
  input  logic [AxiBw-1:0]      beat_strb_i,
  input  logic                  beat_sop_i,
  input  logic                  beat_eop_i,

  // beat stream out, gated
  output logic                   beat_valid_o,
  input  logic                    beat_ready_i,
  output logic [AxiDw-1:0]        beat_data_o,
  output logic [AxiBw-1:0]        beat_strb_o,
  output logic                    beat_sop_o,
  output logic                    beat_eop_o,

  // per-packet result, from pkt_check
  input  logic                     pkt_done_i,
  input  logic                     crc_err_i,
  input  logic                     len_err_i,

  // status, to the CSR
  output logic                      ch_busy_o,
  output logic                      ch_err_o,
  output logic [NumIrqCause-1:0]    ch_cause_o
);

  ch_state_e state_q, state_d;

  logic accepting;
  assign accepting = (state_q == ChArmed) | (state_q == ChRunning) | (state_q == ChDraining);

  // ChIdle drains and discards rather than refusing outright - see the
  // module header. beat_ready_o is unconditional here (nothing downstream
  // needs to be ready for a beat that is about to be thrown away), and
  // beat_valid_o never asserts for it - a discarded beat is never forwarded.
  logic idle_drain;
  assign idle_drain = (state_q == ChIdle);

  assign beat_ready_o = accepting ? beat_ready_i : idle_drain;
  assign beat_valid_o = accepting & beat_valid_i;
  assign beat_data_o  = beat_data_i;
  assign beat_strb_o  = beat_strb_i;
  assign beat_sop_o   = beat_sop_i;
  assign beat_eop_o   = beat_eop_i;

  // Sticky: is the beat currently being drained (or the last one drained)
  // known to be mid-packet, i.e. was its eop not yet seen? beat_valid_i
  // alone is not a safe "fully drained" signal - the CDC FIFO's read side
  // can present a momentary gap between two beats of the SAME still-arriving
  // abandoned packet (an empty-flag resynchronization cycle, or simply
  // pkt_align not having finished forming the next beat yet), and a check
  // that only asked "is anything being offered this exact cycle" could catch
  // that gap and declare the drain finished one beat too early. This bit
  // only clears when a drained beat's own eop was actually observed, so a
  // momentary gap mid-packet leaves it stuck at 1 rather than mistaking the
  // gap for completion.
  logic drain_pending_q;
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      drain_pending_q <= 1'b0;
    end else if (idle_drain) begin
      if (beat_valid_i) drain_pending_q <= ~beat_eop_i;
    end else begin
      drain_pending_q <= 1'b0;
    end
  end

  logic accept;
  assign accept = beat_valid_i & beat_ready_o;

  always_comb begin
    state_d = state_q;
    unique case (state_q)
      ChIdle: begin
        // Only move on once the pipe is provably empty this same cycle -
        // not merely once software has asked to re-enable - so a beat still
        // being drained from a previous, abandoned session is never
        // mistaken for the new session's sop.
        if (ch_enable_i & ~beat_valid_i & ~drain_pending_q) state_d = ChArmed;
      end

      ChArmed: begin
        if (accept & beat_sop_i) begin
          // A single-beat packet has sop and eop - and therefore pkt_done_i -
          // on this exact same cycle. pkt_done_i is a one-cycle pulse; if
          // this branch just moved on to ChRunning without checking it here,
          // ChRunning's own "if (pkt_done_i)" would evaluate one cycle too
          // late, after the pulse had already passed, and the channel would
          // sit in ChRunning forever waiting for a completion that already
          // happened. So the completion decision itself - not just "start
          // running" - has to be evaluated right here for that beat.
          if (pkt_done_i) begin
            if (crc_err_i | len_err_i) state_d = ChError;
            else if (ch_enable_i)      state_d = ChArmed;
            else                       state_d = ChIdle;
          end else begin
            state_d = ChRunning;
          end
        end else if (!ch_enable_i) begin
          state_d = ChIdle;
        end
        if (ch_abort_i) state_d = ChIdle;
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

  // Gated by `accepting`, not raw pkt_done_i: a beat discarded by ChIdle's
  // drain still flows through pkt_check underneath (its beat_ready_o mirrors
  // this module's, so pkt_check accepts and evaluates it exactly the same as
  // any other beat), so an abandoned packet's own eop can pulse pkt_done_i
  // while this module sits in ChIdle. Without this gate that would raise a
  // real interrupt cause in the CSR for a packet software never even started
  // in the session it is about to begin.
  logic [NumIrqCause-1:0] cause_d;
  assign cause_d[IrqCauseDone]    = accepting & pkt_done_i & ~crc_err_i & ~len_err_i;
  assign cause_d[IrqCauseErr]     = accepting & pkt_done_i & len_err_i;
  assign cause_d[IrqCauseCrc]     = accepting & pkt_done_i & crc_err_i;
  assign cause_d[IrqCauseFifoOvf] = 1'b0;

  // Registered on the way out - see golden chan_ctrl.sv for why. Mirrored
  // here unchanged (not part of any MUT_CTRL_* defect) so this file stays
  // structurally in sync with golden, per the project's own stale-mutant
  // lesson.
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) ch_cause_o <= '0;
    else         ch_cause_o <= cause_d;
  end

endmodule
