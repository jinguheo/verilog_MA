// Mutant copy of rtl/dma/dma_sched.sv. See mutants/skid_buffer_MUTANT.sv for
// why these exist and what -Mutant does with them.
//
//   MUT_SCHED_STICKYLOCK  a single-beat (sop=eop) packet's grant locks the
//                         scheduler permanently instead of releasing the
//                         same cycle - every other channel (and that
//                         channel's own next packet) starves forever after.
//   MUT_SCHED_EARLYUNLOCK the locked-packet unlock condition checks the
//                         locked channel's eop *value* alone, not whether
//                         that eop beat was actually accepted this cycle -
//                         unlocks a cycle early whenever eop is offered but
//                         stalled (e.g. by backpressure), opening the door
//                         to another channel's sop before the real packet
//                         has finished.
//   MUT_SCHED_DBLREADY    idle-time arbitration is no longer suspended while
//                         a channel is locked mid-packet (sop_req stays live
//                         for everyone, not gated by locked_q) and its ready
//                         grant is no longer mutually exclusive with the
//                         locked channel's own - so a second channel
//                         presenting a fresh sop while another is still mid-
//                         packet can see ch_ready_o asserted the same cycle
//                         as the locked channel, breaking the onehot0
//                         invariant and interleaving two packets' beats.
//
// Packet granularity, not beat granularity, and why
// beat streams (chan_top's beat_valid_o/beat_ready_i/beat_data_o/beat_strb_o/
// beat_sop_o/beat_eop_o, one instance per channel), merging them into the
// single beat stream axi_wr_master (not built yet) will actually issue AXI
// writes for.
//
// Packet granularity, not beat granularity, and why
// ---------------------------------------------------
// The obvious-looking design is to feed all NumCh valid/ready pairs straight
// into prim_arbiter_tree every cycle and let it re-arbitrate beat by beat.
// That is wrong here: once axi_wr_master starts issuing write bursts for a
// channel's packet, everything downstream of this module (its outstanding
// write address/length bookkeeping, wr_track's per-transfer tracking) is
// scoped to "the packet currently being written," not "the beat currently
// being written." Letting the winner change mid-packet - which beat-level
// round-robin would do the instant a currently-winning channel has a single
// idle cycle (a stall, or simply consuming its own upstream backpressure) -
// would interleave two channels' bytes into what downstream believes is one
// contiguous transfer. So this module arbitrates only at packet boundaries:
// once a channel is granted (its sop beat is accepted), every other
// channel's beat_ready_o stays low - not merely deprioritised, but excluded
// from arbitration entirely - until that channel's own eop beat is accepted,
// at which point the next packet's sop is free to be won by anyone.
//
// This does mean one channel presenting a very long packet can hold the
// shared AXI write path for that packet's whole duration while seven others
// wait, even if they have short packets ready. That is the same tradeoff
// chan_ctrl's ChDraining makes at the single-channel level (finish what is
// in flight rather than truncate it) - store-and-forward or packet
// preemption would need per-channel buffering this design does not build.
// If a later phase needs bounded per-channel write latency, the fix belongs
// here (e.g. a max-beats-per-grant cap) - see PHASE_3_6_PLAN.md.
//
// Arbitration itself while idle (no channel currently locked) is
// prim_arbiter_tree (reused, same primitive daq_csr and axil_slave's peers
// use nowhere yet but the plan calls for here) restricted to requesting only
// on a channel's sop beat - a channel mid-way through accumulating bytes for
// its *next* packet's sop is simply not a candidate until that beat exists.
// EnDataPort is left at 0: the tree only ever needs to hand back an index
// here (which channel won), not mux the data itself, since once won this
// module locks onto that channel's ports directly for the rest of the
// packet - a plain per-cycle mux, not the tree's own data path.

module dma_sched
  import daq_pkg::*;
(
  input  logic                      clk_i,
  input  logic                      rst_ni,

  // per-channel gated beat stream in, from each channel's chan_top
  input  logic [NumCh-1:0]          ch_valid_i,
  output logic [NumCh-1:0]          ch_ready_o,
  input  logic [AxiDw-1:0]          ch_data_i [NumCh],
  input  logic [AxiBw-1:0]          ch_strb_i [NumCh],
  input  logic [NumCh-1:0]          ch_sop_i,
  input  logic [NumCh-1:0]          ch_eop_i,

  // one arbitrated beat stream out, to axi_wr_master (not built yet)
  output logic                      out_valid_o,
  input  logic                      out_ready_i,
  output logic [AxiDw-1:0]          out_data_o,
  output logic [AxiBw-1:0]          out_strb_o,
  output logic                      out_sop_o,
  output logic                      out_eop_o,
  // which channel out_* currently belongs to - valid whenever out_valid_o is
  output logic [ChIdxW-1:0]         out_ch_o
);

  // ---- idle-time arbitration: who wins the next packet -----------------------

  // Declared here (ahead of the lock-state section below that flops it)
  // because sop_req's own gating needs it.
  logic locked_q;

  // Gated to '0 while locked, not just left as ch_valid_i & ch_sop_i and
  // ignored: prim_arbiter_tree updates its own internal round-robin priority
  // state from whichever requests are asserted each cycle it is given
  // ready_i=1, whether or not this wrapper actually acts on the result.
  // Leaving other channels' sop requests visible to it while locked would
  // let the tree silently "grant" and advance past them for a slot they
  // never actually got, biasing the next real (unlocked) round's fairness.
  // With req_i forced to all-zero here, the tree's own idle branch
  // (`|req_i` false) holds its priority mask exactly steady instead.
  logic [NumCh-1:0]     sop_req;
