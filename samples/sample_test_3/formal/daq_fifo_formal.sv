// Formal harness for daq_async_fifo (the clock-domain-crossing FIFO inside
// daq_top), configured exactly as daq_top instantiates it: DEPTH=8, 10-bit
// payload {sop, eop, data[7:0]}.
//
// wclk and rclk are left as free inputs and the proof runs with
// `multiclock on`, so yosys' clk2fflogic pass models the two domains as
// genuinely asynchronous - the engine is free to interleave their edges any
// way it likes, including the pathological orderings a directed simulation
// would never produce.
module fifo_formal_top(
  input logic wclk,
  input logic rclk,
  input logic w_en,
  input logic r_en,
  input logic [9:0] wdata
);
  localparam int DEPTH = 8;

  logic rst_n;
  wire  w_full, r_empty;
  wire [9:0] rdata;

  daq_async_fifo #(.DEPTH(DEPTH)) u_fifo (
    .wclk(wclk), .wrst_n(rst_n), .w_en(w_en), .wdata(wdata), .w_full(w_full),
    .rclk(rclk), .rrst_n(rst_n), .r_en(r_en), .rdata(rdata), .r_empty(r_empty)
  );

  // Drive reset from a counter rather than assuming it, so the base case
  // always starts from the real post-reset state.
  reg [1:0] cyc = 0;
  always @(posedge wclk) if (cyc < 3) cyc <= cyc + 1;
  assign rst_n = (cyc >= 2);

  function automatic [3:0] gray2bin(input [3:0] g);
    gray2bin[3] = g[3];
    gray2bin[2] = g[2] ^ gray2bin[3];
    gray2bin[1] = g[1] ^ gray2bin[2];
    gray2bin[0] = g[0] ^ gray2bin[1];
  endfunction

  // True occupancy, which no port exposes: modular difference of the two
  // binary pointers.
  wire [3:0] occ = u_fifo.wbin - u_fifo.rbin;
  // What each side believes about the other, decoded back from the
  // synchronizer stages.
  wire [3:0] rbin_w1 = gray2bin(u_fifo.rgray_w1);
  wire [3:0] rbin_w2 = gray2bin(u_fifo.rgray_w2);
  wire [3:0] wbin_r1 = gray2bin(u_fifo.wgray_r1);
  wire [3:0] wbin_r2 = gray2bin(u_fifo.wgray_r2);

  always @* begin
    if (rst_n) begin
      // --- Auxiliary invariants -----------------------------------------
      // The gray pointers must stay the gray encoding of their binary
      // counterparts. Everything the CDC does rests on this.
      assert (u_fifo.wgray == ((u_fifo.wbin >> 1) ^ u_fifo.wbin));
      assert (u_fifo.rgray == ((u_fifo.rbin >> 1) ^ u_fifo.rbin));
      // What each side currently believes about the other is decoded above
      // (rbin_w1/rbin_w2/wbin_r1/wbin_r2) and reported in the counterexample
      // trace. Bounds on how far those stages may lag were tried here as
      // induction helpers and removed again: they are not obviously true of
      // this design (rclk may tick arbitrarily often between wclk edges), and
      // asserting something unjustified just to close induction would make
      // the proof look stronger than it is. See the note in daq_fifo.sby.

      // --- The properties that actually matter ---------------------------
      // Occupancy can never exceed the configured depth: no entry is ever
      // overwritten before it is read.
      assert (occ <= DEPTH);
      // w_full is allowed to be pessimistic (it compares against a stale read
      // pointer) but never optimistic: if it says there is room, there is.
      assert (w_full || occ < DEPTH);
      // r_empty likewise: if it says data is available, data really is.
      assert (r_empty || occ > 0);
      // Direct restatement at the point of use - no silent overflow and no
      // silent underflow.
      assert (!(w_en && !w_full && occ == DEPTH));
      assert (!(r_en && !r_empty && occ == 0));
    end
  end
endmodule
