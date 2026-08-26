// Mutant copy of rtl/dma/axi_rd_master.sv. See mutants/skid_buffer_MUTANT.sv
// for why these exist and what -Mutant does with them.
//
//   MUT_RDM_NOSPLIT   the 4 KB boundary split decision is skipped - every
//                      fetch is issued as a single AR, even one that would
//                      actually cross the boundary.
//   MUT_RDM_LASTWRONG  rd_resp_last_o is just rlast_i, not qualified by
//                      whether a second burst is still coming - a split
//                      fetch's first burst falsely signals completion.
//   MUT_RDM_ERRDROP    rd_resp_err_o is always 0 - an RRESP error on any
//                      beat is silently dropped instead of surfaced.
//
// AXI4 read master, scoped to exactly what desc_fetch.sv needs and nothing
// more - per PLAN.md's own open question ("whether the AXI read master is
// needed for anything beyond descriptor fetch, deferred to phase 4 once
// desc_fetch.sv exists to make it concrete"), now answered: desc_fetch is
// the only consumer this design has, and it only ever has one fetch
// outstanding at a time (see desc_fetch.sv's header - a single shared
// request path across all channels, not one per channel). So this module
// is deliberately single-outstanding too, not a general-purpose multi-ID
// AXI read master: `AxiIdw` exists for the register map's declared
// outstanding-capacity concept, but a fixed ARID=0 is all that is ever
// needed here, since there is structurally never more than one transaction
// in flight to track.
//
// Always full-bus-width, never narrow
// -----------------------------------------------------------------------
// Every AR this module issues uses ARSIZE = the full AxiDw bus width - no
// sub-bus-width (narrow) transfers, which would need byte-lane extraction
// on receive that this module does not implement. This only works cleanly
// for a request address already aligned to AxiDw's own byte width, which is
// exactly why daq_pkg::DescAlignBytes tracks AxiDw (see its own header) -
// this module is the reason that decision was made concrete. desc_fetch.sv
// separately documents why its own request addresses (ring pointers) are
// assumed pre-aligned by convention rather than validated in hardware.
//
// The one thing this module does still have to handle correctly: a fixed
// DescBytes-sized read can still straddle a 4 KB boundary even though it is
// small, if the request address happens to land close enough to one - AXI4
// forbids any single burst from crossing that boundary regardless of size.
// axi_pkg::bytes_to_boundary() (reused, same helper axi_wr_master will need
// for its own, much more consequential splitting) decides whether this
// fetch needs to be split into two back-to-back bursts, and if so, exactly
// where.

module axi_rd_master
  import daq_pkg::*;
  import axi_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,

  // request/response protocol from desc_fetch - always a fixed DescBytes
  // read, no length field needed
  input  logic                   rd_req_valid_i,
  output logic                    rd_req_ready_o,
  input  logic [31:0]             rd_req_addr_i,

  output logic                     rd_resp_valid_o,
  input  logic                      rd_resp_ready_i,
  output logic [AxiDw-1:0]          rd_resp_data_o,
  output logic                      rd_resp_last_o,
  output logic                      rd_resp_err_o,

  // AXI4 read address channel
  output logic                       arvalid_o,
  input  logic                        arready_i,
  output logic [31:0]                 araddr_o,
  output logic [7:0]                  arlen_o,
  output logic [2:0]                  arsize_o,
  output logic [1:0]                  arburst_o,
  output logic [AxiIdw-1:0]           arid_o,
  output logic [3:0]                  arcache_o,
  output prot_t                       arprot_o,

  // AXI4 read data channel
  input  logic                         rvalid_i,
  output logic                          rready_o,
  input  logic [AxiDw-1:0]              rdata_i,
  input  logic [1:0]                    rresp_i,
  input  logic                          rlast_i,
  input  logic [AxiIdw-1:0]             rid_i
);

  localparam int unsigned DescBeats = DescBits / AxiDw;
  localparam int unsigned BeatBytes = AxiDw / 8;

  // rid_i is not checked against arid_o: with exactly one transaction ever
  // outstanding, there is nothing else it could legally be.
  logic unused_rid;
  assign unused_rid = ^rid_i;

  typedef enum logic [2:0] { RdIdle, RdAr1, RdR1, RdAr2, RdR2 } rd_state_e;
  rd_state_e state_q;

  // ---- split decision, latched at request-accept time --------------------------

  logic        split_q;
  logic [31:0] addr1_q, addr2_q;
  logic [7:0]  len1_q, len2_q;  // AXI ARLEN convention: beats - 1

  logic                 req_accept;
  assign req_accept = (state_q == RdIdle) & rd_req_valid_i & rd_req_ready_o;
  assign rd_req_ready_o = (state_q == RdIdle);

  logic [31:0] boundary_bytes;
  assign boundary_bytes = 32'(bytes_to_boundary(rd_req_addr_i));

  logic split_needed;