`ifdef MUT_SCHED_DBLREADY
  assign sop_req = ch_valid_i & ch_sop_i;
`else
  assign sop_req = locked_q ? '0 : (ch_valid_i & ch_sop_i);
`endif

  logic [ChIdxW-1:0]    arb_idx;
  logic                 arb_valid;

  // prim_arbiter_tree's own idx_o is [$clog2(N)-1:0] with no N==1 guard, so
  // at N=1 that port is genuinely zero-width - a real (if degenerate) case
  // the primitive itself already handles internally (gen_degenerate_case),
  // just not one this module's own ChIdxW (always >= 1 bit, same guarded
  // convention as daq_pkg.sv's ChIdxW) can connect to without a width
  // mismatch. Bypassing the tree entirely for the single-channel case avoids
  // that mismatch rather than papering over it with a forced-width cast.
  if (NumCh > 1) begin : gen_arb
    prim_arbiter_tree #(
      .N          (NumCh),
      .DW         (1),
      .EnDataPort (0)
    ) u_arb (
      .clk_i,
      .rst_ni,
      .req_chk_i (1'b1),
      .req_i     (sop_req),
      .data_i    ('{default: 1'b0}),
      /* verilator lint_off PINCONNECTEMPTY */
      .gnt_o     (),
      .data_o    (),
      /* verilator lint_on PINCONNECTEMPTY */
      .idx_o     (arb_idx),
      .valid_o   (arb_valid),
      .ready_i   (out_ready_i)
    );
  end else begin : gen_no_arb
    assign arb_idx   = '0;
    assign arb_valid = sop_req[0];
  end

  // ---- lock state: which channel (if any) owns the shared output right now --
  // (locked_q itself is declared above, next to sop_req which needs it.)

  logic [ChIdxW-1:0]     locked_ch_q;

  logic                  grant_now;   // this cycle's sop beat is being won and accepted
  assign grant_now = ~locked_q & arb_valid & out_ready_i;

  logic                  win_eop;     // the just-granted (or already-locked) beat is also eop -
                                       // a single-beat packet, same "decide completion right here"
                                       // reasoning chan_ctrl's ChArmed uses for pkt_done_i.
`ifdef MUT_SCHED_EARLYUNLOCK
  assign win_eop = grant_now ? ch_eop_i[arb_idx] : (locked_q & ch_eop_i[locked_ch_q]);
`else
  assign win_eop = grant_now ? ch_eop_i[arb_idx] : (locked_q & out_valid_o & out_ready_i & ch_eop_i[locked_ch_q]);
`endif

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      locked_q    <= 1'b0;
      locked_ch_q <= '0;
    end else if (grant_now) begin
      // Lock onto the winner unless its very first beat is already the
      // packet's last one, in which case there is nothing left to lock for.
`ifdef MUT_SCHED_STICKYLOCK
      locked_q    <= 1'b1;
`else
      locked_q    <= ~win_eop;
`endif
      locked_ch_q <= arb_idx;
    end else if (locked_q & win_eop) begin
      locked_q <= 1'b0;
    end
  end

  // ---- output mux --------------------------------------------------------------

  logic [ChIdxW-1:0] active_ch;
  assign active_ch = locked_q ? locked_ch_q : arb_idx;

  assign out_valid_o = locked_q ? ch_valid_i[locked_ch_q] : arb_valid;
  assign out_data_o   = ch_data_i[active_ch];
  assign out_strb_o   = ch_strb_i[active_ch];
  assign out_sop_o    = ch_sop_i[active_ch];
  assign out_eop_o    = ch_eop_i[active_ch];
  assign out_ch_o     = active_ch;

  // Only the active channel (locked owner, or - while idle - the arbiter's
  // current winner) ever sees its ready asserted; everyone else stays low so
  // an unlocked channel can never smuggle a non-sop beat through, and a
  // losing channel during idle-time arbitration cannot either.
  always_comb begin
    ch_ready_o = '0;
    if (locked_q) begin
      ch_ready_o[locked_ch_q] = out_ready_i;
    end
`ifdef MUT_SCHED_DBLREADY
    if (arb_valid) begin
`else
    else if (arb_valid) begin
`endif
      ch_ready_o[arb_idx] = out_ready_i;
    end
  end

endmodule
