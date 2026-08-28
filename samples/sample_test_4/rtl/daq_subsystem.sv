// Top-level wiring: instantiates every block from phases 1-5 and connects
// them per PLAN.md's own architecture diagram (reg_clk/axil_slave/daq_csr ->
// dma_sched <- chan_top[0..NumCh-1] -> desc_fetch -> axi_rd_master -> AXI4,
// dma_sched -> axi_wr_master -> AXI4, perf_cnt/irq_ctrl fed from all of the
// above).
//
// One clock domain for CSR+DMA, not the plan's original three
// -----------------------------------------------------------------------
// PLAN.md's original architecture sketch has `reg_clk` (axil_slave/daq_csr)
// as a THIRD clock domain, separate from `axi_clk` (the DMA engine), with an
// explicit CDC boundary between them. That is not what got built: daq_csr.sv
// and axil_slave.sv (phase 2, already verified and committed) each take a
// single `clk_i` with no CDC awareness anywhere in their own interfaces -
// daq_csr's write-commit logic reads ch_busy_i/ch_cause_i/etc. as plain
// same-cycle combinational inputs, which would be a genuine metastability
// hazard if those inputs actually crossed a real asynchronous boundary.
// Retrofitting a real reg_clk/axi_clk CDC boundary now would mean re-opening
// two already-verified, committed modules to add synchronizers neither was
// designed around, for a boundary this project's own concrete implementation
// never actually needed: a real DAQ card's register interface and its DMA
// engine are routinely driven from the same PLL output in practice. This
// subsystem ties reg_clk and axi_clk together as one `clk_i`, matching what
// daq_csr.sv was actually built against. The one crossing this design
// genuinely has - each channel's own asynchronous `src_clk_i[c]` - is
// unaffected by this decision and is exactly where chan_top.sv already puts
// its own prim_fifo_async + prim_rst_sync (per the plan's own "No ad-hoc
// crossings" rule). See RESULTS.md's phase 5 section for the full CDC audit
// writeup this decision is part of.
//
// Two register-map outputs still have no consumer - a documented gap, not
// an oversight
// -----------------------------------------------------------------------
// GLOBAL_CTRL/AXI_CFG (daq_csr.sv, phase 2) expose `err_inject_o` and
// `axi_max_burst_o`/`axi_outstanding_o` as read/write registers, but no
// fault-injection hook or runtime-configurable burst/outstanding limit
// exists anywhere in the RTL built through phase 4 - axi_rd_master.sv/
// axi_wr_master.sv both split bursts against `daq_pkg::MaxBurst`, a
// compile-time constant, not a register. Making either real would mean
// changing the interface of already-verified, committed modules, which is
// out of scope for a wiring-only phase. Left genuinely unconnected here
// (like `wdepth_o`/`rdepth_o` on chan_top.sv's own CDC FIFO), the same
// documented-gap treatment CH_ECC_STATUS already has in perf_cnt.sv.
//
// GLOBAL_CTRL's global_enable_o gates every channel's own CH_CTRL enable
// bit (AND, not OR) - a channel only actually runs when both its own enable
// and the global one are set, the natural reading of "global" as a master
// switch. soft_rst_pulse_o becomes a one-cycle assertion of a second,
// derived reset (`ctrl_rst_n`) covering every DMA-side block (chan_top,
// dma_sched, desc_fetch, both AXI masters, wr_track, irq_ctrl, perf_cnt) -
// NOT axil_slave/daq_csr, which stay on the plain synced power-on reset so
// software can still read GLOBAL_STATUS/CH_* registers immediately after
// triggering a soft reset instead of losing its own configuration along
// with the datapath it just reset.

module daq_subsystem
  import daq_pkg::*;
  import axi_pkg::*;
