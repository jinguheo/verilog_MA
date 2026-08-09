// AXI4 / AXI4-Lite common definitions for Sample Test 4.
//
// This package holds only what is independent of the bus widths: the encodings
// defined by the AXI specification itself. Everything whose size depends on
// AXI_DW / AXI_AW / AXI_IDW lives in daq_pkg, because SystemVerilog packages
// cannot be parameterised per instantiation and splitting on that boundary is
// what keeps the parameter sweep possible at all.
//
// OpenTitan is TileLink-based, so unlike the rtl/common layer there is nothing
// in the prim library to reuse here. This file is genuinely new.

package axi_pkg;

  // AWBURST / ARBURST
  typedef enum logic [1:0] {
    BurstFixed = 2'b00,
    BurstIncr  = 2'b01,
    BurstWrap  = 2'b10
    // 2'b11 is reserved
  } burst_e;

  // BRESP / RRESP
  typedef enum logic [1:0] {
    RespOkay   = 2'b00,
    RespExOkay = 2'b01,
    RespSlvErr = 2'b10,
    RespDecErr = 2'b11
  } resp_e;

  // AWSIZE / ARSIZE - log2 of bytes per beat.
  typedef enum logic [2:0] {
    Size1B   = 3'b000,
    Size2B   = 3'b001,
    Size4B   = 3'b010,
    Size8B   = 3'b011,
    Size16B  = 3'b100,
    Size32B  = 3'b101,
    Size64B  = 3'b110,
    Size128B = 3'b111
  } size_e;

  // AWPROT / ARPROT
  typedef struct packed {
    logic instruction;  // [2]
    logic non_secure;   // [1]
    logic privileged;   // [0]
  } prot_t;

  localparam prot_t ProtDataUnpriv = '{instruction: 1'b0, non_secure: 1'b0, privileged: 1'b0};

  // AWCACHE / ARCACHE - "normal non-cacheable non-bufferable" is what a DMA
  // engine writing to plain memory should emit unless told otherwise.
  localparam logic [3:0] CacheNonCacheable = 4'b0010;

  // A burst may not cross a 4 KB address boundary. Every master in this design
  // splits against this constant rather than a local literal.
  localparam int unsigned BoundaryBytes = 4096;

  // AXI4 allows at most 256 beats in an INCR burst; AWLEN is the count minus 1.
  localparam int unsigned MaxBeatsPerBurst = 256;

  // Bytes remaining before the next `BoundaryBytes` boundary, given a byte
  // address. Used by both AXI masters to decide where to split a burst.
  // Only the offset within the 4 KB page matters, so the upper address bits
  // are unused by construction rather than by oversight.
  /* verilator lint_off UNUSEDSIGNAL */
  function automatic int unsigned bytes_to_boundary(input logic [31:0] addr);
    bytes_to_boundary = BoundaryBytes - int'(addr[$clog2(BoundaryBytes)-1:0]);
  endfunction
  /* verilator lint_on UNUSEDSIGNAL */

  // Is `resp` an error response?
  function automatic logic resp_is_error(input logic [1:0] resp);
    resp_is_error = (resp == RespSlvErr) || (resp == RespDecErr);
  endfunction

endpackage
