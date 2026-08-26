// Mutant copy of rtl/dma/desc_fetch.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them.
//
//   MUT_DESC_NOLINK   ctrl.link is ignored - the ring walk always advances
//                      linearly (cur_ptr + DescBytes) even when a
//                      descriptor asks to jump to next_ptr instead.
//   MUT_DESC_NOHALT   ctrl.last is ignored - the walk never halts after a
//                      ring's final descriptor and keeps trying to fetch
//                      past it instead.
//   MUT_DESC_NOCHECK  daq_pkg::desc_check() is bypassed entirely - every
//                      fetched descriptor is treated as ErrNone regardless
//                      of alignment, length, or its valid bit.
//
// Descriptor ring walker, shared across all NumCh channels.
//
// Sits between dma_sched and the two not-yet-built AXI masters (see PLAN.md's
// architecture diagram: dma_sched -> desc_fetch -> axi_rd_master -> AXI4).
// This module never touches AXI directly - it issues a small request/
// response protocol (rd_req_*/rd_resp_*) to axi_rd_master, which owns actual
// AR/R signalling, outstanding tracking, and 4KB-boundary splitting. That
// split mirrors the pkt_check/chan_ctrl one from phase 3: pkt_check computes
// a result, chan_ctrl acts on it, each doing one job.
//
// One request in flight at a time, across ALL channels, not one per channel
// -----------------------------------------------------------------------
// Only one descriptor fetch is ever outstanding, shared by every channel via
// a small prim_arbiter_tree instance (this module's own second use of it,
// after dma_sched's) over each channel's need_fetch bit. A channel needs a
// fetch exactly when it is enabled, not halted, not in error, and does not
// currently hold a validated descriptor - i.e. never more than one
// descriptor ahead. This keeps the per-channel state trivial (no pipeline,
// no speculative prefetch racing against a possible abort) at the cost of
// fetch latency being shared out across channels - acceptable because a
// descriptor fetch (DescBytes=16 bytes) is tiny and rare compared to the
// packet data traffic dma_sched already arbitrates on its own, much larger,
// timescale. Same fairness-state pitfall as dma_sched applies here too:
// the arbiter's request input is forced to all-zero whenever this module is
// already mid-fetch, not left presented-but-ignored, so its internal
// round-robin priority cannot be corrupted by requests that were never
// actually serviced this round - see dma_sched.sv's header for the full
// reasoning, identical here.
//
// Why pkt_start/pkt_done are NOT dma_sched signals directly
// -----------------------------------------------------------------------
// This module only needs to know two things per channel, both decoupled
// from dma_sched's own wires on purpose: "a fresh (re)start was requested"
// (ch_desc_go_i, from daq_csr - a self-clearing write-strobe pulse, same
// convention CH_DESC_CTRL's go bit already uses) and "the transfer for the
// descriptor currently held for this channel has finished" (xfer_done_i/
// xfer_done_ch_i). The second one is *not* dma_sched's out_eop_o: that only
// means "all of this packet's beats were handed to axi_wr_master," not "the
// AXI write actually landed" - axi_wr_master/wr_track (not built yet) are
// what will actually drive xfer_done_i, once they exist. Keeping this
// module's interface in those abstract terms rather than wired straight to
// dma_sched's ports is what makes it fully testable now, standalone, the
// same way tb_chan_top.sv stood in for dma_sched before dma_sched existed
// and tb_dma_sched.sv stood in for axi_wr_master.
//
// Ring-walk semantics
// -----------------------------------------------------------------------
// ch_desc_go_i loads ch_desc_base_i as the ring's current pointer and clears
// any halted/error state - a full restart, not a resume. From there the walk
// is autonomous: once a channel's held descriptor's transfer completes
// (xfer_done_i), if that descriptor's ctrl.last was set the channel halts
// (needs a fresh go to do anything else); otherwise the next pointer is
// ctrl.link ? next_ptr : (current pointer + DescBytes), and a fetch for it
// is requested automatically - software does not re-kick every descriptor.
// daq_pkg::desc_check() is reused as-is (shared with the DV reference model,
// per its own header) and its ErrDescInvalid-on-valid=0 contract is treated
// as a hard stop here, not a "poll and retry" condition: this ring model
// has no notion of software incrementally posting descriptors while
// hardware is already walking, so an invalid descriptor mid-ring is a real
// configuration error, not ordinary backpressure.
//
// ch_abort_i halts immediately (any state) and clears any latched error,
// matching chan_ctrl's ChError -> ChIdle-on-abort precedent, but does NOT
// clear halted_q the way a hard abort might suggest - see the always_ff
// below: halted_q stays 1 after an abort until an explicit ch_desc_go_i,
// so the engine never silently resumes walking from a stale pointer.
//
// What is deliberately out of scope here
// -----------------------------------------------------------------------
// ctrl.irq_en is read out of the fetched descriptor (part of desc_t) but not
// threaded anywhere - per-descriptor interrupt-on-completion is irq_ctrl's
// job (phase 5), not this module's. ch_desc_maxlen_o (the descriptor's
// length field) is exposed for axi_wr_master to check the actual write
// against, but this module does not itself compare bytes-written to it -
// it has no visibility into bytes written at all.