(
  input  logic                 clk_i,
  input  logic                  rst_ni,       // one async reset in, for every domain

  // per-channel source clocks - each genuinely independent, asynchronous to
  // clk_i and to each other
  input  logic [NumCh-1:0]        src_clk_i,

  // per-channel source stream in (src_clk_i[c] domain)
  input  logic [NumCh-1:0]          src_valid_i,
  output logic [NumCh-1:0]          src_ready_o,
  input  logic [SrcDw-1:0]          src_data_i [NumCh],
  input  logic [NumCh-1:0]          src_sop_i,
  input  logic [NumCh-1:0]          src_eop_i,
  input  logic [31:0]               src_crc_i  [NumCh],

  // AXI4-Lite slave port (CSR)
  input  logic [AxilAw-1:0]           s_axil_awaddr_i,
  input  logic                         s_axil_awvalid_i,
  output logic                         s_axil_awready_o,
  input  logic [AxilDw-1:0]            s_axil_wdata_i,
  input  logic [(AxilDw/8)-1:0]        s_axil_wstrb_i,
  input  logic                         s_axil_wvalid_i,
  output logic                         s_axil_wready_o,
  output logic [1:0]                   s_axil_bresp_o,
  output logic                         s_axil_bvalid_o,
  input  logic                         s_axil_bready_i,
  input  logic [AxilAw-1:0]            s_axil_araddr_i,
  input  logic                         s_axil_arvalid_i,
  output logic                         s_axil_arready_o,
  output logic [AxilDw-1:0]            s_axil_rdata_o,
  output logic [1:0]                   s_axil_rresp_o,
  output logic                         s_axil_rvalid_o,
  input  logic                         s_axil_rready_i,

  // AXI4 read master port
  output logic                          m_axi_arvalid_o,
  input  logic                           m_axi_arready_i,
  output logic [31:0]                    m_axi_araddr_o,
  output logic [7:0]                     m_axi_arlen_o,
  output logic [2:0]                     m_axi_arsize_o,
  output logic [1:0]                     m_axi_arburst_o,
  output logic [AxiIdw-1:0]              m_axi_arid_o,
  output logic [3:0]                     m_axi_arcache_o,
  output prot_t                          m_axi_arprot_o,
  input  logic                            m_axi_rvalid_i,
  output logic                            m_axi_rready_o,
  input  logic [AxiDw-1:0]                m_axi_rdata_i,
  input  logic [1:0]                      m_axi_rresp_i,
  input  logic                            m_axi_rlast_i,
  input  logic [AxiIdw-1:0]               m_axi_rid_i,

  // AXI4 write master port
  output logic                             m_axi_awvalid_o,
  input  logic                              m_axi_awready_i,
  output logic [31:0]                       m_axi_awaddr_o,
  output logic [7:0]                        m_axi_awlen_o,
  output logic [2:0]                        m_axi_awsize_o,
  output logic [1:0]                        m_axi_awburst_o,
  output logic [AxiIdw-1:0]                 m_axi_awid_o,
  output logic [3:0]                        m_axi_awcache_o,
  output prot_t                             m_axi_awprot_o,
  output logic                              m_axi_wvalid_o,
  input  logic                               m_axi_wready_i,
  output logic [AxiDw-1:0]                   m_axi_wdata_o,
  output logic [AxiBw-1:0]                   m_axi_wstrb_o,
  output logic                               m_axi_wlast_o,
  input  logic                               m_axi_bvalid_i,
  output logic                               m_axi_bready_o,
  input  logic [1:0]                         m_axi_bresp_i,
  input  logic [AxiIdw-1:0]                  m_axi_bid_i,

  output logic                                irq_o
);

  // ---- reset tree ------------------------------------------------------------

  logic rst_n_sync;   // clk_i-synchronized power-on reset - axil_slave/daq_csr live here
  logic ctrl_rst_n;    // rst_n_sync, further gated low for one cycle by soft_rst

  prim_rst_sync #(.ActiveHigh(1'b0), .SkipScan(1'b1)) u_rst_sync_ctrl (
    .clk_i       (clk_i),
    .d_i         (rst_ni),
    .q_o         (rst_n_sync),
    .scan_rst_ni (1'b1),
    .scanmode_i  (prim_mubi_pkg::MuBi4False)
  );

  logic soft_rst_pulse;
  assign ctrl_rst_n = rst_n_sync & ~soft_rst_pulse;

  // ---- regbus between axil_slave and daq_csr ----------------------------------

  logic                   reg_valid, reg_write;
  logic [AxilAw-1:0]      reg_addr;
  logic [AxilDw-1:0]      reg_wdata;
  logic [(AxilDw/8)-1:0]  reg_wstrb;
  logic [AxilDw-1:0]      reg_rdata;
  logic                   reg_error;

  axil_slave u_axil_slave (
    .clk_i (clk_i), .rst_ni (rst_n_sync),
    .awaddr_i (s_axil_awaddr_i), .awvalid_i (s_axil_awvalid_i), .awready_o (s_axil_awready_o),
    .wdata_i (s_axil_wdata_i), .wstrb_i (s_axil_wstrb_i),
    .wvalid_i (s_axil_wvalid_i), .wready_o (s_axil_wready_o),
    .bresp_o (s_axil_bresp_o), .bvalid_o (s_axil_bvalid_o), .bready_i (s_axil_bready_i),
    .araddr_i (s_axil_araddr_i), .arvalid_i (s_axil_arvalid_i), .arready_o (s_axil_arready_o),
    .rdata_o (s_axil_rdata_o), .rresp_o (s_axil_rresp_o),
    .rvalid_o (s_axil_rvalid_o), .rready_i (s_axil_rready_i),
    .reg_valid_o (reg_valid), .reg_write_o (reg_write), .reg_addr_o (reg_addr),
    .reg_wdata_o (reg_wdata), .reg_wstrb_o (reg_wstrb),
    .reg_rdata_i (reg_rdata), .reg_error_i (reg_error)
  );

  // ---- per-channel signal fan-out/fan-in --------------------------------------

  logic [NumCh-1:0] ch_beat_valid, ch_beat_ready, ch_beat_sop, ch_beat_eop;
  logic [AxiDw-1:0] ch_beat_data [NumCh];
  logic [AxiBw-1:0] ch_beat_strb [NumCh];

  logic [NumCh-1:0]       ch_stream_busy, ch_stream_err;
  logic [NumIrqCause-1:0] ch_stream_cause [NumCh];

  logic [NumCh-1:0] ch_enable, ch_abort;
  logic [NumCh-1:0] ch_enable_gated;
  logic [31:0]      ch_desc_base [NumCh];
  logic [NumCh-1:0] ch_desc_go;

  logic [NumCh-1:0] ch_desc_valid;
  logic [31:0]      ch_desc_addr   [NumCh];
  logic [31:0]      ch_desc_maxlen [NumCh];
  logic [NumCh-1:0] ch_fetch_err;
  logic [NumCh-1:0] ch_wr_err;

  // desc_fetch/wr_track's detailed err_e code has no CSR register to land in
  // - the register map only exposes a single per-channel error bit
  // (CH_STATUS) plus the 4-bit IRQ cause vector, neither of which carries
  // the specific err_e value. Captured here only so each instance's
  // ch_err_code_o port has somewhere to connect; genuinely unread otherwise.
  /* verilator lint_off UNUSEDSIGNAL */
  err_e ch_fetch_err_code [NumCh];
  err_e ch_wr_err_code    [NumCh];
  /* verilator lint_on UNUSEDSIGNAL */

  logic global_enable;
  assign ch_enable_gated = ch_enable & {NumCh{global_enable}};

  for (genvar c = 0; c < NumCh; c++) begin : gen_chan

    chan_top u_chan_top (
      .src_clk_i    (src_clk_i[c]),
      .axi_clk_i    (clk_i),
      .rst_ni       (ctrl_rst_n),
      .src_valid_i  (src_valid_i[c]),
      .src_ready_o  (src_ready_o[c]),
      .src_data_i   (src_data_i[c]),
      .src_sop_i    (src_sop_i[c]),
      .src_eop_i    (src_eop_i[c]),
      .src_crc_i    (src_crc_i[c]),
      .ch_enable_i  (ch_enable_gated[c]),
      .ch_abort_i   (ch_abort[c]),
      .beat_valid_o (ch_beat_valid[c]),
      .beat_ready_i (ch_beat_ready[c]),
      .beat_data_o  (ch_beat_data[c]),
      .beat_strb_o  (ch_beat_strb[c]),
      .beat_sop_o   (ch_beat_sop[c]),
      .beat_eop_o   (ch_beat_eop[c]),
      .ch_busy_o    (ch_stream_busy[c]),
      .ch_err_o     (ch_stream_err[c]),
      .ch_cause_o   (ch_stream_cause[c])
    );

  end

  // ---- dma_sched: arbitrate all channels' beat streams onto one -------------

  logic                 sched_out_valid, sched_out_ready;
  logic [AxiDw-1:0]      sched_out_data;
  logic [AxiBw-1:0]      sched_out_strb;
  logic                  sched_out_sop, sched_out_eop;
  logic [ChIdxW-1:0]     sched_out_ch;

  dma_sched u_dma_sched (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .ch_valid_i (ch_beat_valid), .ch_ready_o (ch_beat_ready),
    .ch_data_i  (ch_beat_data),  .ch_strb_i  (ch_beat_strb),
    .ch_sop_i   (ch_beat_sop),   .ch_eop_i   (ch_beat_eop),
    .out_valid_o (sched_out_valid), .out_ready_i (sched_out_ready),
    .out_data_o  (sched_out_data),  .out_strb_o  (sched_out_strb),
    .out_sop_o   (sched_out_sop),   .out_eop_o   (sched_out_eop),
    .out_ch_o    (sched_out_ch)
  );

  // ---- desc_fetch <-> axi_rd_master request/response protocol ---------------

  logic        rd_req_valid, rd_req_ready;
  logic [31:0] rd_req_addr;
  logic        rd_resp_valid, rd_resp_ready;
  logic [AxiDw-1:0] rd_resp_data;
  logic        rd_resp_last, rd_resp_err;

  logic              xfer_done;
  logic [ChIdxW-1:0] xfer_done_ch;

  desc_fetch u_desc_fetch (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .ch_enable_i    (ch_enable_gated),
    .ch_abort_i     (ch_abort),
    .ch_desc_base_i (ch_desc_base),
    .ch_desc_go_i   (ch_desc_go),
    .xfer_done_i    (xfer_done),
    .xfer_done_ch_i (xfer_done_ch),
    .rd_req_valid_o (rd_req_valid), .rd_req_ready_i (rd_req_ready),
    .rd_req_addr_o  (rd_req_addr),
    .rd_resp_valid_i (rd_resp_valid), .rd_resp_ready_o (rd_resp_ready),
    .rd_resp_data_i  (rd_resp_data),  .rd_resp_last_i  (rd_resp_last),
    .rd_resp_err_i   (rd_resp_err),
    .ch_desc_valid_o   (ch_desc_valid),
    .ch_desc_addr_o    (ch_desc_addr),
    .ch_desc_maxlen_o  (ch_desc_maxlen),
    .ch_err_o          (ch_fetch_err),
    .ch_err_code_o     (ch_fetch_err_code)
  );

  axi_rd_master u_axi_rd_master (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .rd_req_valid_i (rd_req_valid), .rd_req_ready_o (rd_req_ready),
    .rd_req_addr_i  (rd_req_addr),
    .rd_resp_valid_o (rd_resp_valid), .rd_resp_ready_i (rd_resp_ready),
    .rd_resp_data_o  (rd_resp_data),  .rd_resp_last_o  (rd_resp_last),
    .rd_resp_err_o   (rd_resp_err),
    .arvalid_o (m_axi_arvalid_o), .arready_i (m_axi_arready_i),
    .araddr_o  (m_axi_araddr_o),  .arlen_o   (m_axi_arlen_o),
    .arsize_o  (m_axi_arsize_o),  .arburst_o (m_axi_arburst_o),
    .arid_o    (m_axi_arid_o),    .arcache_o (m_axi_arcache_o), .arprot_o (m_axi_arprot_o),
    .rvalid_i (m_axi_rvalid_i), .rready_o (m_axi_rready_o),
    .rdata_i  (m_axi_rdata_i),  .rresp_i  (m_axi_rresp_i),
    .rlast_i  (m_axi_rlast_i),  .rid_i    (m_axi_rid_i)
  );

  // ---- axi_wr_master <- dma_sched's merged stream, -> wr_track ----------------

  logic              burst_done_valid, burst_done_err, burst_done_last;
  logic [ChIdxW-1:0] burst_done_ch;

  axi_wr_master u_axi_wr_master (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .wr_valid_i (sched_out_valid), .wr_ready_o (sched_out_ready),
    .wr_data_i  (sched_out_data),  .wr_strb_i  (sched_out_strb),
    .wr_sop_i   (sched_out_sop),   .wr_eop_i   (sched_out_eop),
    .wr_ch_i    (sched_out_ch),
    .ch_desc_addr_i   (ch_desc_addr),
    .ch_desc_maxlen_i (ch_desc_maxlen),
    .burst_done_valid_o (burst_done_valid), .burst_done_ch_o (burst_done_ch),
    .burst_done_err_o   (burst_done_err),   .burst_done_last_o (burst_done_last),
    .awvalid_o (m_axi_awvalid_o), .awready_i (m_axi_awready_i),
    .awaddr_o  (m_axi_awaddr_o),  .awlen_o   (m_axi_awlen_o),
    .awsize_o  (m_axi_awsize_o),  .awburst_o (m_axi_awburst_o),
    .awid_o    (m_axi_awid_o),    .awcache_o (m_axi_awcache_o), .awprot_o (m_axi_awprot_o),
    .wvalid_o (m_axi_wvalid_o), .wready_i (m_axi_wready_i),
    .wdata_o  (m_axi_wdata_o),  .wstrb_o  (m_axi_wstrb_o), .wlast_o (m_axi_wlast_o),
    .bvalid_i (m_axi_bvalid_i), .bready_o (m_axi_bready_o),
    .bresp_i  (m_axi_bresp_i),  .bid_i    (m_axi_bid_i)
  );

  wr_track u_wr_track (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .ch_abort_i (ch_abort),
    .burst_done_valid_i (burst_done_valid), .burst_done_ch_i (burst_done_ch),
    .burst_done_err_i   (burst_done_err),   .burst_done_last_i (burst_done_last),
    .xfer_done_o (xfer_done), .xfer_done_ch_o (xfer_done_ch),
    .ch_err_o (ch_wr_err), .ch_err_code_o (ch_wr_err_code)
  );

  // ---- irq_ctrl: reconcile stream/fetch/write status into daq_csr's shape ----

  logic [NumCh-1:0]       ch_busy, ch_err;
  logic [NumIrqCause-1:0] ch_cause [NumCh];
  logic                   dma_busy;

  irq_ctrl u_irq_ctrl (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .stream_busy_i (ch_stream_busy), .stream_err_i (ch_stream_err),
    .stream_cause_i (ch_stream_cause),
    .desc_valid_i (ch_desc_valid), .fetch_err_i (ch_fetch_err),
    .wr_err_i (ch_wr_err),
    .xfer_done_i (xfer_done), .xfer_done_ch_i (xfer_done_ch),
    .ch_busy_o (ch_busy), .ch_err_o (ch_err), .ch_cause_o (ch_cause),
    .dma_busy_o (dma_busy)
  );

  // ---- perf_cnt: per-channel activity counters, same tap point as dma_sched --

  logic [31:0] ch_byte_cnt   [NumCh];
  logic [31:0] ch_pkt_cnt    [NumCh];
  logic [31:0] ch_err_cnt    [NumCh];
  logic [31:0] ch_stall_cnt  [NumCh];
  logic [31:0] ch_crc_status [NumCh];
  logic [31:0] ch_ecc_status [NumCh];

  perf_cnt u_perf_cnt (
    .clk_i (clk_i), .rst_ni (ctrl_rst_n),
    .ch_abort_i (ch_abort),
    .beat_valid_i (ch_beat_valid), .beat_ready_i (ch_beat_ready),
    .beat_strb_i  (ch_beat_strb),  .beat_eop_i   (ch_beat_eop),
    .ch_cause_i (ch_cause),
    .ch_byte_cnt_o (ch_byte_cnt), .ch_pkt_cnt_o (ch_pkt_cnt),
    .ch_err_cnt_o (ch_err_cnt), .ch_stall_cnt_o (ch_stall_cnt),
    .ch_crc_status_o (ch_crc_status), .ch_ecc_status_o (ch_ecc_status)
  );

  // ---- daq_csr: the register file itself --------------------------------------

  /* verilator lint_off PINCONNECTEMPTY */
  daq_csr u_daq_csr (
    .clk_i (clk_i), .rst_ni (rst_n_sync),
    .reg_valid_i (reg_valid), .reg_write_i (reg_write), .reg_addr_i (reg_addr),
    .reg_wdata_i (reg_wdata), .reg_wstrb_i (reg_wstrb),
    .reg_rdata_o (reg_rdata), .reg_error_o (reg_error),
    .global_enable_o (global_enable),
    .soft_rst_pulse_o (soft_rst_pulse),
    .err_inject_o (),          // no fault-injection hooks exist yet - see header
    .axi_max_burst_o (),       // both AXI masters use daq_pkg::MaxBurst instead - see header
    .axi_outstanding_o (),
    .ch_busy_i (ch_busy),
    .dma_busy_i (dma_busy),
    .irq_o (irq_o),
    .ch_enable_o (ch_enable),
    .ch_abort_o  (ch_abort),
    .ch_desc_base_o (ch_desc_base),
    .ch_desc_go_o   (ch_desc_go),
    .ch_err_i   (ch_err),
    .ch_cause_i (ch_cause),
    .ch_byte_cnt_i   (ch_byte_cnt),
    .ch_pkt_cnt_i    (ch_pkt_cnt),
    .ch_err_cnt_i    (ch_err_cnt),
    .ch_stall_cnt_i  (ch_stall_cnt),
    .ch_crc_status_i (ch_crc_status),
    .ch_ecc_status_i (ch_ecc_status)
  );
  /* verilator lint_on PINCONNECTEMPTY */

endmodule
