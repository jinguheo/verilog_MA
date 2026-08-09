// Elaboration gate for the prim reuse decision.
//
// The Sample Test 4 plan originally called for hand-writing an rtl/common
// layer of eleven modules. Nine of them already exist, verified, in the
// OpenTitan prim library that Sample Test 2 is already building against. This
// module instantiates each reused primitive at the widths Sample Test 4 will
// actually use, so that "we are reusing prim" is a thing the build proves
// rather than a thing the plan asserts.
//
// It is not a design module and nothing instantiates it. If a later phase
// stops using one of these primitives, delete the instance here too - a stale
// instance would keep passing and hide the fact that the mapping changed.
//
//   plan module            reused primitive
//   ---------------------  -------------------------------------
//   async_fifo.sv          prim_fifo_async
//   sync_fifo.sv           prim_fifo_sync        (already in Sample Test 2)
//   arb_rr.sv              prim_arbiter_tree
//   crc32.sv               prim_crc32
//   cdc_pulse.sv           prim_pulse_sync
//   cdc_data_handshake.sv  prim_sync_reqack_data
//   ecc_secded.sv          prim_secded_39_32_enc / _dec
//   reset_sync.sv          prim_rst_sync
//   sync_2ff.sv            prim_flop_2sync
//
//   skid_buffer.sv         no prim equivalent -> rtl/common/skid_buffer.sv
//   cnt_sat.sv             no suitable prim   -> rtl/common/cnt_sat.sv

module prim_reuse_smoke
  import daq_pkg::*;