module desc_fetch
  import daq_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,

  // per-channel control, from daq_csr (already axi_clk domain)
  input  logic [NumCh-1:0]        ch_enable_i,
  input  logic [NumCh-1:0]        ch_abort_i,
  input  logic [31:0]             ch_desc_base_i [NumCh],
  input  logic [NumCh-1:0]        ch_desc_go_i,

  // "the transfer for the descriptor currently held by this channel has
  // finished" - from axi_wr_master/wr_track (not built yet); see header for
  // why this is not dma_sched's out_eop_o directly
  input  logic                     xfer_done_i,
  input  logic [ChIdxW-1:0]        xfer_done_ch_i,

  // read-request/response protocol to axi_rd_master (not built yet). Always
  // a fixed DescBytes read - no length field needed.
  output logic                      rd_req_valid_o,
  input  logic                       rd_req_ready_i,
  output logic [31:0]                rd_req_addr_o,

  input  logic                        rd_resp_valid_i,
  output logic                         rd_resp_ready_o,
  input  logic [AxiDw-1:0]             rd_resp_data_i,
  input  logic                         rd_resp_last_i,
  input  logic                         rd_resp_err_i,   // SLVERR/DECERR on this beat

  // per-channel fetched descriptor, to axi_wr_master (not built yet)
  output logic [NumCh-1:0]              ch_desc_valid_o,
  output logic [31:0]                   ch_desc_addr_o    [NumCh],
  output logic [31:0]                   ch_desc_maxlen_o  [NumCh],

  // per-channel status, to daq_csr (via daq_subsystem, phase 5)
  output logic [NumCh-1:0]              ch_err_o,
  output err_e                          ch_err_code_o     [NumCh]
);

  // A fixed-size read is always exactly the descriptor's own width; DescBits
  // is only guaranteed evenly divisible by AxiDw for the parameter sweep
  // this project actually tests (AxiDw ∈ {32,64}; DescBits=128 either way).
  localparam int unsigned DescBeats = DescBits / AxiDw;
  localparam int unsigned DescBeatCntW  = (DescBeats > 1) ? $clog2(DescBeats) : 1;

  // ---- per-channel ring-walk state -------------------------------------------

  logic [31:0] cur_ptr_q       [NumCh];
  logic [NumCh-1:0] desc_valid_q;
  logic [31:0] desc_addr_q     [NumCh];
  logic [31:0] desc_maxlen_q   [NumCh];
  logic [NumCh-1:0] desc_last_q;
  logic [NumCh-1:0] desc_link_q;
  logic [31:0] desc_next_ptr_q [NumCh];
  logic [NumCh-1:0] halted_q;
  logic [NumCh-1:0] err_q;
  err_e        err_code_q      [NumCh];

  // Needs a fetch: enabled, not already holding one, not stopped for any
  // reason. Forced to all-zero while a fetch is already in flight (state_q
  // != DfIdle) at the point of use below, not here - see fetch_req.
  //
  // Also forced to 0 on ch_desc_go_i's own cycle, and not just because a
  // fresh go usually coincides with desc_valid_q already being 0 (so it
  // would often look ready-to-fetch immediately): ch_desc_go_i is exactly
  // the cycle cur_ptr_q is being *loaded* with ch_desc_base_i - that load is
  // registered, so cur_ptr_q still holds its old (possibly stale, possibly
  // zero-at-reset) value on this same cycle. Arbitrating and issuing a
  // fetch using need_fetch computed from ch_enable_i/go alone, without this
  // gate, would request the *previous* pointer one cycle too early - not a
  // hypothetical, this is exactly what an earlier version of this file did,
  // caught immediately by tb_desc_fetch.sv issuing a bogus zero-address
  // fetch on every single go pulse.
  logic [NumCh-1:0] need_fetch;
  assign need_fetch = ch_enable_i & ~desc_valid_q & ~halted_q & ~err_q & ~ch_desc_go_i;

  // ---- shared fetch FSM -------------------------------------------------------

  typedef enum logic { DfIdle, DfResp } df_state_e;
  df_state_e state_q;

  logic [NumCh-1:0] fetch_req;
  assign fetch_req = (state_q == DfIdle) ? need_fetch : '0;

  logic [ChIdxW-1:0] arb_idx;
  logic              arb_valid;

  // Same NumCh==1 zero-width-port workaround dma_sched.sv uses for the same
  // reason (prim_arbiter_tree's idx_o has no N==1 guard of its own).
  if (NumCh > 1) begin : gen_arb
    prim_arbiter_tree #(
      .N          (NumCh),
      .DW         (1),
      .EnDataPort (0)
    ) u_arb (
      .clk_i,
      .rst_ni,
      .req_chk_i (1'b1),
      .req_i     (fetch_req),
      .data_i    ('{default: 1'b0}),
      /* verilator lint_off PINCONNECTEMPTY */
      .gnt_o     (),
      .data_o    (),
      /* verilator lint_on PINCONNECTEMPTY */
      .idx_o     (arb_idx),
      .valid_o   (arb_valid),
      .ready_i   (rd_req_ready_i)
    );
  end else begin : gen_no_arb
    assign arb_idx   = '0;
    assign arb_valid = fetch_req[0];
  end

  assign rd_req_valid_o = arb_valid;
  assign rd_req_addr_o  = cur_ptr_q[arb_idx];

  logic [ChIdxW-1:0]  fetch_ch_q;
  logic [DescBeatCntW-1:0] beat_cnt_q;
  logic                fetch_err_q;  // sticky across this fetch's earlier beats

  logic resp_accept;
  assign resp_accept = (state_q == DfResp) & rd_resp_valid_i & rd_resp_ready_o;
  assign rd_resp_ready_o = (state_q == DfResp);

  logic resp_final;
  assign resp_final = resp_accept & rd_resp_last_i;

  logic [AxiDw-1:0] resp_slot_q [DescBeats];
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      for (int unsigned i = 0; i < DescBeats; i++) resp_slot_q[i] <= '0;
    end else if (resp_accept) begin
      resp_slot_q[beat_cnt_q] <= rd_resp_data_i;
    end
  end

  // Same same-cycle-same-edge reasoning pkt_check.sv's running_total uses:
  // the beat that finalises the fetch is live on rd_resp_data_i this very
  // cycle, not yet committed into resp_slot_q[], so it has to be substituted
  // in explicitly rather than read back from a register that has not been
  // written yet.
  function automatic logic [DescBits-1:0] pack_desc_bits(
    input logic [AxiDw-1:0] slots [DescBeats],
    input logic [AxiDw-1:0] final_data,
    input int unsigned      final_idx
  );
    automatic logic [DescBits-1:0] bits;
    for (int unsigned i = 0; i < DescBeats; i++) begin
      bits[i*AxiDw+:AxiDw] = (i == final_idx) ? final_data : slots[i];
    end
    pack_desc_bits = bits;
  endfunction

  desc_t fetched_desc;
  assign fetched_desc = desc_t'(pack_desc_bits(resp_slot_q, rd_resp_data_i, int'(beat_cnt_q)));

  logic fetch_had_err;
  assign fetch_had_err = fetch_err_q | rd_resp_err_i;

  err_e fetch_result;
