// Mutant copy of rtl/common/cnt_sat.sv. See mutants/skid_buffer_MUTANT.sv for
// why these exist and what -Mutant does with them.
//
//   MUT_CNT_WRAP        the carry out is discarded, so the counter wraps
//                       instead of clamping. tb phase "multi-byte increments
//                       straddle the limit exactly" and the reference model
//                       comparison should both catch it.
//   MUT_CNT_CLEAR_LOSE  increment takes precedence over clear, so a clear that
//                       lands on the same cycle as an increment is dropped.
//                       Only the reference model and the explicit clear check
//                       catch this; a test that clears on quiet cycles will
//                       not.

module cnt_sat #(
  parameter int unsigned Width  = 32,
  parameter int unsigned IncrW  = 1
) (
  input  logic             clk_i,
  input  logic             rst_ni,

  input  logic             clear_i,
  input  logic             incr_en_i,
  input  logic [IncrW-1:0] incr_i,

  output logic [Width-1:0] cnt_o,
  output logic             saturated_o
);

  logic [Width-1:0] cnt_q;
  logic [Width:0]   sum;
  logic [Width-1:0] nxt;

  assign sum = {1'b0, cnt_q} + {{(Width+1-IncrW){1'b0}}, incr_i};

`ifdef MUT_CNT_WRAP
  assign nxt = sum[Width-1:0];
`else
  assign nxt = sum[Width] ? {Width{1'b1}} : sum[Width-1:0];
`endif

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      cnt_q <= '0;
`ifdef MUT_CNT_CLEAR_LOSE
    end else if (incr_en_i) begin
      cnt_q <= nxt;
    end else if (clear_i) begin
      cnt_q <= '0;
`else
    end else if (clear_i) begin
      cnt_q <= '0;
    end else if (incr_en_i) begin
      cnt_q <= nxt;
`endif
    end
  end

  assign cnt_o       = cnt_q;
  assign saturated_o = &cnt_q;

endmodule
