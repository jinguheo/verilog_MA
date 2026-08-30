// Formal harness for dma_sched - the packet-granularity locking arbiter
// across all channels' gated beat streams. Single clock, single reset.
//
// NumCh is set to 2 for this proof via -DDAQ_NUM_CH=2 (the package's own
// override mechanism, the same one the lint parameter sweep uses) and AxiDw
// to 8 via -DDAQ_AXI_DW=8: the control logic these properties exercise does
// not depend on either width, and shrinking both keeps the state space small
// enough for induction to close in seconds rather than minutes. 2 channels is
// the minimum that can exercise "another channel's sop arrives while one is
// locked" at all - the exact scenario every mutant below targets.
//
// Correctness here is NOT full round-robin fairness (that is a liveness
// property - "an always-requesting channel is eventually granted" - which a
// safety-only k-induction proof does not attempt and this harness makes no
// claim about). What is proved is packet-atomicity and mutual exclusion: once
// a channel is locked, it owns the shared output until its own eop beat is
// genuinely accepted, no two channels are ever driven onto the output at
// once, and a channel is never granted a beat that was not its own sop.
module dma_sched_formal(
  input logic clk_i,
  input logic [1:0] ch_valid_i,
  input logic [1:0] ch_sop_i,
  input logic [1:0] ch_eop_i,
  input logic out_ready_i
);
  logic rst_ni;
  wire [1:0] ch_ready_o;
  wire out_valid_o, out_sop_o, out_eop_o;
  wire [0:0] out_ch_o;
  // AxiDw left at its real default (64, AxiBw=8) rather than shrunk: an
  // earlier attempt overrode it to 8, which collapses daq_pkg's
  // DescAlignBytes (=AxiDw/8) to 1 and makes an unrelated function
  // elsewhere in the package declare a `[$clog2(1)-1:0]` = `[-1:0]` range -
  // daq_pkg.sv is elaborated as a whole, so that break has nothing to do
  // with dma_sched itself but still fails the build. The data/strobe ports
  // are pass-through wires regardless of width, so there is no proof-speed
  // reason to shrink them - only NumCh needs to be small.
  wire [63:0] out_data_o;
  wire [7:0] out_strb_o;
  logic [63:0] ch_data_i [2];
  logic [7:0] ch_strb_i [2];
  // Data/strobe are pure pass-through muxes, irrelevant to the arbitration
  // properties below - tied to a fixed pattern rather than left as free
  // inputs purely to keep the cone of influence (and therefore solve time)
  // small; no property here inspects out_data_o/out_strb_o.
  assign ch_data_i[0] = 64'h00; assign ch_data_i[1] = 64'h01;
  assign ch_strb_i[0] = 8'hff;  assign ch_strb_i[1] = 8'hff;

  dma_sched dut(
    .clk_i(clk_i), .rst_ni(rst_ni),
    .ch_valid_i(ch_valid_i), .ch_ready_o(ch_ready_o),
    .ch_data_i(ch_data_i), .ch_strb_i(ch_strb_i),
    .ch_sop_i(ch_sop_i), .ch_eop_i(ch_eop_i),
    .out_valid_o(out_valid_o), .out_ready_i(out_ready_i),
    .out_data_o(out_data_o), .out_strb_o(out_strb_o),
    .out_sop_o(out_sop_o), .out_eop_o(out_eop_o), .out_ch_o(out_ch_o)
  );

  reg [1:0] cyc = 0;
  always @(posedge clk_i) if (cyc < 3) cyc <= cyc + 1;
  assign rst_ni = (cyc >= 2);

  // The condition that legitimately ends a lock: the locked channel's own eop
  // beat is actually accepted (valid AND ready), not merely offered. Computed
  // combinationally here and registered below so next cycle's properties can
  // compare "was this true last cycle" against "is the lock still held now."
  wire unlock_now = dut.locked_q & out_valid_o & out_ready_i & ch_eop_i[dut.locked_ch_q];
  wire grant_now  = dut.grant_now;
  wire win_eop    = dut.win_eop;

  reg past_valid;
  reg p_locked_q, p_unlock_now, p_grant_now, p_win_eop;
  reg [0:0] p_locked_ch_q;
  always @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      past_valid <= 0;
      p_locked_q <= 0; p_unlock_now <= 0; p_grant_now <= 0; p_win_eop <= 0;
      p_locked_ch_q <= '0;
    end else begin
      past_valid <= 1;
      p_locked_q <= dut.locked_q; p_unlock_now <= unlock_now;
      p_grant_now <= grant_now; p_win_eop <= win_eop;
      p_locked_ch_q <= dut.locked_ch_q;
    end
  end

  always @(posedge clk_i) begin
    if (rst_ni) begin
      // Mutual exclusion: never more than one channel's ready asserted at
      // once. Directly targets MUT_SCHED_DBLREADY, which drops exactly this
      // guarantee by leaving the idle-arbitration branch live while locked.
      assert ($countones(ch_ready_o) <= 1);

      // Output consistency: whichever channel is "active" per the DUT's own
      // bookkeeping is the one whose valid/data the output actually reflects.
      if (dut.locked_q) begin
        assert (dut.active_ch == dut.locked_ch_q);
        assert (out_valid_o == ch_valid_i[dut.locked_ch_q]);
      end

      // No output claimed for a channel that is not really valid.
      assert (!out_valid_o || ch_valid_i[dut.active_ch]);

      // A newly granted channel's very first beat is genuinely its sop -
      // the arbiter only ever requests on sop beats, but this checks the
      // grant itself lines up with that intent rather than assuming it.
      if (grant_now) assert (ch_sop_i[dut.arb_idx]);
    end

    if (rst_ni && past_valid) begin
      // A lock that was won and completed in the same cycle (a single-beat
      // packet) must actually be gone next cycle. Targets
      // MUT_SCHED_STICKYLOCK, which forces locked_q high unconditionally on
      // every grant regardless of win_eop.
      if (p_grant_now && p_win_eop) assert (!dut.locked_q);

      // No premature unlock: while locked, the lock and its owning channel
      // may only change on the cycle the owning channel's eop beat was
      // genuinely accepted last cycle. Targets MUT_SCHED_EARLYUNLOCK, which
      // unlocks on eop being merely *offered* (ignoring out_ready_i).
      if (p_locked_q && !p_unlock_now) begin
        assert (dut.locked_q);
        assert (dut.locked_ch_q == p_locked_ch_q);
      end
    end
  end
endmodule
