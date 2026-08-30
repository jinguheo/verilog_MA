// Formal harness for cnt_sat. Single clock, single reset. Restates the RTL's
// own `ifdef DAQ_SVA properties in the always-@* / history-register style
// (see skid_buffer_formal.sv for why plain SVA is not an option here).
//
// Width/IncrW fixed at small, coprime-ish values (8/3) rather than the
// design's real instantiations (32-bit byte counters etc.) - the carry/
// saturation logic is bit-width generic and a small width lets the solver
// explore wraparound and the saturation boundary in a handful of cycles
// instead of 2^32 of them, which is the whole point of proving this instead
// of just simulating it.
module cnt_sat_formal(
  input logic clk_i,
  input logic clear_i,
  input logic incr_en_i,
  input logic [2:0] incr_i
);
  localparam int Width = 8;
  localparam int IncrW = 3;

  logic rst_ni;
  wire [Width-1:0] cnt_o;
  wire saturated_o;

  cnt_sat #(.Width(Width), .IncrW(IncrW)) dut(
    .clk_i(clk_i), .rst_ni(rst_ni),
    .clear_i(clear_i), .incr_en_i(incr_en_i), .incr_i(incr_i),
    .cnt_o(cnt_o), .saturated_o(saturated_o)
  );

  reg [1:0] cyc = 0;
  always @(posedge clk_i) if (cyc < 3) cyc <= cyc + 1;
  assign rst_ni = (cyc >= 2);

  reg past_valid;
  reg p_clear_i, p_saturated_o, p_incr_en_i;
  reg [Width-1:0] p_cnt_o;
  reg [IncrW-1:0] p_incr_i;
  always @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      past_valid <= 0; p_clear_i <= 0; p_saturated_o <= 0; p_incr_en_i <= 0;
      p_cnt_o <= '0; p_incr_i <= '0;
    end else begin
      past_valid <= 1;
      p_clear_i <= clear_i; p_saturated_o <= saturated_o; p_incr_en_i <= incr_en_i;
      p_cnt_o <= cnt_o; p_incr_i <= incr_i;
    end
  end

  always @(posedge clk_i) begin
    if (rst_ni && past_valid) begin
      // Monotonic except on a clear - the whole point of saturating instead
      // of wrapping. Catches MUT_CNT_WRAP directly: a dropped carry produces
      // a small value right after a large one, with no clear in between.
      if (!p_clear_i) assert (cnt_o >= p_cnt_o);

      // Once saturated it stays saturated until cleared.
      if (p_saturated_o && !p_clear_i) assert (saturated_o);

      // Clear takes precedence over a simultaneous increment. Catches
      // MUT_CNT_CLEAR_LOSE directly: with clear_i and incr_en_i both high,
      // the mutant lets the increment win.
      if (p_clear_i) assert (cnt_o == '0);

      // Exact saturation arithmetic, not just "did not exceed max": when
      // running (no clear) and not already pinned at all-ones, the new count
      // is either the precise sum or the precise clamp - never an
      // approximation of either. This is the property that would catch a
      // saturation boundary off-by-one that the three above are too coarse
      // to see (e.g. clamping one increment early or late).
      //
      // The sum is computed at Width+1 bits, exactly mirroring the DUT's own
      // `sum` register - adding two Width-bit values in a Width-bit context
      // would self-determine the addition's width from its operands and
      // silently wrap before the overflow check ever saw it, which is exactly
      // the bug this property exists to catch and would then be blind to in
      // its own reference computation.
      if (!p_clear_i && p_incr_en_i && !p_saturated_o) begin
        reg [Width:0] ref_sum;
        ref_sum = {1'b0, p_cnt_o} + {{(Width+1-IncrW){1'b0}}, p_incr_i};
        if (ref_sum[Width])
          assert (cnt_o == {Width{1'b1}});
        else
          assert (cnt_o == ref_sum[Width-1:0]);
      end
    end
  end
endmodule
