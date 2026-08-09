// Block-level testbench for rtl/common/skid_buffer.sv.
//
// Sample Test 3 had only an integration testbench, which is the structural
// thing Sample Test 4 is meant to fix: bugs are cheaper to find here, and a
// block TB can drive corner cases that an integration test reaches only by
// luck.
//
// Stimulus is driven on the negedge and sampled on the posedge, so there is no
// race between the driver and the DUT and no need for clocking blocks.
//
// Three phases:
//   1. full rate       - valid and ready both held high; a beat must be
//                        accepted every single cycle, which is the property
//                        that distinguishes a skid buffer from a plain
//                        register slice
//   2. random          - independently randomised valid/ready, scoreboarded
//   3. stall           - downstream held off while upstream pushes; capacity
//                        must be exactly two beats, no more and no fewer

module tb_skid_buffer;

  localparam int unsigned Width      = 32;
  localparam int unsigned FullCycles = 100;
  localparam int unsigned RandCycles = 4000;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic             valid_i, ready_o;
  logic [Width-1:0] data_i;
  logic             valid_o, ready_i;
  logic [Width-1:0] data_o;

  skid_buffer #(.Width(Width)) dut (
    .clk_i   (clk),
    .rst_ni  (rst_n),
    .valid_i (valid_i),
    .ready_o (ready_o),
    .data_i  (data_i),
    .valid_o (valid_o),
    .ready_i (ready_i),
    .data_o  (data_o)
  );

  // ------------------------------------------------------------- scoreboard

  logic [Width-1:0] expq [$];
  int unsigned errors   = 0;
  int unsigned accepted = 0;
  int unsigned emitted  = 0;
  int unsigned occupancy = 0;   // beats inside the DUT, tracked independently
  int unsigned max_occupancy = 0;

  bit phase_full = 1'b0;
  int unsigned full_accepted = 0;

  // Was the beat offered at the last posedge actually taken? The driver needs
  // this sampled AT the edge. Reading ready_o at the following negedge instead
  // is wrong, and was wrong here: once the skid fills, ready_o is already low
  // again at the negedge, so the driver held the just-accepted beat on data_i
  // rather than presenting the next one. That made data_i identical to
  // skid_data_q and hid MUT_SKID_BYPASS entirely.
  bit offer_taken = 1'b0;

  always @(posedge clk) begin
    if (rst_n) begin
      offer_taken = valid_i && ready_o;
      if (valid_i && ready_o) begin
        expq.push_back(data_i);
        accepted++;
        occupancy++;
        if (phase_full) full_accepted++;
      end
      if (valid_o && ready_i) begin
        if (expq.size() == 0) begin
          $display("ERROR: output beat %0h with nothing outstanding", data_o);
          errors++;
        end else begin
          automatic logic [Width-1:0] exp = expq.pop_front();
          if (exp !== data_o) begin
            $display("ERROR: ordering/data mismatch: expected %0h got %0h", exp, data_o);
            errors++;
          end
        end
        emitted++;
        occupancy--;
      end
      if (occupancy > max_occupancy) max_occupancy = occupancy;
      if (occupancy > 2) begin
        $display("ERROR: occupancy %0d exceeds the 2-beat capacity", occupancy);
        errors++;
      end
      // A held output must not change until it is consumed.
      if ($past(valid_o) && !$past(ready_i)) begin
        if (!valid_o || (data_o !== $past(data_o))) begin
          $display("ERROR: stalled output beat was dropped or mutated");
          errors++;
        end
      end
    end
  end

  // ---------------------------------------------------------------- stimulus

  logic [Width-1:0] next_data = 32'h1000_0000;

  task automatic reset_dut();
    rst_n   = 1'b0;
    valid_i = 1'b0;
    ready_i = 1'b0;
    data_i  = '0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  initial begin
    reset_dut();

    // ---- phase 1: full rate --------------------------------------------
    phase_full = 1'b1;
    ready_i = 1'b1;
    valid_i = 1'b1;
    for (int unsigned i = 0; i < FullCycles; i++) begin
      data_i = next_data; next_data++;
      @(negedge clk);
    end
    valid_i = 1'b0;
    phase_full = 1'b0;
    @(negedge clk);

    if (full_accepted != FullCycles) begin
      $display("ERROR: full-rate phase accepted %0d of %0d beats - not full throughput",
               full_accepted, FullCycles);
      errors++;
    end

    // ---- phase 2: random backpressure -----------------------------------
    // valid/data are held unchanged until the beat is taken, which is what the
    // AXI-style contract requires of an upstream. ready_i is re-randomised
    // every cycle regardless - an earlier version held it frozen while waiting
    // for acceptance, which deadlocked the moment it froze low, since a full
    // skid buffer only drains when the downstream moves.
    for (int unsigned i = 0; i < RandCycles; i++) begin
      if (!valid_i || offer_taken) begin
        valid_i = ($urandom_range(0, 99) < 65);
        if (valid_i) begin
          data_i = next_data; next_data++;
        end
      end
      ready_i = ($urandom_range(0, 99) < 55);
      @(negedge clk);
    end
    valid_i = 1'b0;

    // ---- phase 3: capacity ----------------------------------------------
    ready_i = 1'b0;
    @(negedge clk);
    // Drain whatever the random phase left inside, then refill deterministically.
    ready_i = 1'b1;
    repeat (8) @(negedge clk);
    ready_i = 1'b0;
    @(negedge clk);
    if (occupancy != 0) begin
      $display("ERROR: DUT did not drain, occupancy %0d", occupancy);
      errors++;
    end

    valid_i = 1'b1;
    data_i  = 32'hAAAA_0001; @(negedge clk);   // -> output register
    data_i  = 32'hAAAA_0002; @(negedge clk);   // -> skid register
    if (ready_o !== 1'b0) begin
      $display("ERROR: ready_o still high after two beats with downstream stalled");
      errors++;
    end
    valid_i = 1'b0;
    if (occupancy != 2) begin
      $display("ERROR: expected occupancy 2 while stalled, got %0d", occupancy);
      errors++;
    end

    ready_i = 1'b1;
    repeat (6) @(negedge clk);
    ready_i = 1'b0;

    if (max_occupancy != 2) begin
      $display("ERROR: capacity never reached 2 (max seen %0d) - test did not stress the skid",
               max_occupancy);
      errors++;
    end
    if (expq.size() != 0) begin
      $display("ERROR: %0d beats never came out", expq.size());
      errors++;
    end

    // ---- report ----------------------------------------------------------
    $display("");
    $display("[SKID_TB] accepted=%0d emitted=%0d max_occupancy=%0d",
             accepted, emitted, max_occupancy);
    if (errors == 0) begin
      $display("[SKID_TB] PASS");
      $finish;
    end else begin
      $display("[SKID_TB] FAIL: %0d error(s)", errors);
      $fatal(1, "tb_skid_buffer failed");
    end
  end

  initial begin
    #1_000_000;
    $fatal(1, "tb_skid_buffer timeout");
  end

endmodule
