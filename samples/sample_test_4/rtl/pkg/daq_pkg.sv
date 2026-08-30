// Sample Test 4 parameters, descriptor format, register map and error codes.
//
// Parameter sweep mechanism
// -------------------------
// A SystemVerilog package cannot be parameterised, but the parameter sweep is
// part of the build gate (see scripts/run_lint.ps1), so the widths here are
// selected by compile-time defines. Modules take their own parameters that
// default to these values, so a module can still be instantiated at a
// non-default width inside a block testbench.
//
//   +define+DAQ_NUM_CH=2 +define+DAQ_AXI_DW=32
//
// Descriptor layout (decision settled 2026-08-09)
// -----------------------------------------------
// 128-bit, four 32-bit words, chosen over a wider metadata-carrying format.
// Per-packet metadata can be added later as a second descriptor flavour
// without changing the ring walk, whereas widening the descriptor now would
// bake the wider fetch into desc_fetch before there is anything to put in it.

package daq_pkg;

  import axi_pkg::*;

  // ---------------------------------------------------------------- parameters

`ifdef DAQ_NUM_CH
  localparam int unsigned NumCh = `DAQ_NUM_CH;
`else
  localparam int unsigned NumCh = 8;
`endif

`ifdef DAQ_AXI_DW
  localparam int unsigned AxiDw = `DAQ_AXI_DW;
