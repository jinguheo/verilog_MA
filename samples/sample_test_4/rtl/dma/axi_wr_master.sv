// AXI4 write master: the other half of the DMA payload path, taking
// dma_sched's single arbitrated beat stream (one channel's packet at a time,
// locked sop-to-eop - see dma_sched.sv's own header) and desc_fetch's
// per-channel destination address/length, and turning them into AW/W/B
// traffic. Single-outstanding across the whole design, same narrowing
// axi_rd_master already applied to the read side: dma_sched never presents
// more than one channel's packet at a time, so there is never a reason for
// this module to have two AW/W bursts in flight together either.
//
// Why this module needs MaxBurst splitting and axi_rd_master did not
// -----------------------------------------------------------------------
// axi_rd_master only ever reads a fixed DescBytes (16 bytes - a handful of
// beats at most), so 4 KB boundary-splitting was the only concern worth
// building. A DMA payload write can be up to DescMaxLength (1 MiB), which
// would be a single multi-thousand-beat AWLEN if nothing else capped it -
// legal by the 4 KB rule alone (many pages fit whole) but not a realistic
// single AXI burst. daq_pkg::MaxBurst (16 beats) caps every burst this
// module issues, so a large transfer becomes a sequence of MaxBurst-sized
// bursts, each independently checked against the 4 KB rule via
// axi_pkg::bytes_to_boundary() (reused, same helper axi_rd_master already
// uses) in case a boundary falls inside what would otherwise be a full
// MaxBurst run.
//
// Burst sizing is descriptor-driven; completion is stream-driven
// -----------------------------------------------------------------------
// Two different signals answer two different questions, deliberately kept
// separate rather than derived from each other:
//   - "how many beats does THIS burst get" is decided from
//     ch_desc_maxlen_i (the destination descriptor's own length field,
//     latched into remain_beats_q at the packet's sop) against MaxBurst and
//     the 4 KB boundary. AXI requires committing to AWLEN before the first
//     W beat, so this has to come from something known in advance - the
//     descriptor length is the only such value available.
//   - "has the whole transfer finished" is decided from wr_eop_i, observed
//     directly on whichever W beat the stream actually marks as the
//     packet's last, captured into cur_eop_q at the moment that beat is
//     accepted. It is NOT inferred from remain_beats_q reaching zero.
// If a descriptor's length and the actual packet's byte count ever disagree
// (a system configuration error - dma_sched/pkt_check do not cross-check a
// packet's length against a channel's descriptor at all today), this split
// means a wrong burst size does not also produce a wrong completion signal;
// the transfer still ends exactly when the stream says it ends. Getting
// remain_beats_q to reach exactly zero when wr_eop_i also arrives is a
// system-level invariant this module trusts, not one it validates - the
// same trust boundary desc_fetch.sv's header already draws around ring
// pointer alignment.
//
// ch_desc_addr_i/ch_desc_maxlen_i are read unconditionally at every sop,
// without consulting desc_fetch's own ch_desc_valid_i for that channel.
// By the time dma_sched has anything to arbitrate for a channel, that
// channel's descriptor is expected to already be the valid one desc_fetch
// is holding for it - enforced by the enable/ring-walk sequencing elsewhere,
// not re-checked here. See wr_track.sv's header for what happens (and does
// not happen) when a write actually fails.
//
// Why this is two modules, not one (mirrors desc_fetch/axi_rd_master)
// -----------------------------------------------------------------------
// This module owns AXI signalling only: AW/W/B mechanics, burst-length
// arithmetic, one burst at a time. It hands each finished burst off as a
// small completion event (burst_done_*) rather than deciding for itself
// what a completed transfer means for the channel - that per-channel
// bookkeeping (is this the descriptor's last burst, did any burst error,
// when to tell desc_fetch to move on) is wr_track.sv's job, the same
// protocol/semantics split desc_fetch's own header describes between itself
// and axi_rd_master.