(
  input  logic              clk_i,
  input  logic              rst_ni,
  input  logic              clk_src_i,
  input  logic              rst_src_ni,

  // async_fifo / sync_fifo
  input  logic              wvalid_i,
  output logic              wready_o,
  input  logic [AxiDw-1:0]  wdata_i,
  output logic              rvalid_o,
  input  logic              rready_i,
  output logic [AxiDw-1:0]  rdata_o,
  output logic              sf_rvalid_o,
  output logic [AxiDw-1:0]  sf_rdata_o,

  // arb_rr
  input  logic [NumCh-1:0]  req_i,
  output logic [NumCh-1:0]  gnt_o,
  output logic              arb_valid_o,
  input  logic              arb_ready_i,

  // crc32
  input  logic              crc_valid_i,
  output logic [31:0]       crc_o,

  // cdc_pulse
  input  logic              pulse_i,
  output logic              pulse_o,

  // cdc_data_handshake
  input  logic              hs_req_i,
  output logic              hs_ack_o,
  output logic              hs_dreq_o,
  input  logic              hs_dack_i,
  input  logic [31:0]       hs_data_i,
  output logic [31:0]       hs_data_o,

  // ecc_secded
  input  logic [31:0]       ecc_data_i,
  output logic [31:0]       ecc_data_o,
  output logic [1:0]        ecc_err_o,

  // reset_sync / sync_2ff
  output logic              rst_sync_o,
  input  logic [7:0]        sync_d_i,
  output logic [7:0]        sync_q_o,

  // the two locally written modules, at the same widths
  input  logic              skid_valid_i,
  output logic              skid_ready_o,
  output logic              skid_valid_o,
  input  logic              skid_ready_i,
  output logic [AxiDw-1:0]  skid_data_o,
  input  logic              cnt_incr_en_i,
  input  logic [$clog2(AxiBw+1)-1:0] cnt_incr_i,
  output logic [31:0]       cnt_o,
  output logic              cnt_sat_o
);

  // ---- async_fifo.sv -> prim_fifo_async ------------------------------------
  prim_fifo_async #(
    .Width (AxiDw),
    .Depth (ChFifoDepth)
  ) u_fifo_async (
    .clk_wr_i  (clk_src_i),
    .rst_wr_ni (rst_src_ni),
    .wvalid_i  (wvalid_i),
    .wready_o  (wready_o),
    .wdata_i   (wdata_i),
    .wdepth_o  (),
    .clk_rd_i  (clk_i),
    .rst_rd_ni (rst_ni),
    .rvalid_o  (rvalid_o),
    .rready_i  (rready_i),
    .rdata_o   (rdata_o),
    .rdepth_o  ()
  );

  // ---- sync_fifo.sv -> prim_fifo_sync --------------------------------------
  prim_fifo_sync #(
    .Width   (AxiDw),
    .Pass    (1'b0),
    .Depth   (ChFifoDepth),
    .OutputZeroIfEmpty (1'b0)
  ) u_fifo_sync (
    .clk_i,
    .rst_ni,
    .clr_i    (1'b0),
    .wvalid_i (wvalid_i),
    .wready_o (),
    .wdata_i  (wdata_i),
    .rvalid_o (sf_rvalid_o),
    .rready_i (rready_i),
    .rdata_o  (sf_rdata_o),
    .full_o   (),
    .depth_o  (),
    .err_o    ()
  );

  // ---- arb_rr.sv -> prim_arbiter_tree (round robin) ------------------------
  // EnDataPort is 0: the scheduler arbitrates grants, the payload does not
  // travel through the arbiter. data_i must still be connected.
  logic [0:0] arb_data [NumCh];
  always_comb begin
    for (int unsigned i = 0; i < NumCh; i++) arb_data[i] = 1'b0;
  end

  prim_arbiter_tree #(
    .N          (NumCh),
    .DW         (1),
    .EnDataPort (0)
  ) u_arb_rr (
    .clk_i,
    .rst_ni,
    .req_chk_i (1'b1),
    .req_i     (req_i),
    .data_i    (arb_data),
    .gnt_o     (gnt_o),
    .idx_o     (),
    .valid_o   (arb_valid_o),
    .data_o    (),
    .ready_i   (arb_ready_i)
  );

  // ---- crc32.sv -> prim_crc32 ----------------------------------------------
  prim_crc32 #(
    .BytesPerWord (AxiBw)
  ) u_crc32 (
    .clk_i,
    .rst_ni,
    .set_crc_i    (1'b0),
    .crc_in_i     (32'h0),
    .data_valid_i (crc_valid_i),
    .data_i       (wdata_i),
    .crc_out_o    (crc_o)
  );

  // ---- cdc_pulse.sv -> prim_pulse_sync -------------------------------------
  prim_pulse_sync u_cdc_pulse (
    .clk_src_i,
    .rst_src_ni,
    .src_pulse_i (pulse_i),
    .clk_dst_i   (clk_i),
    .rst_dst_ni  (rst_ni),
    .dst_pulse_o (pulse_o)
  );

  // ---- cdc_data_handshake.sv -> prim_sync_reqack_data ----------------------
  prim_sync_reqack_data #(
    .Width       (32),
    .DataSrc2Dst (1'b1)
  ) u_cdc_data (
    .clk_src_i,
    .rst_src_ni,
    .clk_dst_i (clk_i),
    .rst_dst_ni (rst_ni),
    .req_chk_i (1'b1),
    .src_req_i (hs_req_i),
    .src_ack_o (hs_ack_o),
    .dst_req_o (hs_dreq_o),
    .dst_ack_i (hs_dack_i),
    .data_i    (hs_data_i),
    .data_o    (hs_data_o)
  );

  // ---- ecc_secded.sv -> prim_secded_39_32_{enc,dec} ------------------------
  // Scope decision (2026-08-09): ECC covers the channel FIFO payload only. The
  // descriptor path is protected by validation in desc_fetch plus the AXI
  // response, not by ECC - descriptor-path ECC would need the memory model to
  // store check bits, which is a testbench-side contract this design does not
  // define.
  logic [38:0] ecc_word;
  prim_secded_39_32_enc u_ecc_enc (
    .data_i (ecc_data_i),
    .data_o (ecc_word)
  );
  prim_secded_39_32_dec u_ecc_dec (
    .data_i     (ecc_word),
    .data_o     (ecc_data_o),
    .syndrome_o (),
    .err_o      (ecc_err_o)
  );

  // ---- reset_sync.sv -> prim_rst_sync --------------------------------------
  // SkipScan: there is no scan chain in this design, so the scan mux is not
  // instantiated and scan_rst_ni is tied inactive.
  prim_rst_sync #(
    .ActiveHigh (1'b0),
    .SkipScan   (1'b1)
  ) u_rst_sync (
    .clk_i,
    .d_i         (rst_ni),
    .q_o         (rst_sync_o),
    .scan_rst_ni (1'b1),
    .scanmode_i  (prim_mubi_pkg::MuBi4False)
  );

  // ---- sync_2ff.sv -> prim_flop_2sync --------------------------------------
  prim_flop_2sync #(
    .Width (8)
  ) u_sync_2ff (
    .clk_i,
    .rst_ni,
    .d_i (sync_d_i),
    .q_o (sync_q_o)
  );

  // ---- locally written ------------------------------------------------------
  skid_buffer #(
    .Width (AxiDw)
  ) u_skid (
    .clk_i,
    .rst_ni,
    .valid_i (skid_valid_i),
    .ready_o (skid_ready_o),
    .data_i  (wdata_i),
    .valid_o (skid_valid_o),
    .ready_i (skid_ready_i),
    .data_o  (skid_data_o)
  );

  cnt_sat #(
    .Width (32),
    .IncrW ($clog2(AxiBw+1))
  ) u_cnt (
    .clk_i,
    .rst_ni,
    .clear_i     (1'b0),
    .incr_en_i   (cnt_incr_en_i),
    .incr_i      (cnt_incr_i),
    .cnt_o       (cnt_o),
    .saturated_o (cnt_sat_o)
  );

endmodule
