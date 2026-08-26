// Per-channel wrapper: pkt_align (src_clk) -> async CDC FIFO -> pkt_check
// (axi_clk) -> chan_ctrl (axi_clk), plus the reset synchronizers for both
// domains this channel touches.
//
// This is the one place in phase 3 where a clock actually gets crossed, and
// per the plan's "No ad-hoc crossings" rule the crossing lives entirely
// inside one reused prim primitive (prim_fifo_async) with its own
// prim_rst_sync per domain - not hand-rolled synchronization logic. A single
// async rst_ni comes in; each domain's local reset is synchronized here,
// right at the boundary where the crossing itself happens, rather than
// assuming the caller already did it.
//
// The packed-beat layout (daq_pkg::PktBeat*) that pkt_align documents but
// never had a consumer for is exactly what makes this wrapper simple: five
// separate signals (data, strb, sop, eop, crc) pack into one FIFO of that
// width and unpack the same way on the read side, so the CDC FIFO does not
// need five ports times two directions.

module chan_top
  import daq_pkg::*;
(
  input  logic                 src_clk_i,
  input  logic                  axi_clk_i,
  input  logic                   rst_ni,     // one async reset in; synced per domain below

  // src_clk domain: source stream
  input  logic                    src_valid_i,
  output logic                    src_ready_o,
  input  logic [SrcDw-1:0]        src_data_i,
  input  logic                    src_sop_i,
  input  logic                    src_eop_i,
  input  logic [31:0]             src_crc_i,

  // axi_clk domain: control, from the CSR
  input  logic                     ch_enable_i,
  input  logic                     ch_abort_i,

  // axi_clk domain: gated beat out, to phase 4's dma_sched (not built yet)
  output logic                      beat_valid_o,
  input  logic                       beat_ready_i,
  output logic [AxiDw-1:0]           beat_data_o,
  output logic [AxiBw-1:0]           beat_strb_o,
  output logic                       beat_sop_o,
  output logic                       beat_eop_o,

  // axi_clk domain: status, to the CSR
  output logic                        ch_busy_o,
  output logic                        ch_err_o,
  output logic [NumIrqCause-1:0]      ch_cause_o
);

  // ---- per-domain reset sync ------------------------------------------------

  logic src_rst_n, axi_rst_n;

  prim_rst_sync #(.ActiveHigh(1'b0), .SkipScan(1'b1)) u_rst_sync_src (
    .clk_i       (src_clk_i),
    .d_i         (rst_ni),
    .q_o         (src_rst_n),
    .scan_rst_ni (1'b1),
    .scanmode_i  (prim_mubi_pkg::MuBi4False)
  );

  prim_rst_sync #(.ActiveHigh(1'b0), .SkipScan(1'b1)) u_rst_sync_axi (
    .clk_i       (axi_clk_i),
    .d_i         (rst_ni),
    .q_o         (axi_rst_n),
    .scan_rst_ni (1'b1),
    .scanmode_i  (prim_mubi_pkg::MuBi4False)
  );

  // ---- pkt_align (src_clk) --------------------------------------------------

  logic                 align_valid, align_ready;
  logic [AxiDw-1:0]     align_data;
  logic [AxiBw-1:0]     align_strb;
  logic                 align_sop, align_eop;
  logic [31:0]          align_crc;

  pkt_align u_pkt_align (
    .clk_i        (src_clk_i),
    .rst_ni       (src_rst_n),
    .src_valid_i  (src_valid_i),
    .src_ready_o  (src_ready_o),
    .src_data_i   (src_data_i),
    .src_sop_i    (src_sop_i),
    .src_eop_i    (src_eop_i),
    .src_crc_i    (src_crc_i),
    .beat_valid_o (align_valid),
    .beat_ready_i (align_ready),
    .beat_data_o  (align_data),
    .beat_strb_o  (align_strb),
    .beat_sop_o   (align_sop),
    .beat_eop_o   (align_eop),
    .beat_crc_o   (align_crc)
  );

  // ---- async CDC FIFO ---------------------------------------------------------

  logic [PktBeatBits-1:0] fifo_wdata, fifo_rdata;
  assign fifo_wdata[PktBeatDataLsb+:AxiDw] = align_data;
  assign fifo_wdata[PktBeatStrbLsb+:AxiBw] = align_strb;
  assign fifo_wdata[PktBeatCrcLsb+:32]     = align_crc;
  assign fifo_wdata[PktBeatEopBit]         = align_eop;
  assign fifo_wdata[PktBeatSopBit]         = align_sop;

  logic             fifo_rvalid, fifo_rready;
  logic [AxiDw-1:0] fifo_data;
  logic [AxiBw-1:0] fifo_strb;
  logic             fifo_sop, fifo_eop;
  logic [31:0]      fifo_crc;
  assign fifo_data = fifo_rdata[PktBeatDataLsb+:AxiDw];
  assign fifo_strb = fifo_rdata[PktBeatStrbLsb+:AxiBw];
  assign fifo_crc  = fifo_rdata[PktBeatCrcLsb+:32];
  assign fifo_eop  = fifo_rdata[PktBeatEopBit];
  assign fifo_sop  = fifo_rdata[PktBeatSopBit];

  // wdepth_o/rdepth_o (FIFO occupancy) are intentionally unconnected: nothing
  // in phase 3 consumes them. perf_cnt.sv (phase 5) is the plan's stated home
  // for stall/occupancy-derived counters and may want rdepth_o then; wiring
  // it out speculatively now would just be a dangling port nothing drives
  // meaning into yet.
  /* verilator lint_off PINCONNECTEMPTY */
  prim_fifo_async #(
    .Width (PktBeatBits),
    .Depth (ChFifoDepth)
  ) u_cdc_fifo (
    .clk_wr_i  (src_clk_i),
    .rst_wr_ni (src_rst_n),
    .wvalid_i  (align_valid),
    .wready_o  (align_ready),
    .wdata_i   (fifo_wdata),
    .wdepth_o  (),
    .clk_rd_i  (axi_clk_i),
    .rst_rd_ni (axi_rst_n),
    .rvalid_o  (fifo_rvalid),
    .rready_i  (fifo_rready),
    .rdata_o   (fifo_rdata),
    .rdepth_o  ()
  );
  /* verilator lint_on PINCONNECTEMPTY */

  // ---- pkt_check (axi_clk) ---------------------------------------------------

  logic                 check_valid, check_ready;
  logic [AxiDw-1:0]     check_data;
  logic [AxiBw-1:0]     check_strb;
  logic                 check_sop, check_eop;
  logic                 pkt_done, crc_err, len_err;

  pkt_check u_pkt_check (
    .clk_i        (axi_clk_i),
    .rst_ni       (axi_rst_n),
    .beat_valid_i (fifo_rvalid),
    .beat_ready_o (fifo_rready),
    .beat_data_i  (fifo_data),
    .beat_strb_i  (fifo_strb),
    .beat_sop_i   (fifo_sop),
    .beat_eop_i   (fifo_eop),
    .beat_crc_i   (fifo_crc),
    .beat_valid_o (check_valid),
    .beat_ready_i (check_ready),
    .beat_data_o  (check_data),
    .beat_strb_o  (check_strb),
    .beat_sop_o   (check_sop),
    .beat_eop_o   (check_eop),
    .pkt_done_o   (pkt_done),
    .crc_err_o    (crc_err),
    .len_err_o    (len_err)
  );

  // ---- chan_ctrl (axi_clk) ----------------------------------------------------

  chan_ctrl u_chan_ctrl (
    .clk_i        (axi_clk_i),
    .rst_ni       (axi_rst_n),
    .ch_enable_i  (ch_enable_i),
    .ch_abort_i   (ch_abort_i),
    .beat_valid_i (check_valid),
    .beat_ready_o (check_ready),
    .beat_data_i  (check_data),
    .beat_strb_i  (check_strb),
    .beat_sop_i   (check_sop),
    .beat_eop_i   (check_eop),
    .beat_valid_o (beat_valid_o),
    .beat_ready_i (beat_ready_i),
    .beat_data_o  (beat_data_o),
    .beat_strb_o  (beat_strb_o),
    .beat_sop_o   (beat_sop_o),
    .beat_eop_o   (beat_eop_o),
    .pkt_done_i   (pkt_done),
    .crc_err_i    (crc_err),
    .len_err_i    (len_err),
    .ch_busy_o    (ch_busy_o),
    .ch_err_o     (ch_err_o),
    .ch_cause_o   (ch_cause_o)
  );

endmodule
