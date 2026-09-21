// Block-level testbench for rtl/analog_if/adc_cal_lut.sv.
//
// Built at NumCh=4, EntriesPerCh=8 (32 total entries) - small enough to
// exhaustively cover every address while still exercising real multi-
// channel contention, the same reasoning tb_dma_sched.sv/tb_desc_fetch.sv
// use for their own smaller-than-default NumCh.
//
// A host-side shadow array is the reference model: every CSR write updates
// it, every channel read is checked against it. Uses the posedge-monitor
// acceptance pattern for both rd_gnt_o and rd_data_valid_o - the same
// pattern this project's own testbench races (tb_desc_fetch.sv,
// tb_axi_rd_master.sv) already showed is required for any handshake a
// driver or checker reacts to.
//
// Phases:
//   1. one channel, sequential reads across every one of its entries -
//      basic write-then-read correctness end to end
//   2. all channels contending concurrently with random indices, many
//      reads each - correct per-channel data, and every channel actually
//      gets serviced (no starvation in this run)
//   3. a CSR write landing on the same cycle multiple channels are
//      requesting - the write must win (no read grant that cycle), and a
//      read of the just-written address afterward must see the new value

module tb_adc_cal_lut;
  localparam int unsigned NumCh        = 4;
  localparam int unsigned EntriesPerCh = 8;
  localparam int unsigned DataWidth    = 32;
  localparam int unsigned IdxW         = $clog2(EntriesPerCh);
  localparam int unsigned ChIdxW       = $clog2(NumCh);

  logic clk = 1'b0;
  always #5 clk = ~clk;
  logic rst_n = 1'b0;

  logic [NumCh-1:0]   rd_req, rd_gnt;
  logic [IdxW-1:0]    rd_idx [NumCh];
  logic               rd_data_valid;
  logic [ChIdxW-1:0]  rd_data_ch;
  logic [DataWidth-1:0] rd_data;

  logic                 cal_wr_valid, cal_wr_ready;
  logic [ChIdxW-1:0]    cal_wr_ch;
  logic [IdxW-1:0]      cal_wr_idx;
  logic [DataWidth-1:0] cal_wr_data;

  adc_cal_lut #(.NumCh(NumCh), .EntriesPerCh(EntriesPerCh), .DataWidth(DataWidth)) dut (
    .clk_i (clk), .rst_ni (rst_n),
    .rd_req_i (rd_req), .rd_gnt_o (rd_gnt), .rd_idx_i (rd_idx),
    .rd_data_valid_o (rd_data_valid), .rd_data_ch_o (rd_data_ch), .rd_data_o (rd_data),
    .cal_wr_valid_i (cal_wr_valid), .cal_wr_ready_o (cal_wr_ready),
    .cal_wr_ch_i (cal_wr_ch), .cal_wr_idx_i (cal_wr_idx), .cal_wr_data_i (cal_wr_data)
  );

  logic [DataWidth-1:0] shadow [NumCh][EntriesPerCh];

  // Module scope, not automatic-inside-block: phase 2's per-channel
  // join_none processes reference this after the spawning block's own
  // scope has notionally ended, the same LIFETIME hazard tb_dma_sched.sv's
  // stress_done array hit and fixed the same way.
  int unsigned served [NumCh];

  int unsigned errors = 0;
  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // ---- posedge-monitor acceptance, both handshakes ----------------------------
  logic [NumCh-1:0] gnt_taken;
  always @(posedge clk) begin
    for (int unsigned c = 0; c < NumCh; c++) gnt_taken[c] = rd_req[c] & rd_gnt[c];
  end

  logic                 data_taken;
  logic [ChIdxW-1:0]    data_taken_ch;
  logic [DataWidth-1:0] data_taken_val;
  always @(posedge clk) begin
    data_taken     = rd_data_valid;
    data_taken_ch  = rd_data_ch;
    data_taken_val = rd_data;
  end

  logic wr_taken;
  always @(posedge clk) wr_taken = cal_wr_valid & cal_wr_ready;

  // No two channels ever granted the same cycle, and a grant only ever
  // happens when that channel actually asked.
  always @(posedge clk) begin
    if (rst_n) begin
      check($onehot0(rd_gnt), "more than one channel's rd_gnt_o asserted at once");
      check((rd_gnt & ~rd_req) == '0, "rd_gnt_o asserted for a channel that did not request");
      if (wr_taken) check(rd_gnt == '0, "a channel was granted the same cycle a write fired");
    end
  end

  task automatic reset_dut();
    rd_req = '0;
    for (int unsigned c = 0; c < NumCh; c++) rd_idx[c] = '0;
    cal_wr_valid = 1'b0; cal_wr_ch = '0; cal_wr_idx = '0; cal_wr_data = '0;
    for (int unsigned c = 0; c < NumCh; c++)
      for (int unsigned i = 0; i < EntriesPerCh; i++) shadow[c][i] = '0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
  endtask

  task automatic do_write(input logic [ChIdxW-1:0] ch, input logic [IdxW-1:0] idx, input logic [DataWidth-1:0] data);
    cal_wr_ch = ch; cal_wr_idx = idx; cal_wr_data = data;
    cal_wr_valid = 1'b1;
    @(negedge clk);
    while (!wr_taken) @(negedge clk);
    cal_wr_valid = 1'b0;
    shadow[ch][idx] = data;
  endtask

  // Issues one read for (ch, idx), waits for grant then for that channel's
  // own data to come back (another channel's grant/data may interleave in
  // between - this task only returns once THIS channel's result appears),
  // and checks it against the shadow model.
  task automatic do_read_check(input logic [ChIdxW-1:0] ch, input logic [IdxW-1:0] idx);
    rd_idx[ch] = idx;
    rd_req[ch] = 1'b1;
    @(negedge clk);
    while (!gnt_taken[ch]) @(negedge clk);
    rd_req[ch] = 1'b0;
    @(negedge clk);
    while (!(data_taken && data_taken_ch == ch)) @(negedge clk);
    check(data_taken_val === shadow[ch][idx],
          $sformatf("ch%0d idx%0d: got %0d expected %0d", ch, idx, data_taken_val, shadow[ch][idx]));
  endtask

  initial begin
    reset_dut();

    // ---- seed every entry with a distinct, recoverable value -------------------
    for (int unsigned c = 0; c < NumCh; c++)
      for (int unsigned i = 0; i < EntriesPerCh; i++)
        do_write(ChIdxW'(c), IdxW'(i), DataWidth'((c << 8) | i | 32'hA000_0000));

    // ---- phase 1: one channel, every one of its entries, in order --------------
    for (int unsigned i = 0; i < EntriesPerCh; i++) do_read_check(2'd0, IdxW'(i));

    // ---- phase 2: all channels contending concurrently --------------------------
    begin
      // A `fork <for-loop> join` would wait only on the for-loop's own
      // single thread, which finishes as soon as it has launched every
      // join_none child - not when those children finish - leaving them
      // running in the background to corrupt phase 3's shared driver
      // state. Spawning each iteration with join_none and then blocking on
      // `wait fork` (waits for every outstanding child this process
      // forked) is the correct "N parallel workers, wait for all" idiom.
      for (int unsigned c = 0; c < NumCh; c++) served[c] = 0;
      for (int unsigned c = 0; c < NumCh; c++) begin
        automatic logic [ChIdxW-1:0] cc = ChIdxW'(c);
        fork
          begin
            for (int unsigned r = 0; r < 6; r++) begin
              do_read_check(cc, IdxW'($urandom_range(0, EntriesPerCh - 1)));
              served[cc]++;
            end
          end
        join_none
      end
      wait fork;
      for (int unsigned c = 0; c < NumCh; c++)
        check(served[c] == 6, $sformatf("ch%0d only served %0d/6 reads - possible starvation", c, served[c]));
    end

    // ---- phase 3: a write races several channels' read requests -----------------
    begin
      fork
        do_write(2'd1, IdxW'(3), 32'hCAFE_0001);
        begin
          rd_req[0] = 1'b1; rd_idx[0] = IdxW'(0);
          rd_req[2] = 1'b1; rd_idx[2] = IdxW'(0);
          @(negedge clk);
          rd_req[0] = 1'b0;
          rd_req[2] = 1'b0;
        end
      join
      // Both reads above may or may not have been granted before the write
      // landed; wait a few idle cycles for anything in flight to settle,
      // then confirm the new value is visible.
      repeat (5) @(negedge clk);
      do_read_check(2'd1, IdxW'(3));
    end

    repeat (5) @(negedge clk);
    if (errors == 0) begin $display("[ADC_CAL_LUT_TB] PASS"); $finish; end
    else begin $display("[ADC_CAL_LUT_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_adc_cal_lut failed"); end
  end

  initial begin #2_000_000; $fatal(1, "tb_adc_cal_lut timeout"); end

endmodule
