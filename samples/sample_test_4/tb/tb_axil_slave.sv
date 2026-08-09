// Block-level testbench for rtl/csr/axil_slave.sv (protocol only - regbus
// backend is a small scoreboard model here, not daq_csr; that combination is
// covered end-to-end by tb_daq_csr.sv).
//
// The backend model is a 4-entry byte-addressable memory with one
// deliberately unmapped hole, driven combinationally exactly as axil_slave's
// design comment requires: reg_rdata_o/reg_error_o must be valid in the same
// cycle reg_valid_o is asserted.
//
// Phases:
//   1. AW/W arriving together - the common case, one cycle latency to BVALID
//   2. AW before W, then W before AR - proves independent per-channel capture
//   3. write to the unmapped hole - DECERR
//   4. random valid/ready toggling on all five channels, scoreboarded

module tb_axil_slave;

  localparam int unsigned Aw = 8;
  localparam int unsigned Dw = 32;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic [Aw-1:0]     awaddr;  logic awvalid, awready;
  logic [Dw-1:0]      wdata;  logic [(Dw/8)-1:0] wstrb; logic wvalid, wready;
  logic [1:0]         bresp;  logic bvalid, bready;
  logic [Aw-1:0]     araddr;  logic arvalid, arready;
  logic [Dw-1:0]      rdata;  logic [1:0] rresp; logic rvalid, rready;

  logic                reg_valid, reg_write;
  logic [Aw-1:0]        reg_addr;
  logic [Dw-1:0]         reg_wdata;
  logic [(Dw/8)-1:0]      reg_wstrb;
  logic [Dw-1:0]           reg_rdata;
  logic                     reg_error;

  axil_slave #(.Aw(Aw), .Dw(Dw)) dut (
    .clk_i (clk), .rst_ni (rst_n),
    .awaddr_i (awaddr), .awvalid_i (awvalid), .awready_o (awready),
    .wdata_i  (wdata),  .wstrb_i (wstrb), .wvalid_i (wvalid), .wready_o (wready),
    .bresp_o  (bresp),  .bvalid_o (bvalid), .bready_i (bready),
    .araddr_i (araddr), .arvalid_i (arvalid), .arready_o (arready),
    .rdata_o  (rdata),  .rresp_o (rresp), .rvalid_o (rvalid), .rready_i (rready),
    .reg_valid_o (reg_valid), .reg_write_o (reg_write), .reg_addr_o (reg_addr),
    .reg_wdata_o (reg_wdata), .reg_wstrb_o (reg_wstrb),
    .reg_rdata_i (reg_rdata), .reg_error_i (reg_error)
  );

  // ---- regbus backend model: 4 words at 0x00/0x04/0x08/0x0C, 0x10 unmapped -
  logic [Dw-1:0] mem [4];
  logic          mem_hit;
  logic [1:0]    mem_idx;
  assign mem_hit = (reg_addr[7:2] < 4) && (reg_addr[1:0] == 2'b00);
  assign mem_idx  = reg_addr[3:2];
  assign reg_error = reg_valid & ~mem_hit;
  assign reg_rdata = mem_hit ? mem[mem_idx] : '0;

  int unsigned errors = 0;
  logic [Dw-1:0] shadow [4];  // scoreboard's own copy, updated the same way

  // "Was this channel's handshake accepted at the edge that just happened?"
  // sampled inside a posedge-triggered block, exactly like tb_skid_buffer's
  // offer_taken. This is required, not a style choice: awready/wready/arready
  // are combinational functions of the FSM state and drop on the SAME edge
  // that accepts a transfer (the state leaves Idle that instant), so a
  // negedge-driven testbench that re-reads them afterwards sees them already
  // low and never observes the acceptance at all. An earlier version of this
  // TB polled the raw signals directly: it correctly detected acceptance one
  // extra cycle later than it should have (by which point the response had
  // already been driven and, since BREADY was already held high, silently
  // consumed) - and then hung forever waiting for a second BVALID pulse that
  // was never coming. bvalid/rvalid do not have this problem (they stay
  // asserted for one full clock period once raised), but the four *_taken
  // signals below are computed uniformly for all five channels so nothing
  // here depends on that asymmetry holding forever if the DUT changes.
  logic aw_taken, w_taken, ar_taken, b_taken, r_taken;
  always @(posedge clk) begin
    aw_taken = awvalid & awready;
    w_taken  = wvalid  & wready;
    ar_taken = arvalid & arready;
    b_taken  = bvalid  & bready;
    r_taken  = rvalid  & rready;
  end

  always @(posedge clk) begin
    if (rst_n) begin
      if (reg_valid & reg_write & mem_hit) begin
        automatic logic [Dw-1:0] nxt;
        nxt = mem[mem_idx];
        for (int unsigned i = 0; i < 4; i++) if (reg_wstrb[i]) nxt[i*8+:8] = reg_wdata[i*8+:8];
        mem[mem_idx]    <= nxt;
        shadow[mem_idx] <= nxt;
      end
    end
  end

  initial begin mem[0]='0; mem[1]='0; mem[2]='0; mem[3]='0;
                shadow[0]='0; shadow[1]='0; shadow[2]='0; shadow[3]='0; end

  // ---- drivers --------------------------------------------------------------
  task automatic reset_dut();
    awvalid=0; awaddr='0; wvalid=0; wdata='0; wstrb='0; bready=0;
    arvalid=0; araddr='0; rready=0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  // Drives just the AW channel, waits for it to be taken, and leaves AWVALID
  // low afterwards. Used both by write_together (which drives AW/W the same
  // cycle) and phase 2's independent-capture sequencing (which drives them
  // cycles apart).
  task automatic drive_aw(input logic [Aw-1:0] a);
    awaddr = a; awvalid = 1'b1;
    do @(negedge clk); while (!aw_taken);
    awvalid = 1'b0;
  endtask

  task automatic drive_w(input logic [Dw-1:0] d, input logic [(Dw/8)-1:0] s);
    wdata = d; wstrb = s; wvalid = 1'b1;
    do @(negedge clk); while (!w_taken);
    wvalid = 1'b0;
  endtask

  task automatic wait_b(output logic [1:0] resp);
    bready = 1'b1;
    do @(negedge clk); while (!b_taken);
    resp = bresp;
    bready = 1'b0;
  endtask

  // AW and W driven the same cycle - the common case, one cycle to BVALID.
  task automatic write_together(input logic [Aw-1:0] a, input logic [Dw-1:0] d,
                                 input logic [(Dw/8)-1:0] s, output logic [1:0] resp);
    awaddr = a; awvalid = 1'b1;
    wdata  = d; wstrb = s; wvalid = 1'b1;
    bready = 1'b1;
    do @(negedge clk); while (!aw_taken);
    awvalid = 1'b0;
    if (!w_taken) begin
      do @(negedge clk); while (!w_taken);
    end
    wvalid = 1'b0;
    if (!b_taken) begin
      do @(negedge clk); while (!b_taken);
    end
    resp = bresp;
    bready = 1'b0;
  endtask

  task automatic read_one(input logic [Aw-1:0] a, output logic [Dw-1:0] d, output logic [1:0] resp);
    araddr = a; arvalid = 1'b1; rready = 1'b1;
    do @(negedge clk); while (!ar_taken);
    arvalid = 1'b0;
    if (!r_taken) begin
      do @(negedge clk); while (!r_taken);
    end
    d = rdata; resp = rresp;
    rready = 1'b0;
  endtask

  initial begin
    logic [Dw-1:0] rd; logic [1:0] resp;

    reset_dut();

    // ---- phase 1: AW/W together, then readback -----------------------------
    write_together(8'h00, 32'hCAFEBABE, 4'hF, resp);
    if (resp !== 2'b00) begin $display("ERROR: phase1 write got resp=%0d, expected OKAY", resp); errors++; end
    read_one(8'h00, rd, resp);
    if (rd !== 32'hCAFEBABE || resp !== 2'b00) begin
      $display("ERROR: phase1 readback got %0h/%0d", rd, resp); errors++;
    end

    // ---- phase 2: AW then (gap) then W, independent capture -----------------
    drive_aw(8'h04);
    repeat (3) @(negedge clk);              // AW captured, W not offered yet
    drive_w(32'h1234_5678, 4'hF);
    wait_b(resp);
    if (resp !== 2'b00) begin $display("ERROR: phase2 write got resp=%0d", resp); errors++; end
    read_one(8'h04, rd, resp);
    if (rd !== 32'h1234_5678) begin $display("ERROR: phase2 readback got %0h", rd); errors++; end

    // W arriving before AW - the other capture order.
    drive_w(32'h0BAD_F00D, 4'hF);
    repeat (3) @(negedge clk);
    drive_aw(8'h08);
    wait_b(resp);
    if (resp !== 2'b00) begin $display("ERROR: phase2b write got resp=%0d", resp); errors++; end
    read_one(8'h08, rd, resp);
    if (rd !== 32'h0BAD_F00D) begin $display("ERROR: phase2b readback got %0h", rd); errors++; end

    // ---- phase 2c: AW+W and AR all pending the same idle cycle --------------
    // A read presented alongside a write must not jump the queue: fixed
    // priority gives the write the bus first. Both channels' *_taken monitors
    // fire on the edge each is captured regardless of who is issued (AR is
    // accepted into arcap_q even while blocked by write priority - see
    // axil_slave.sv's design comment), so "who won" is only observable by
    // which response - BVALID or RVALID - comes back first, not by the AW/AR
    // accept edges themselves.
    begin
      logic b_seen, r_seen, write_won;
      b_seen = 1'b0; r_seen = 1'b0; write_won = 1'b0;
      awaddr = 8'h00; awvalid = 1'b1;
      wdata  = 32'hFEED_0002; wstrb = 4'hF; wvalid = 1'b1;
      araddr = 8'h04; arvalid = 1'b1;
      bready = 1'b1; rready = 1'b1;
      do begin
        @(negedge clk);
        if (aw_taken) awvalid = 1'b0;
        if (w_taken)  wvalid  = 1'b0;
        if (ar_taken) arvalid = 1'b0;
        if (b_taken && !b_seen && !r_seen) write_won = 1'b1;
        if (b_taken) begin b_seen = 1'b1; bready = 1'b0; end
        if (r_taken) begin r_seen = 1'b1; rready = 1'b0; end
      end while (!b_seen || !r_seen);
      if (!write_won) begin
        $display("ERROR: read's RVALID arrived before the contending write's BVALID - write did not win priority");
        errors++;
      end
    end

    // ---- phase 3: unmapped address -> DECERR --------------------------------
    write_together(8'h10, 32'hFFFF_FFFF, 4'hF, resp);
    if (resp !== 2'b11) begin $display("ERROR: unmapped write got resp=%0d, expected DECERR", resp); errors++; end
    read_one(8'h10, rd, resp);
    if (resp !== 2'b11) begin $display("ERROR: unmapped read got resp=%0d, expected DECERR", resp); errors++; end

    // Byte-strobe partial write: only bytes 0 and 2 of word 0x0C.
    write_together(8'h0C, 32'h1111_1111, 4'hF, resp);
    write_together(8'h0C, 32'hAAAA_AAAA, 4'h5, resp);
    read_one(8'h0C, rd, resp);
    if (rd !== 32'h11AA_11AA) begin
      $display("ERROR: byte-strobe write got %0h, expected 11aa11aa", rd); errors++;
    end

    // ---- phase 4: randomised, five addresses (four mapped, one not) --------
    for (int unsigned i = 0; i < 400; i++) begin
      automatic logic [Aw-1:0] a = Aw'($urandom_range(0,4) * 4);
      automatic logic [Dw-1:0] d = $urandom;
      automatic logic [(Dw/8)-1:0] s = (Dw/8)'($urandom_range(1,15));
      automatic logic [1:0] r;
      if ($urandom_range(0,1) == 1) begin
        write_together(a, d, s, r);
        if (a == 8'h10) begin
          if (r !== 2'b11) begin $display("ERROR: rand write to hole got resp=%0d", r); errors++; end
        end else begin
          if (r !== 2'b00) begin $display("ERROR: rand write to %0h got resp=%0d", a, r); errors++; end
        end
      end else begin
        read_one(a, d, r);
        if (a == 8'h10) begin
          if (r !== 2'b11) begin $display("ERROR: rand read from hole got resp=%0d", r); errors++; end
        end else begin
          if (r !== 2'b00 || d !== shadow[a[3:2]]) begin
            $display("ERROR: rand read %0h got %0h/%0d, expected %0h/OKAY", a, d, r, shadow[a[3:2]]);
            errors++;
          end
        end
      end
    end

    $display("");
    if (errors == 0) begin $display("[AXIL_TB] PASS"); $finish; end
    else begin $display("[AXIL_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_axil_slave failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_axil_slave timeout"); end

endmodule
