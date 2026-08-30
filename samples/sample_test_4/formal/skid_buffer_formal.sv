// Formal harness for skid_buffer. Single clock, single reset - the simplest
// block in this project's common/ library, and the natural first formal
// target for Sample Test 4's phase-6 per-block proofs.
//
// skid_buffer's own `ifdef DAQ_SVA block states three invariants and says
// "the harness under formal/ is the authority" - this file is that harness,
// restated in the always-@* / history-register style yosys/slang accept (see
// samples/sample_test_2/formal/prim_fifo_sync.sby for why plain SVA with
// disable iff / |=> is not an option with the bundled slang frontend).
//
// Correctness for a depth-2 skid buffer is four properties:
//   - capacity: the skid register is never occupied while the output
//     register is empty (skid always drains INTO the output register, never
//     stands in for it)
//   - no silent accept: ready_o low only when the skid register is genuinely
//     the reason (not a phantom stall)
//   - no silent drop: a stalled downstream never loses the beat already
//     presented at the output
//   - correct source selection: when the output register advances, the value
//     it takes is the one priority actually dictates (skid_data_q if the skid
//     register was occupied, data_i if it was accepted directly) - not the
//     handshake-only properties above, but the one property that would catch
//     a swapped-priority bug (e.g. draining data_i instead of skid_data_q)
//     that leaves every handshake signal correct while silently reordering or
//     dropping the in-flight beat.
module skid_buffer_formal(
  input logic clk_i,
  input logic valid_i,
  input logic ready_i,
  input logic [7:0] data_i
);
  localparam int Width = 8;

  logic rst_ni;
  wire ready_o, valid_o;
  wire [Width-1:0] data_o;

  skid_buffer #(.Width(Width)) dut(
    .clk_i(clk_i), .rst_ni(rst_ni),
    .valid_i(valid_i), .ready_o(ready_o), .data_i(data_i),
    .valid_o(valid_o), .ready_i(ready_i), .data_o(data_o)
  );

  // Drive reset from a counter rather than assuming it, so the base case
  // always starts from the real post-reset state.
  reg [1:0] cyc = 0;
  always @(posedge clk_i) if (cyc < 3) cyc <= cyc + 1;
  assign rst_ni = (cyc >= 2);

  always @(posedge clk_i) begin
    if (rst_ni) begin
      // Capacity: the skid register standing in for an empty output register
      // would mean a beat is "in flight" nowhere - unreachable by construction
      // (the RTL's own out_advance priority always drains skid first).
      assert (!(dut.skid_valid_q && !dut.out_valid_q));

      // No silent accept: ready_o can only be low because the skid register
      // is the reason - the RTL's own p_no_accept_when_full, restated here as
      // the authoritative copy the ifdef block defers to.
      assert (!ready_o == dut.skid_valid_q);
    end
  end

  // One-cycle history. Every remaining property compares "what happened last
  // cycle" against "what is true now", so needs past_valid to guard the very
  // first post-reset check the same way Sample Test 2/3's formal harnesses do.
  reg past_valid;
  reg p_valid_o, p_ready_i, p_out_advance, p_skid_valid_q, p_accept_direct;
  reg [Width-1:0] p_data_o, p_skid_data_q, p_data_i;
  always @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      past_valid <= 0;
      p_valid_o <= 0; p_ready_i <= 0; p_out_advance <= 0; p_skid_valid_q <= 0;
      p_accept_direct <= 0; p_data_o <= '0; p_skid_data_q <= '0; p_data_i <= '0;
    end else begin
      past_valid <= 1;
      p_valid_o <= valid_o;
      p_ready_i <= ready_i;
      p_out_advance <= dut.out_advance;
      p_skid_valid_q <= dut.skid_valid_q;
      // "Accepted directly" = would take data_i on this advance, per the
      // RTL's own else-if: skid empty, and a beat is being accepted.
      p_accept_direct <= valid_i && ready_o;
      p_data_o <= data_o;
      p_skid_data_q <= dut.skid_data_q;
      p_data_i <= data_i;
    end
  end

  always @(posedge clk_i) begin
    if (rst_ni && past_valid) begin
      // No silent drop: a beat presented while downstream stalls must still
      // be there, unchanged, next cycle.
      if (p_valid_o && !p_ready_i) assert (valid_o && data_o == p_data_o);

      // Correct source selection on an advance: skid has priority, so if it
      // was occupied last cycle, its value (captured last cycle) is what
      // shows up now - not whatever data_i happened to be.
      if (p_out_advance && p_skid_valid_q) assert (data_o == p_skid_data_q);

      // If skid was NOT occupied and a beat was accepted directly, that
      // beat's data_i (captured last cycle) is what shows up now.
      if (p_out_advance && !p_skid_valid_q && p_accept_direct)
        assert (data_o == p_data_i);

      // No premature drain: once occupied, the skid register may only clear
      // on the cycle the output register actually advances (the RTL's
      // documented drain condition, "out_advance"). Without this, a mutant
      // that clears skid_valid_q as soon as it is set - regardless of
      // out_advance - silently drops the skidded beat one cycle before any of
      // the properties above ever get to see it in p_skid_valid_q, and slips
      // through undetected. (Found exactly this way: MUT_SKID_DRAIN passed
      // every property above before this one was added.)
      if (p_skid_valid_q && !p_out_advance) assert (dut.skid_valid_q);
    end
  end
endmodule
