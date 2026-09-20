// Shared per-channel ADC calibration/linearity-correction lookup table,
// backed by exactly one SRAM22 4KB macro (1024 x 32-bit, single port) -
// the concrete answer to "what is the catalogued SRAM macro actually for"
// (see analog/README.md's 2026-09-20 memory-selection entry for the macro
// itself; this is the RTL that gives it a job).
//
// Why a LUT, and why this depth
// -----------------------------------------------------------------------
// sar_adc_ch.sv's own header flagged adc_trim_i/calibration as "a CSR-
// backed register, most likely, out of scope here" when it was written -
// a handful of per-channel trim registers would have been the obvious
// choice, but SAR ADCs have systematic INL/DNL nonlinearity that a single
// per-channel trim constant cannot correct; a piecewise correction table
// indexed by the upper bits of the raw code can. Splitting the SRAM's
// 1024 words across NumCh=8 channels gives EntriesPerCh=128 - i.e. the top
// 7 bits of a 12-bit code (code[11:5]) select a correction entry, and the
// bottom 5 bits are corrected by that entry's assumed-locally-linear
// slope/offset. That 8x128 split is not a coincidence forced to fit; it is
// what actually decided EntriesPerCh once NumCh and the macro's own fixed
// 1024-word depth were both already fixed by earlier decisions.
//
// Single port, so read and write are mutually exclusive every cycle
// -----------------------------------------------------------------------
// The real SRAM22 macro this models has one port. Calibration writes
// (software loading/updating the table, rare - expected once at bring-up,
// maybe occasionally after a recalibration routine) always win arbitration
// over channel reads (frequent - up to once per conversion, every channel)
// when both want the port the same cycle: rare-and-latency-tolerant should
// yield to itself, not the other way around, and a write is a single
// isolated event, never a sustained multi-cycle burst that could actually
// starve reads. Channel reads arbitrate against each other with
// prim_arbiter_tree (this project's third use of it, after dma_sched.sv
// and desc_fetch.sv) - genuine round-robin fairness matters here, since
// every channel's own conversion is stalled waiting on its own lookup.
//
// Read latency is registered (one cycle from grant to data), matching how
// a real single-port SRAM macro actually behaves - not modeled as a
// same-cycle combinational read, which no real SRAM macro provides.

module adc_cal_lut #(
  parameter int unsigned NumCh         = 8,
  parameter int unsigned EntriesPerCh  = 128,
  parameter int unsigned DataWidth     = 32,

  // Derived, not independently settable - declared here (inside the
  // parameter port list, not the module body) specifically so the ANSI
  // port declarations below can use them without a forward-reference.
  // AddrW is ChIdxW+IdxW, not $clog2(NumCh*EntriesPerCh) computed
  // independently: {arb_idx, rd_idx_i[...]}'s actual concatenated width is
  // ChIdxW+IdxW, and ChIdxW is guarded to at least 1 bit even at NumCh==1
  // (matching every other module's ChIdxW convention in this project),
  // where $clog2(NumCh*EntriesPerCh) alone would compute 0 extra bits for
  // it - the two must stay in lockstep or the address concat truncates.
  // The real target (NumCh=8, a power of 2) makes AddrW exactly
  // $clog2(1024)=10 either way; only the sweep's NumCh=1 case differs.
  localparam int unsigned IdxW       = $clog2(EntriesPerCh),
  localparam int unsigned ChIdxW     = (NumCh > 1) ? $clog2(NumCh) : 1,
  localparam int unsigned AddrW      = ChIdxW + IdxW
) (
  input  logic clk_i,
  input  logic rst_ni,

  // ---- per-channel read port --------------------------------------------------
  // Level request, held until rd_gnt_o pulses for that channel - the same
  // "stays high until granted" convention prim_arbiter_tree's own req_i
  // assumes, and dma_sched.sv/desc_fetch.sv's own request ports already use.
  input  logic [NumCh-1:0]                     rd_req_i,
  output logic [NumCh-1:0]                     rd_gnt_o,
  input  logic [IdxW-1:0]                      rd_idx_i [NumCh],

  output logic                                  rd_data_valid_o,
  output logic [ChIdxW-1:0]                     rd_data_ch_o,
  output logic [DataWidth-1:0]                  rd_data_o,

  // ---- CSR write port (software loads/updates the table) ---------------------
  input  logic                     cal_wr_valid_i,
  output logic                     cal_wr_ready_o,
  input  logic [ChIdxW-1:0]        cal_wr_ch_i,
  input  logic [IdxW-1:0]          cal_wr_idx_i,
  input  logic [DataWidth-1:0]     cal_wr_data_i
);

  // Sized to 2**AddrW, not NumEntries directly: they only coincide when
  // NumCh is itself a power of 2 (true for the real target, NumCh=8, and
  // for NumCh=2). At NumCh=1, ChIdxW's own always->=1-bit guard (matching
  // every other module's ChIdxW convention) makes AddrW one bit wider than
  // $clog2(NumEntries) alone would be - sizing the array by the address
  // width it is actually indexed with, not the entry count, is what keeps
  // that combination safe rather than merely quiet.
  logic [DataWidth-1:0] mem [2**AddrW];

  // ---- write path: always wins when requested ---------------------------------
  assign cal_wr_ready_o = 1'b1;  // a write never has to wait for anything else

  logic wr_fire;
  assign wr_fire = cal_wr_valid_i & cal_wr_ready_o;

  // ---- read arbitration: round-robin across channels, gated off during a write -
  logic [NumCh-1:0] rd_req_gated;
  assign rd_req_gated = wr_fire ? '0 : rd_req_i;

  logic [ChIdxW-1:0] arb_idx;
  logic              arb_valid;

  // Same NumCh==1 zero-width-port workaround dma_sched.sv/desc_fetch.sv use
  // for the same reason (prim_arbiter_tree's idx_o has no N==1 guard).
  if (NumCh > 1) begin : gen_arb
    prim_arbiter_tree #(
      .N          (NumCh),
      .DW         (1),
      .EnDataPort (0)
    ) u_arb (
      .clk_i,
      .rst_ni,
      .req_chk_i (1'b1),
      .req_i     (rd_req_gated),
      .data_i    ('{default: 1'b0}),
      /* verilator lint_off PINCONNECTEMPTY */
      .gnt_o     (),
      .data_o    (),
      /* verilator lint_on PINCONNECTEMPTY */
      .idx_o     (arb_idx),
      .valid_o   (arb_valid),
      .ready_i   (1'b1)
    );
  end else begin : gen_no_arb
    assign arb_idx   = '0;
    assign arb_valid = rd_req_gated[0];
  end

  always_comb begin
    rd_gnt_o = '0;
    if (arb_valid) rd_gnt_o[arb_idx] = 1'b1;
  end

  logic [AddrW-1:0] rd_addr, wr_addr;
  assign rd_addr = {arb_idx, rd_idx_i[arb_idx]};
  assign wr_addr = {cal_wr_ch_i, cal_wr_idx_i};

  always_ff @(posedge clk_i) begin
    if (wr_fire) begin
      mem[wr_addr] <= cal_wr_data_i;
    end else if (arb_valid) begin
      rd_data_o <= mem[rd_addr];
    end
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      rd_data_valid_o <= 1'b0;
      rd_data_ch_o    <= '0;
    end else begin
      rd_data_valid_o <= arb_valid;
      rd_data_ch_o    <= arb_idx;
    end
  end

endmodule
