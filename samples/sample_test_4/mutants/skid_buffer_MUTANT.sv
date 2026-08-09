// Mutant copy of rtl/common/skid_buffer.sv.
//
// This is skid_buffer.sv with two `ifdef`-selected defects. It exists so that
// "tb_skid_buffer passes" means something: a testbench that also passes on
// broken RTL has proved nothing. scripts/run_block_tb.ps1 -Mutant builds this
// in place of the real module and inverts the exit status, so a mutant that
// slips through is reported as the failure it is.
//
// Keep in step with the golden file. If skid_buffer.sv changes, the untouched
// parts here must change with it, or the mutation result stops being about the
// defect.
//
//   MUT_SKID_READY   ready_o ignores the skid register, so a third beat
//                    overwrites one that has not been emitted yet -> data loss
//                    under backpressure. tb phase 3 (capacity) catches it.
//   MUT_SKID_BYPASS  draining the skid emits whatever the upstream is
//                    currently offering instead of the stored beat ->
//                    reordering. Only the phase-2 scoreboard catches it;
//                    phases 1 and 3 do not.
//   MUT_SKID_DRAIN   the skid register clears whenever it is occupied rather
//                    than only when the output advances -> the skidded beat is
//                    silently dropped.
//
// Not offered: swapping the two arms of the output-register mux so a fresh
// beat wins over the skid. That looks like a reordering defect but is an
// EQUIVALENT MUTANT: ready_o is ~skid_valid_q, so `skid_valid_q` and
// `valid_i && ready_o` can never both be true and the two arms are disjoint by
// construction. It was tried, it passed, and the testbench was right to pass
// it - a surviving mutant is only evidence of a verification gap once you have
// shown the mutation is reachable at all.

module skid_buffer #(
  parameter int unsigned Width = 32
) (
  input  logic             clk_i,
  input  logic             rst_ni,

  input  logic             valid_i,
  output logic             ready_o,
  input  logic [Width-1:0] data_i,

  output logic             valid_o,
  input  logic             ready_i,
  output logic [Width-1:0] data_o
);

  logic             out_valid_q;
  logic [Width-1:0] out_data_q;
  logic             skid_valid_q;
  logic [Width-1:0] skid_data_q;

`ifdef MUT_SKID_READY
  assign ready_o = 1'b1;
`else
  assign ready_o = ~skid_valid_q;
`endif
  assign valid_o = out_valid_q;
  assign data_o  = out_data_q;

  logic out_advance;
  assign out_advance = ~out_valid_q | ready_i;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      out_valid_q  <= 1'b0;
      out_data_q   <= '0;
      skid_valid_q <= 1'b0;
      skid_data_q  <= '0;
    end else begin
      if (valid_i && ready_o && out_valid_q && !ready_i) begin
        skid_valid_q <= 1'b1;
        skid_data_q  <= data_i;
`ifdef MUT_SKID_DRAIN
      end else if (skid_valid_q) begin
`else
      end else if (skid_valid_q && out_advance) begin
`endif
        skid_valid_q <= 1'b0;
      end

      if (out_advance) begin
        if (skid_valid_q) begin
          out_valid_q <= 1'b1;
`ifdef MUT_SKID_BYPASS
          out_data_q  <= data_i;
`else
          out_data_q  <= skid_data_q;
`endif
        end else if (valid_i && ready_o) begin
          out_valid_q <= 1'b1;
          out_data_q  <= data_i;
        end else begin
          out_valid_q <= 1'b0;
        end
      end
    end
  end

endmodule
