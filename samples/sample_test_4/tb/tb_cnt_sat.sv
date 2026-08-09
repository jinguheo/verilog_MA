// Block-level testbench for rtl/common/cnt_sat.sv.
//
// The counter is deliberately narrow here (Width=8) so saturation is reachable
// in a few hundred cycles. A 32-bit instance is also elaborated to prove the
// wide increment path, but only the narrow one is driven to the limit - which
// is the whole reason the module is parameterised.

module tb_cnt_sat;

  localparam int unsigned NarrowW = 8;
  localparam int unsigned NarrowI = 4;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic               clear;
  logic               incr_en;
  logic [NarrowI-1:0] incr;
  logic [NarrowW-1:0] cnt;
  logic               saturated;

  cnt_sat #(.Width(NarrowW), .IncrW(NarrowI)) dut (
    .clk_i       (clk),
    .rst_ni      (rst_n),
    .clear_i     (clear),
    .incr_en_i   (incr_en),
    .incr_i      (incr),
    .cnt_o       (cnt),
    .saturated_o (saturated)
  );

  // A 32-bit instance with a byte-count increment, elaborated but driven only
  // enough to prove the wide path is not width-mismatched.
  logic [31:0] wide_cnt;
  logic        wide_sat;
  cnt_sat #(.Width(32), .IncrW(4)) dut_wide (
    .clk_i       (clk),
    .rst_ni      (rst_n),
    .clear_i     (1'b0),
    .incr_en_i   (incr_en),
    .incr_i      (incr),
    .cnt_o       (wide_cnt),
    .saturated_o (wide_sat)
  );

  int unsigned errors = 0;

  // Independent reference model. Saturating add in a wider type, so the
  // reference cannot reproduce a carry bug in the DUT by construction.
  int unsigned model = 0;
  localparam int unsigned NarrowMax = (1 << NarrowW) - 1;

  always @(posedge clk) begin
    if (!rst_n) begin
      model <= 0;
    end else if (clear) begin
      model <= 0;
    end else if (incr_en) begin
      model <= ((model + int'(incr)) > NarrowMax) ? NarrowMax : (model + int'(incr));
    end
  end

  always @(posedge clk) begin
    if (rst_n && $past(rst_n)) begin
      if (cnt !== NarrowW'(model)) begin
        $display("ERROR: cnt=%0d expected %0d", cnt, model);
        errors++;
      end
      if (saturated !== (model == NarrowMax)) begin
        $display("ERROR: saturated=%0b at cnt=%0d", saturated, cnt);
        errors++;
      end
      // The 32-bit instance sees the same increments and cannot reach 2^32-1
      // in this run, so a saturation there means the carry logic is wrong at
      // the wide width - the case the narrow instance cannot expose.
      if (wide_sat) begin
        $display("ERROR: 32-bit instance saturated at cnt=%0d", wide_cnt);
        errors++;
      end
    end
  end

  initial begin
    clear = 1'b0; incr_en = 1'b0; incr = '0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);

    if (cnt !== '0) begin
      $display("ERROR: counter did not reset to zero");
      errors++;
    end

    // ---- unit increments up to and past saturation ------------------------
    incr_en = 1'b1; incr = 4'd1;
    repeat (NarrowMax + 20) @(negedge clk);
    if (!saturated) begin
      $display("ERROR: never saturated after %0d unit increments", NarrowMax + 20);
      errors++;
    end
    if (cnt !== NarrowW'(NarrowMax)) begin
      $display("ERROR: saturated value is %0h, expected all ones", cnt);
      errors++;
    end

    // ---- clear wins over a simultaneous increment --------------------------
    clear = 1'b1;
    @(negedge clk);
    clear = 1'b0;
    if (cnt !== '0) begin
      $display("ERROR: clear did not take precedence over incr_en, cnt=%0d", cnt);
      errors++;
    end
    if (saturated) begin
      $display("ERROR: saturated still asserted after clear");
      errors++;
    end

    // ---- multi-byte increments straddle the limit exactly ------------------
    // 8-bit counter, increment 15: 17 steps reach 255, the 18th must clamp
    // rather than wrap to 14.
    incr = 4'd15;
    repeat (17) @(negedge clk);
    @(negedge clk);
    if (cnt !== NarrowW'(NarrowMax)) begin
      $display("ERROR: wide increment wrapped instead of clamping, cnt=%0h", cnt);
      errors++;
    end

    // ---- disabled increment holds the value --------------------------------
    clear = 1'b1; @(negedge clk); clear = 1'b0;
    incr_en = 1'b0; incr = 4'd7;
    repeat (10) @(negedge clk);
    if (cnt !== '0) begin
      $display("ERROR: counter moved with incr_en low, cnt=%0d", cnt);
      errors++;
    end

    // ---- randomised ---------------------------------------------------------
    for (int unsigned i = 0; i < 2000; i++) begin
      incr_en = ($urandom_range(0, 99) < 70);
      clear   = ($urandom_range(0, 99) < 3);
      incr    = NarrowI'($urandom_range(0, (1 << NarrowI) - 1));
      @(negedge clk);
    end
    incr_en = 1'b0; clear = 1'b0;
    @(negedge clk);

    $display("");
    $display("[CNT_TB] final cnt=%0d wide_cnt=%0d", cnt, wide_cnt);
    if (errors == 0) begin
      $display("[CNT_TB] PASS");
      $finish;
    end else begin
      $display("[CNT_TB] FAIL: %0d error(s)", errors);
      $fatal(1, "tb_cnt_sat failed");
    end
  end

  initial begin
    #1_000_000;
    $fatal(1, "tb_cnt_sat timeout");
  end

endmodule
