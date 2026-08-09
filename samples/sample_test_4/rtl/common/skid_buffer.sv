// Registered valid/ready pipeline stage with full throughput.
//
// One of only two modules in rtl/common that is written rather than taken from
// the OpenTitan prim library - there is no prim equivalent, because TileLink
// uses a different flow-control idiom.
//
// Both `valid_o` and `ready_o` are driven from flops, so this breaks the
// combinational path in both directions across an AXI channel. It still
// accepts a beat every cycle when the downstream never stalls: the skid
// register absorbs the one beat that is already in flight when `ready_i`
// drops, which is exactly why `ready_o` may stay high for that cycle.
//
// Capacity is two beats (output register + skid register).

module skid_buffer #(
  parameter int unsigned Width = 32
) (
  input  logic             clk_i,
  input  logic             rst_ni,

  // upstream
  input  logic             valid_i,
  output logic             ready_o,
  input  logic [Width-1:0] data_i,

  // downstream
  output logic             valid_o,
  input  logic             ready_i,
  output logic [Width-1:0] data_o
);

  logic             out_valid_q;
  logic [Width-1:0] out_data_q;
  logic             skid_valid_q;
  logic [Width-1:0] skid_data_q;

  // Back-pressure upstream only once the skid register itself is occupied.
  assign ready_o = ~skid_valid_q;
  assign valid_o = out_valid_q;
  assign data_o  = out_data_q;

  // The output register is free to advance when it is empty or being drained.
  logic out_advance;
  assign out_advance = ~out_valid_q | ready_i;

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      out_valid_q  <= 1'b0;
      out_data_q   <= '0;
      skid_valid_q <= 1'b0;
      skid_data_q  <= '0;
    end else begin
      // Skid register: fills only when a beat arrives while the output
      // register is occupied and stalled, drains whenever the output moves.
      if (valid_i && ready_o && out_valid_q && !ready_i) begin
        skid_valid_q <= 1'b1;
        skid_data_q  <= data_i;
      end else if (skid_valid_q && out_advance) begin
        skid_valid_q <= 1'b0;
      end

      // Output register: skid has priority, so ordering is preserved.
      if (out_advance) begin
        if (skid_valid_q) begin
          out_valid_q <= 1'b1;
          out_data_q  <= skid_data_q;
        end else if (valid_i && ready_o) begin
          out_valid_q <= 1'b1;
          out_data_q  <= data_i;
        end else begin
          out_valid_q <= 1'b0;
        end
      end
    end
  end

`ifdef DAQ_SVA
  // Kept behind a define: slang (used by the formal flow) and Verilator do not
  // accept the same subset, and Sample Test 3 showed that an SVA block written
  // for one silently diverges from the standalone formal harness written for
  // the other. The harness under formal/ is the authority; these are the
  // simulation-side mirror.
  default disable iff (!rst_ni);

  // A stalled downstream must not lose the beat that is already presented.
  p_out_stable: assert property (@(posedge clk_i)
    valid_o && !ready_i |=> valid_o && $stable(data_o));

  // Once full, no further beats are accepted.
  p_no_accept_when_full: assert property (@(posedge clk_i)
    !ready_o |-> skid_valid_q);

  // Capacity never exceeds two beats.
  p_capacity: assert property (@(posedge clk_i)
    !(skid_valid_q && !out_valid_q));
`endif

endmodule