module axi_wr_master
  import daq_pkg::*;
  import axi_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,

  // arbitrated beat stream in, from dma_sched - one channel's packet at a
  // time, held locked sop-to-eop
  input  logic                   wr_valid_i,
  output logic                    wr_ready_o,
  input  logic [AxiDw-1:0]        wr_data_i,
  input  logic [AxiBw-1:0]        wr_strb_i,
  input  logic                    wr_sop_i,
  input  logic                    wr_eop_i,
  input  logic [ChIdxW-1:0]       wr_ch_i,

  // per-channel destination descriptor, from desc_fetch - sampled only at
  // sop (see header on why ch_desc_valid_i is not consulted here)
  input  logic [31:0]             ch_desc_addr_i    [NumCh],
  input  logic [31:0]             ch_desc_maxlen_i  [NumCh],

  // per-burst completion, to wr_track
  output logic                     burst_done_valid_o,
  output logic [ChIdxW-1:0]        burst_done_ch_o,
  output logic                     burst_done_err_o,
  output logic                     burst_done_last_o,  // this burst finished the whole transfer

  // AXI4 write address channel
  output logic                       awvalid_o,
  input  logic                        awready_i,
  output logic [31:0]                 awaddr_o,
  output logic [7:0]                  awlen_o,
  output logic [2:0]                  awsize_o,
  output logic [1:0]                  awburst_o,
  output logic [AxiIdw-1:0]           awid_o,
  output logic [3:0]                  awcache_o,
  output prot_t                       awprot_o,

  // AXI4 write data channel
  output logic                         wvalid_o,
  input  logic                          wready_i,
  output logic [AxiDw-1:0]              wdata_o,
  output logic [AxiBw-1:0]              wstrb_o,
  output logic                          wlast_o,

  // AXI4 write response channel
  input  logic                          bvalid_i,
  output logic                          bready_o,
  input  logic [1:0]                    bresp_i,
  input  logic [AxiIdw-1:0]             bid_i
);

  localparam int unsigned BeatBytes = AxiDw / 8;

  // Single-outstanding, fixed AWID=0, same reasoning as axi_rd_master's
  // fixed ARID=0: there is structurally never more than one write
  // transaction in flight, so bid_i can never legally be anything else.
  logic unused_bid;
  assign unused_bid = ^bid_i;

  function automatic logic [31:0] min_u32(input logic [31:0] a, input logic [31:0] b);
    min_u32 = (a < b) ? a : b;
  endfunction

  typedef enum logic [1:0] { WrIdle, WrAw, WrW, WrB } wr_state_e;
  wr_state_e state_q;

  // ---- per-transfer state, latched at sop -----------------------------------

  logic [ChIdxW-1:0] ch_q;
  logic [31:0]        addr_q;
  logic [31:0]         remain_beats_q;  // beats left to write for this transfer

  // ---- per-burst state, latched when this burst's AW is accepted -----------

  logic [BeatCntW-1:0] burst_beats_q;
  logic [BeatCntW-1:0] beat_cnt_q;
  logic                cur_eop_q;   // wr_eop_i of the last beat accepted this burst

  logic sop_accept;
  assign sop_accept = (state_q == WrIdle) & wr_valid_i & wr_sop_i;

  // ---- AW ------------------------------------------------------------------

  logic [31:0] boundary_beats;
  assign boundary_beats = 32'(bytes_to_boundary(addr_q)) / 32'(BeatBytes);

  // Sized to BeatCntW, not left at the natural 32-bit width of the min_u32
  // computation feeding it: MaxBurst is always one of the three operands, so
  // the result is mathematically capped at MaxBurst and fits losslessly -
  // declaring it any wider would leave the upper bits structurally unused.
  logic [BeatCntW-1:0] burst_beats_c;
  assign burst_beats_c = BeatCntW'(min_u32(min_u32(32'(MaxBurst), remain_beats_q), boundary_beats));

  logic aw_accept;
  assign aw_accept = (state_q == WrAw) & awvalid_o & awready_i;

  assign awvalid_o = (state_q == WrAw);
  assign awaddr_o  = addr_q;
  // Driven from the live combinational burst_beats_c, not the registered
  // burst_beats_q: burst_beats_q only updates at aw_accept itself (the tail
  // end of WrAw), so reading it here would drive awlen_o from the PREVIOUS
  // burst's size for however many cycles WrAw spends waiting on awready_i -
  // stale for exactly as long as backpressure holds it. burst_beats_c has
  // no such lag: its own inputs (addr_q, remain_beats_q) are already correct
  // for the whole of WrAw, having last changed when the previous burst's B
  // was accepted.
  assign awlen_o   = 8'(burst_beats_c) - 8'd1;
  assign awsize_o  = 3'($clog2(BeatBytes));
  assign awburst_o = BurstIncr;
  assign awid_o    = '0;
  assign awcache_o = CacheNonCacheable;
  assign awprot_o  = ProtDataUnpriv;

  // burst_beats_q/beat_cnt_q are latched from the AW-issue cycle's own
  // combinational values, not from whatever addr_q/remain_beats_q might
  // read afterwards - both stay constant through WrAw/WrW anyway (they only
  // update once, at the following WrB->WrAw/WrIdle edge), but latching here
  // keeps awlen_o itself stable across the AW handshake regardless.
  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      burst_beats_q <= '0;
    end else if (aw_accept) begin
      burst_beats_q <= burst_beats_c;
    end
  end

  // ---- W: direct passthrough of the beat stream -----------------------------

  logic w_active;
  assign w_active = (state_q == WrW);

  assign wvalid_o = w_active & wr_valid_i;
  assign wr_ready_o = w_active & wready_i;
  assign wdata_o   = wr_data_i;
  assign wstrb_o   = wr_strb_i;
  assign wlast_o   = w_active & (beat_cnt_q == burst_beats_q - 1'b1);

  logic w_beat_accept;
  assign w_beat_accept = w_active & wr_valid_i & wready_i;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      beat_cnt_q <= '0;
    end else if (aw_accept) begin
      beat_cnt_q <= '0;
    end else if (w_beat_accept) begin
      beat_cnt_q <= beat_cnt_q + 1'b1;
    end
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      cur_eop_q <= 1'b0;
    end else if (w_beat_accept) begin
      cur_eop_q <= wr_eop_i;
    end
  end

  // ---- B: single-outstanding response, and burst-boundary bookkeeping ------

  logic b_accept;
  assign b_accept = (state_q == WrB) & bvalid_i;
  assign bready_o = (state_q == WrB);

  assign burst_done_valid_o = b_accept;
  assign burst_done_ch_o    = ch_q;
  assign burst_done_err_o   = resp_is_error(bresp_i);
  assign burst_done_last_o  = cur_eop_q;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      ch_q           <= '0;
      addr_q         <= '0;
      remain_beats_q <= '0;
    end else if (sop_accept) begin
      ch_q           <= wr_ch_i;
      addr_q         <= ch_desc_addr_i[wr_ch_i];
      remain_beats_q <= 32'(ch_desc_maxlen_i[wr_ch_i]) >> $clog2(BeatBytes);
    end else if (b_accept & ~cur_eop_q) begin
      addr_q         <= addr_q + 32'(burst_beats_q) * 32'(BeatBytes);
      remain_beats_q <= remain_beats_q - 32'(burst_beats_q);
    end
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      state_q <= WrIdle;
    end else begin
      unique case (state_q)
        WrIdle: if (sop_accept) state_q <= WrAw;
        WrAw:   if (aw_accept) state_q <= WrW;
        WrW:    if (w_beat_accept & (beat_cnt_q == burst_beats_q - 1'b1)) state_q <= WrB;
        WrB:    if (b_accept) state_q <= cur_eop_q ? WrIdle : WrAw;
        default: state_q <= WrIdle;
      endcase
    end
  end

endmodule