`ifdef MUT_DESC_NOCHECK
  assign fetch_result = fetch_had_err ? ErrDescFetch : ErrNone;
`else
  assign fetch_result = fetch_had_err ? ErrDescFetch : desc_check(fetched_desc);
`endif

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      state_q     <= DfIdle;
      fetch_ch_q  <= '0;
      beat_cnt_q  <= '0;
      fetch_err_q <= 1'b0;
    end else begin
      unique case (state_q)
        DfIdle: begin
          if (rd_req_valid_o & rd_req_ready_i) begin
            state_q     <= DfResp;
            fetch_ch_q  <= arb_idx;
            beat_cnt_q  <= '0;
            fetch_err_q <= 1'b0;
          end
        end
        DfResp: begin
          if (resp_accept) begin
            fetch_err_q <= fetch_err_q | rd_resp_err_i;
            if (rd_resp_last_i) state_q <= DfIdle;
            else                beat_cnt_q <= beat_cnt_q + 1'b1;
          end
        end
        default: state_q <= DfIdle;
      endcase
    end
  end

  // ---- per-channel state updates: abort > go > transfer-done > fetch-finalise -
  //
  // Single consolidated block (one writer per register) rather than several
  // always_ff blocks each touching the same arrays, which SystemVerilog
  // does not allow and Verilator would flag as multiply-driven. The
  // priority order matters only for the coincidental same-cycle case (e.g.
  // abort landing the same edge a fetch for that channel finalises) - a
  // transfer-done and a fetch-finalise for the SAME channel can never
  // coincide by construction: this module only ever fetches for a channel
  // that does not currently hold a valid descriptor, and transfer-done only
  // ever fires for a channel that does.
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      for (int unsigned c = 0; c < NumCh; c++) begin
        cur_ptr_q[c]       <= '0;
        desc_valid_q[c]    <= 1'b0;
        desc_addr_q[c]     <= '0;
        desc_maxlen_q[c]   <= '0;
        desc_last_q[c]     <= 1'b0;
        desc_link_q[c]     <= 1'b0;
        desc_next_ptr_q[c] <= '0;
        halted_q[c]        <= 1'b0;
        err_q[c]           <= 1'b0;
        err_code_q[c]      <= ErrNone;
      end
    end else begin
      for (int unsigned c = 0; c < NumCh; c++) begin
        if (ch_abort_i[c]) begin
          desc_valid_q[c] <= 1'b0;
          halted_q[c]     <= 1'b1;
          err_q[c]        <= 1'b0;
          err_code_q[c]   <= ErrNone;
        end else if (ch_desc_go_i[c]) begin
          cur_ptr_q[c]    <= ch_desc_base_i[c];
          desc_valid_q[c] <= 1'b0;
          halted_q[c]     <= 1'b0;
          err_q[c]        <= 1'b0;
          err_code_q[c]   <= ErrNone;
        end else if (xfer_done_i & (xfer_done_ch_i == ChIdxW'(c))) begin
          desc_valid_q[c] <= 1'b0;
`ifdef MUT_DESC_NOHALT
          cur_ptr_q[c] <= desc_link_q[c] ? desc_next_ptr_q[c] : (cur_ptr_q[c] + 32'(DescBytes));
`else
          if (desc_last_q[c]) begin
            halted_q[c] <= 1'b1;
          end else begin
`ifdef MUT_DESC_NOLINK
            cur_ptr_q[c] <= cur_ptr_q[c] + 32'(DescBytes);
`else
            cur_ptr_q[c] <= desc_link_q[c] ? desc_next_ptr_q[c] : (cur_ptr_q[c] + 32'(DescBytes));
`endif
          end
`endif
        end else if (resp_final & (fetch_ch_q == ChIdxW'(c))) begin
          if (fetch_result == ErrNone) begin
            desc_valid_q[c]    <= 1'b1;
            desc_addr_q[c]     <= fetched_desc.addr;
            desc_maxlen_q[c]   <= fetched_desc.length;
            desc_last_q[c]     <= fetched_desc.ctrl.last;
            desc_link_q[c]     <= fetched_desc.ctrl.link;
            desc_next_ptr_q[c] <= fetched_desc.next_ptr;
          end else begin
            err_q[c]      <= 1'b1;
            err_code_q[c] <= fetch_result;
            halted_q[c]   <= 1'b1;
          end
        end
      end
    end
  end

  assign ch_desc_valid_o   = desc_valid_q;
  assign ch_desc_addr_o    = desc_addr_q;
  assign ch_desc_maxlen_o  = desc_maxlen_q;
  assign ch_err_o          = err_q;
  assign ch_err_code_o     = err_code_q;

endmodule