`else
  localparam int unsigned AxiDw = 64;
`endif

  localparam int unsigned AxiAw   = 32;
  localparam int unsigned AxiIdw  = 4;   // sets outstanding transaction capacity
  localparam int unsigned AxilDw  = 32;
  localparam int unsigned AxilAw  = 16;

  localparam int unsigned ChFifoDepth = 32;  // per-channel async FIFO
  localparam int unsigned MaxBurst    = 16;  // beats per AXI burst before splitting

  localparam int unsigned SrcDw = 8;         // per-channel source stream width

  // Derived
  localparam int unsigned AxiBw    = AxiDw / 8;            // byte enables per beat
  localparam int unsigned ChIdxW   = (NumCh > 1) ? $clog2(NumCh) : 1;
  localparam int unsigned BeatCntW = $clog2(MaxBurst + 1);

  // ------------------------------------------------------------- stream path

  // Sanity ceiling on a single packet's payload length, checked by
  // pkt_check.sv. Distinct from DescMaxLength even though both currently
  // equal 1 MiB: one bounds what a DMA descriptor may claim to move, the
  // other bounds what a single source packet may claim to be - conflating
  // them would make a future change to either limit silently change both.
  localparam int unsigned MaxPacketBytes = 32'h0010_0000;

  // Packed beat layout shared across pkt_align's output, the per-channel
  // async CDC FIFO, and pkt_check's input - one flat bit-offset convention so
  // those three cannot silently disagree about field order. Fields, LSB to
  // MSB: data, strb, crc_expect (valid only when eop), eop, sop.
  //
  // crc_expect rides alongside the data rather than being embedded as
  // trailing bytes in the source stream. A CRC-32 trailer spans multiple
  // bytes; once packed into AxiDw-wide beats those bytes can straddle a beat
  // boundary, which would force pkt_check to buffer and look ahead before it
  // knows which bytes are payload versus trailer. Carrying the expected value
  // out-of-band on the eop beat sidesteps that lookahead entirely, and Sample
  // Test 3's own RTL guidance already calls for exactly this ("carry sop/eop,
  // byte-enable, sequence, expected CRC ... with data; never regenerate
  // boundaries after a stall") - this is that rule applied to a 4-byte
  // trailer instead of the 1-byte one Sample Test 3 had.
  localparam int unsigned PktBeatDataLsb = 0;
  localparam int unsigned PktBeatStrbLsb = AxiDw;
  localparam int unsigned PktBeatCrcLsb  = AxiDw + AxiBw;
  localparam int unsigned PktBeatEopBit  = AxiDw + AxiBw + 32;
  localparam int unsigned PktBeatSopBit  = AxiDw + AxiBw + 33;
  localparam int unsigned PktBeatBits    = AxiDw + AxiBw + 34;

  // Post-check beat layout: the same as PktBeat* minus the crc field, since
  // verification has already happened by the time pkt_check.sv hands a beat
  // onward to chan_ctrl. A separate constant set rather than a slice of
  // PktBeat*, so a field reorder on one side can't silently misalign the
  // other.
  localparam int unsigned PktBeatCleanDataLsb = 0;
  localparam int unsigned PktBeatCleanStrbLsb = AxiDw;
  localparam int unsigned PktBeatCleanEopBit  = AxiDw + AxiBw;
  localparam int unsigned PktBeatCleanSopBit  = AxiDw + AxiBw + 1;
  localparam int unsigned PktBeatCleanBits    = AxiDw + AxiBw + 2;

  // ---------------------------------------------------------------- descriptor

  typedef struct packed {
    logic [15:0] tag;     // [31:16] opaque, echoed into the completion record
    logic [11:0] rsvd;    // [15:4]
    logic        link;    // [3]  follow next_ptr instead of advancing linearly
    logic        last;    // [2]  final descriptor of the ring; halt after it
    logic        irq_en;  // [1]  raise the channel interrupt on completion
    logic        valid;   // [0]  descriptor is owned by hardware
  } desc_ctrl_t;

  typedef struct packed {
    logic [31:0] next_ptr;  // [127:96]
    desc_ctrl_t  ctrl;      // [95:64]
    logic [31:0] length;    // [63:32]  transfer length in bytes
    logic [31:0] addr;      // [31:0]   destination byte address
  } desc_t;

  localparam int unsigned DescBits  = $bits(desc_t);   // 128
  localparam int unsigned DescBytes = DescBits / 8;    // 16

  // A descriptor is rejected before any AXI traffic is issued if it fails any
  // of these. desc_fetch reports the first failure as the channel error code.
  //
  // DescAlignBytes tracks AxiDw (not a fixed 4), settled once axi_rd_master
  // made the tradeoff concrete: a destination `addr`/`length` aligned only
  // to 4 bytes but read/written over a wider AXI bus would force every AXI
  // master to do narrow (sub-bus-width) transfers - byte-lane extraction on
  // the read side, read-modify-write-style strobing on the write side - for
  // what is otherwise an ordinary full-width burst. Requiring bus-width
  // alignment here is the same tradeoff many real DMA engines make for
  // exactly this reason, and is free to make here since the ring's own
  // layout is entirely under software/test control. Ring *pointers*
  // themselves (ch_desc_base_i, a descriptor's own next_ptr) are NOT
  // covered by this - see desc_fetch.sv's header on why they are assumed
  // pre-aligned by convention rather than hardware-validated.
  localparam int unsigned DescAlignBytes = AxiDw / 8;
  localparam int unsigned DescMaxLength  = 32'h0010_0000;  // 1 MiB per descriptor

  // ------------------------------------------------------------- channel state

  typedef enum logic [2:0] {
    ChIdle     = 3'b000,
    ChArmed    = 3'b001,
    ChRunning  = 3'b010,
    ChDraining = 3'b011,
    ChError    = 3'b100
  } ch_state_e;

  // As in Sample Test 3, this encoding is deliberately NOT exposed raw in a
  // CSR. A 3-bit value cannot cross a clock boundary coherently without its own
  // handshake, so CH_STATUS carries derived single-bit flags instead.

  // ------------------------------------------------------------- error codes

  typedef enum logic [3:0] {
    ErrNone        = 4'h0,
    ErrDescAlign   = 4'h1,  // addr or length not DescAlignBytes-aligned
    ErrDescLength  = 4'h2,  // length is zero or above DescMaxLength
    ErrDescInvalid = 4'h3,  // valid bit clear when the engine expected work
    ErrDescFetch   = 4'h4,  // AXI error while reading the descriptor
    ErrAxiWrite    = 4'h5,  // SLVERR/DECERR on the payload write
    ErrCrc         = 4'h6,  // CRC-32 mismatch at end of packet
    ErrFifoOvf     = 4'h7,  // source overran the channel FIFO
    ErrEccUncorr   = 4'h8   // uncorrectable ECC in the channel FIFO
  } err_e;

  // ------------------------------------------------------------- register map

  // Global bank
  localparam logic [AxilAw-1:0] AddrId           = 16'h000;  // RO
  localparam logic [AxilAw-1:0] AddrVersion      = 16'h004;  // RO
  localparam logic [AxilAw-1:0] AddrGlobalCtrl   = 16'h008;  // RW
  localparam logic [AxilAw-1:0] AddrGlobalStatus = 16'h00C;  // RO
  localparam logic [AxilAw-1:0] AddrIrqState     = 16'h010;  // RO, see note below
  localparam logic [AxilAw-1:0] AddrIrqEnable    = 16'h014;  // RW
  localparam logic [AxilAw-1:0] AddrErrInject    = 16'h018;  // RW
  localparam logic [AxilAw-1:0] AddrAxiCfg       = 16'h01C;  // RW

  // Per-channel bank at ChanBase + ch*ChanStride
  localparam logic [AxilAw-1:0] ChanBase   = 16'h100;
  localparam logic [AxilAw-1:0] ChanStride = 16'h040;

  localparam logic [5:0] OffCtrl      = 6'h00;  // RW
  localparam logic [5:0] OffStatus    = 6'h04;  // RO
  localparam logic [5:0] OffDescBase  = 6'h08;  // RW
  localparam logic [5:0] OffDescCtrl  = 6'h0C;  // RW
  localparam logic [5:0] OffIrqState  = 6'h10;  // W1C, per-channel interrupt cause
  localparam logic [5:0] OffIrqEnable = 6'h14;  // RW
  localparam logic [5:0] OffByteCnt   = 6'h18;  // RO
  localparam logic [5:0] OffPktCnt    = 6'h1C;  // RO
  localparam logic [5:0] OffErrCnt    = 6'h20;  // RO
  localparam logic [5:0] OffStallCnt  = 6'h24;  // RO
  localparam logic [5:0] OffCrcStatus = 6'h28;  // RO
  localparam logic [5:0] OffEccStatus = 6'h2C;  // RO

  // IRQ_STATE correction (phase 2, 2026-08-09): the plan's original sketch
  // listed the global IRQ_STATE as W1C, mirroring CH_IRQ_STATE. Implemented
  // that way, clearing the global bit while the per-channel cause it
  // summarises is still set would just have the bit reappear the next cycle,
  // since nothing hardware-side would have changed - a second, redundant
  // latch with no state of its own. IRQ_STATE is RO instead: bit[ch] is a
  // live OR of CH_IRQ_STATE[ch] against that channel's CH_IRQ_ENABLE mask.
  // The actual latch that must be cleared to deassert an interrupt is
  // CH_IRQ_STATE, which keeps its W1C access as originally planned. This
  // is the same set-summary-live/clear-at-the-source split OpenTitan and most
  // interrupt controllers use; the alternative was simpler to plan but wrong
  // to build.

  // Per-channel interrupt causes, valid in CH_IRQ_STATE / CH_IRQ_ENABLE bits
  // [3:0]. A hardware "set" is a one-cycle pulse; software clears with W1C.
  localparam int unsigned IrqCauseDone    = 0;  // descriptor completed
  localparam int unsigned IrqCauseErr     = 1;  // channel entered ChError
  localparam int unsigned IrqCauseCrc     = 2;  // CRC-32 mismatch
  localparam int unsigned IrqCauseFifoOvf = 3;  // source overran the channel FIFO
  localparam int unsigned NumIrqCause     = 4;

  localparam logic [31:0] IdValue = 32'h4441_5134;  // "DAQ4"

  // VERSION reads back the elaborated configuration so software can tell what
  // it is talking to without a separate build manifest.
  localparam logic [31:0] VersionValue = {
    8'd0,                        // [31:24] major
    8'd4,                        // [23:16] minor
    8'(NumCh),                   // [15:8]
    8'(AxiDw)                    // [7:0]
  };

  // ------------------------------------------------------------------ helpers

  // Which channel does this AXI4-Lite address belong to? Valid only when
  // addr_is_chan() is true.
  function automatic int unsigned chan_of_addr(input logic [AxilAw-1:0] addr);
    chan_of_addr = (int'(addr) - int'(ChanBase)) / int'(ChanStride);
  endfunction

  function automatic logic addr_is_chan(input logic [AxilAw-1:0] addr);
    addr_is_chan = (int'(addr) >= int'(ChanBase)) &&
                   (int'(addr) < (int'(ChanBase) + int'(NumCh) * int'(ChanStride)));
  endfunction

  // Descriptor validation, shared by desc_fetch and the DV reference model so
  // the two cannot drift apart.
  // next_ptr is deliberately not validated here: it is only dereferenced when
  // ctrl.link is set, and desc_fetch checks it at that point against the ring
  // bounds. Validating it unconditionally would reject descriptors that never
  // use it.
  /* verilator lint_off UNUSEDSIGNAL */
  function automatic err_e desc_check(input desc_t d);
    if (!d.ctrl.valid) begin
      desc_check = ErrDescInvalid;
    end else if ((d.addr[$clog2(DescAlignBytes)-1:0] != '0) ||
                 (d.length[$clog2(DescAlignBytes)-1:0] != '0)) begin
      desc_check = ErrDescAlign;
    end else if ((d.length == '0) || (d.length > DescMaxLength)) begin
      desc_check = ErrDescLength;
    end else begin
      desc_check = ErrNone;
    end
  endfunction
  /* verilator lint_on UNUSEDSIGNAL */

  // Apply AXI4-Lite byte strobes to a 32-bit register: each set wstrb bit
  // takes its byte from wdata, each clear bit keeps the corresponding byte of
  // cur unchanged. Shared by axil_slave's regbus clients (daq_csr today) so
  // partial-word writes behave identically everywhere instead of each
  // register file reinventing the same four-way mux.
  function automatic logic [31:0] apply_wstrb(
      input logic [31:0] cur, input logic [31:0] wdata, input logic [3:0] wstrb);
    apply_wstrb = cur;
    for (int unsigned i = 0; i < 4; i++) begin
      if (wstrb[i]) apply_wstrb[i*8+:8] = wdata[i*8+:8];
    end
  endfunction

  // Synthesizable popcount over an AxiBw-wide strobe, standing in for
  // $countones(). $countones is legal SystemVerilog and every simulator/
  // formal tool used on this project accepts it, but OpenLane's physical-
  // design flow's "Generate JSON Header" step uses yosys's classic AST
  // frontend, which flags it a "non-synthesizable construct" and crashes
  // trying to serialize the resulting AST. perf_cnt.sv used to declare this
  // same loop as a local function; the same classic frontend then failed
  // differently ("Can't resolve function name gen_ch[0].popcount") because
  // it cannot resolve a module-local automatic function called from inside
  // a generate-for scope. A package function has neither problem - the
  // exact pattern axi_pkg::bytes_to_boundary and this package's own
  // apply_wstrb already use, and pkt_check.sv's crc32_byte_step already
  // proves package functions called from inside a generate-for block are
  // fine on this toolchain (chan_top's own OpenLane run already exercises
  // that exact call site).
  function automatic logic [$clog2(AxiBw + 1)-1:0] popcount(input logic [AxiBw-1:0] v);
    popcount = '0;
    for (int unsigned b = 0; b < AxiBw; b++) begin
      popcount = popcount + $clog2(AxiBw + 1)'(v[b]);
    end
  endfunction

endpackage
