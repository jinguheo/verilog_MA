// Saturating statistics counter.
//
// The second of the two rtl/common modules written rather than reused.
// OpenTitan's prim_count is a security-hardened duplicated counter with a
// cross-check alert output; using it for byte/packet/stall statistics would
// pay for tamper detection this design does not claim to provide, and would
// put an alert path into perf_cnt that has no consumer.
//
// Saturating rather than wrapping: a wrapped statistics counter is
// indistinguishable from a small one, so software cannot tell whether the
// number it read is real. `saturated_o` says the value is a floor, not a count.

module cnt_sat #(
  parameter int unsigned Width  = 32,
  // Width of the increment. 1 gives a plain event counter; wider is used for
  // byte counts, where the increment is the number of valid bytes in a beat.
  parameter int unsigned IncrW  = 1
) (
  input  logic             clk_i,
  input  logic             rst_ni,

  input  logic             clear_i,      // synchronous clear, wins over incr
  input  logic             incr_en_i,
  input  logic [IncrW-1:0] incr_i,

  output logic [Width-1:0] cnt_o,
  output logic             saturated_o
);

  logic [Width-1:0] cnt_q;
  logic [Width:0]   sum;     // one extra bit to catch the carry out
  logic [Width-1:0] nxt;

  assign sum = {1'b0, cnt_q} + {{(Width+1-IncrW){1'b0}}, incr_i};
  assign nxt = sum[Width] ? {Width{1'b1}} : sum[Width-1:0];

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      cnt_q <= '0;
    end else if (clear_i) begin
      cnt_q <= '0;
    end else if (incr_en_i) begin
      cnt_q <= nxt;
    end
  end

  assign cnt_o       = cnt_q;
  assign saturated_o = &cnt_q;

`ifdef DAQ_SVA
  default disable iff (!rst_ni);

  // Monotonic except on clear - the whole point of saturating.
  p_monotonic: assert property (@(posedge clk_i)
    !clear_i |=> cnt_o >= $past(cnt_o));

  // Once saturated it stays saturated until cleared.
  p_sticky_sat: assert property (@(posedge clk_i)
    saturated_o && !clear_i |=> saturated_o);

  // Clear takes precedence over a simultaneous increment.
  p_clear_wins: assert property (@(posedge clk_i)
    clear_i |=> cnt_o == '0);
`endif

  // IncrW may not exceed Width; the zero-extension above would be malformed.
  if (IncrW > Width) begin : gen_bad_incr_w
    initial $fatal(1, "cnt_sat: IncrW (%0d) must not exceed Width (%0d)", IncrW, Width);
  end

endmodule