`ifdef MUT_RDM_NOSPLIT
  assign split_needed = 1'b0;
`else
  assign split_needed = boundary_bytes < DescBytes;
`endif

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      split_q <= 1'b0;
      addr1_q <= '0;
      addr2_q <= '0;
      len1_q  <= '0;
      len2_q  <= '0;
    end else if (req_accept) begin
      split_q <= split_needed;
      addr1_q <= rd_req_addr_i;
      if (split_needed) begin
        // boundary_bytes is guaranteed a multiple of BeatBytes: both
        // BoundaryBytes (4096) and rd_req_addr_i (assumed AxiDw-aligned,
        // per the module header) are multiples of BeatBytes, so their
        // difference is too.
        len1_q  <= 8'(boundary_bytes / BeatBytes) - 8'd1;
        addr2_q <= rd_req_addr_i + boundary_bytes;
        len2_q  <= 8'(DescBeats - boundary_bytes / BeatBytes) - 8'd1;
      end else begin
        len1_q  <= 8'(DescBeats) - 8'd1;
        addr2_q <= '0;
        len2_q  <= '0;
      end
    end
  end

  // ---- AXI AR ---------------------------------------------------------------------

  logic [31:0] ar_addr;
  logic [7:0]  ar_len;
  assign ar_addr = (state_q == RdAr2) ? addr2_q : addr1_q;
  assign ar_len  = (state_q == RdAr2) ? len2_q  : len1_q;

  assign arvalid_o = (state_q == RdAr1) | (state_q == RdAr2);
  assign araddr_o  = ar_addr;
  assign arlen_o   = ar_len;
  assign arsize_o  = 3'($clog2(BeatBytes));
  assign arburst_o = BurstIncr;
  assign arid_o    = '0;
  assign arcache_o = CacheNonCacheable;
  assign arprot_o  = ProtDataUnpriv;

  // ---- AXI R -> rd_resp passthrough ------------------------------------------------

  logic r_active;
  assign r_active = (state_q == RdR1) | (state_q == RdR2);

  assign rready_o        = r_active & rd_resp_ready_i;
  assign rd_resp_valid_o = r_active & rvalid_i;
  assign rd_resp_data_o  = rdata_i;
`ifdef MUT_RDM_ERRDROP
  assign rd_resp_err_o   = 1'b0;
`else
  assign rd_resp_err_o   = resp_is_error(rresp_i);
`endif
  // The overall fetch's last beat is R1's rlast_i only when there is no
  // second burst; when split, only R2's rlast_i is the real end - R1's own
  // rlast_i there just marks the end of the *first* burst, not the fetch.
`ifdef MUT_RDM_LASTWRONG
  assign rd_resp_last_o  = rlast_i;
`else
  assign rd_resp_last_o  = rlast_i & ((state_q == RdR1) ? ~split_q : (state_q == RdR2));
`endif

  logic r_beat_accept;
  assign r_beat_accept = rvalid_i & rready_o;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      state_q <= RdIdle;
    end else begin
      unique case (state_q)
        RdIdle: if (req_accept) state_q <= RdAr1;
        RdAr1:  if (arvalid_o & arready_i) state_q <= RdR1;
        RdR1: begin
          if (r_beat_accept & rlast_i) state_q <= split_q ? RdAr2 : RdIdle;
        end
        RdAr2:  if (arvalid_o & arready_i) state_q <= RdR2;
        RdR2: begin
          if (r_beat_accept & rlast_i) state_q <= RdIdle;
        end
        default: state_q <= RdIdle;
      endcase
    end
  end

endmodule
