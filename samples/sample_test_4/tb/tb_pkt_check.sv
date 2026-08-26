// Block-level testbench for rtl/stream/pkt_check.sv.
//
// A real CRC-32 (standard IEEE 802.3 / zlib form: init 0xFFFFFFFF, output
// inverted) is computed here for every packet, so this TB can distinguish
// good packets from genuinely corrupted ones rather than just checking
// passthrough. software_crc32() is an independent byte-at-a-time model, not
// a copy of pkt_check's RTL - if the two disagreed, a bug in the DUT and a
// bug in this reference model could still happen to cancel out, but they
// would have to share nothing to do it. This independence is what caught the
// DUT's first version: it reused prim_crc32, which processes a fixed byte
// count every cycle regardless of strobes, so every packet needing a partial
// last beat came back with a CRC computed over real payload plus padding -
// wrong. See pkt_check.sv's header for the fix (a small byte-enable-aware
// CRC core, written fresh rather than force-fitting the reused prim).
//
// Uses the same posedge-monitor acceptance pattern as tb_pkt_align.sv/
// tb_axil_slave.sv for every valid/ready channel.
//
// Phases:
//   1. one full beat, correct CRC and length                    - PASS
//   2. multi-beat with partial last beat, correct CRC            - PASS
//   3. corrupted CRC (trailer flipped)                            - crc_err_o
//   4. zero-length packet (eop on the byte that would be byte 0)  - len_err_o
//   5. back-to-back packets, no gap
//   6. randomised lengths, randomised backpressure on both sides, mixed
//      good/bad CRC, scoreboarded

module tb_pkt_check;
  import daq_pkg::*;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic                 in_valid, in_ready, in_sop, in_eop;
  logic [AxiDw-1:0]      in_data;
  logic [AxiBw-1:0]      in_strb;
  logic [31:0]            in_crc;

  logic                 out_valid, out_ready, out_sop, out_eop;
  logic [AxiDw-1:0]      out_data;
  logic [AxiBw-1:0]      out_strb;

  logic pkt_done, crc_err, len_err;

  pkt_check dut (
    .clk_i (clk), .rst_ni (rst_n),
    .beat_valid_i (in_valid), .beat_ready_o (in_ready),
    .beat_data_i (in_data), .beat_strb_i (in_strb),
    .beat_sop_i (in_sop), .beat_eop_i (in_eop), .beat_crc_i (in_crc),
    .beat_valid_o (out_valid), .beat_ready_i (out_ready),
    .beat_data_o (out_data), .beat_strb_o (out_strb),
    .beat_sop_o (out_sop), .beat_eop_o (out_eop),
    .pkt_done_o (pkt_done), .crc_err_o (crc_err), .len_err_o (len_err)
  );

  // ---- acceptance monitors (posedge, pre-NBA) --------------------------------
  logic in_taken, out_taken;
  always @(posedge clk) begin
    in_taken  = in_valid  & in_ready;
    out_taken = out_valid & out_ready;
  end

  int unsigned errors = 0;

  // ---- reference CRC-32 model (independent of prim_crc32's RTL) -------------
  // IEEE 802.3 / zlib CRC-32: init 0xFFFFFFFF, poly 0xEDB88320 (reflected),
  // final XOR 0xFFFFFFFF. This is the standard the reused prim_crc32's own
  // header comment says it matches ("results match ... e.g. the crc32
  // functionality available in Python").
  function automatic logic [31:0] crc32_update(input logic [31:0] crc, input logic [7:0] b);
    automatic logic [31:0] c = crc ^ {24'h0, b};
    for (int unsigned k = 0; k < 8; k++) begin
      c = (c[0]) ? ((c >> 1) ^ 32'hEDB8_8320) : (c >> 1);
    end
    crc32_update = c;
  endfunction

  function automatic logic [31:0] software_crc32(input logic [7:0] bytes_q[$]);
    automatic logic [31:0] c = 32'hFFFF_FFFF;
    foreach (bytes_q[i]) c = crc32_update(c, bytes_q[i]);
    software_crc32 = c ^ 32'hFFFF_FFFF;
  endfunction

  // ---- beat -> byte unpacking on the output side, for scoreboarding ----------
  logic [7:0] got_bytes [$];
  logic [31:0] got_crc_err_q [$];  // one bit per packet observed (0/1), in order
  logic [31:0] got_len_err_q [$];
  bit          out_in_pkt;        // have we seen this packet's sop on the output side yet?

  always @(posedge clk) begin
    if (rst_n && out_taken) begin
      if (!out_in_pkt && !out_sop) begin
        $display("ERROR: first passthrough beat of a packet did not carry sop"); errors++;
      end
      if (out_in_pkt && out_sop) begin
        $display("ERROR: sop set on a non-first passthrough beat"); errors++;
      end
      out_in_pkt = out_eop ? 1'b0 : 1'b1;
      for (int unsigned i = 0; i < AxiBw; i++) begin
        if (out_strb[i]) got_bytes.push_back(out_data[i*8+:8]);
      end
    end
    if (rst_n && pkt_done) begin
      got_crc_err_q.push_back(32'(crc_err));
      got_len_err_q.push_back(32'(len_err));
    end
  end

  // ---- drivers -----------------------------------------------------------------
  task automatic reset_dut();
    in_valid = 0; in_data = '0; in_strb = '0; in_sop = 0; in_eop = 0; in_crc = '0;
    out_ready = 0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  logic [7:0] exp_crc_err_q [$];
  logic [7:0] exp_len_err_q [$];

  // Sends one beat of the packed-beat protocol. `bytes` is the payload for
  // this beat (<=AxiBw entries); strobe covers exactly bytes.size() lanes
  // from lane 0, matching what pkt_align always produces.
  task automatic send_beat(input logic [7:0] bytes[], input bit sop, input bit eop, input logic [31:0] crc);
    // Unstrobed lanes are garbage, not zero: pkt_align always zero-fills
    // them, but pkt_check's masking is documented as not relying on that,
    // and a TB that only ever offers already-zeroed padding cannot tell the
    // difference between "masking works" and "masking was never exercised".
    automatic logic [AxiDw-1:0] d = AxiDw'({$urandom, $urandom});
    automatic logic [AxiBw-1:0] s = '0;
    for (int unsigned i = 0; i < bytes.size(); i++) begin
      d[i*8+:8] = bytes[i];
      s[i] = 1'b1;
    end
    in_data = d; in_strb = s; in_sop = sop; in_eop = eop; in_crc = crc;
    in_valid = 1'b1;
    @(negedge clk);
    while (!in_taken) @(negedge clk);
    in_valid = 1'b0;
  endtask

  // Sends a whole packet, split into AxiBw-sized beats (last one partial if
  // needed), with either the correct CRC or a deliberately wrong one.
  task automatic send_packet(input int unsigned len, input bit bad_crc);
    automatic logic [7:0] all_bytes[$];
    automatic logic [31:0] crc;
    for (int unsigned i = 0; i < len; i++) all_bytes.push_back(8'(exp_len_err_q.size() * 37 + i + 1));
    crc = software_crc32(all_bytes);
    if (bad_crc) crc = crc ^ 32'h0000_0001;

    for (int unsigned off = 0; off < len; off += AxiBw) begin
      automatic int unsigned n = (len - off < AxiBw) ? (len - off) : AxiBw;
      automatic logic [7:0] chunk[] = new[n];
      for (int unsigned i = 0; i < n; i++) chunk[i] = all_bytes[off + i];
      send_beat(chunk, off == 0, (off + n) == len, crc);
    end
    exp_crc_err_q.push_back(8'(bad_crc));
    exp_len_err_q.push_back(8'((len == 0) || (len > MaxPacketBytes)));
  endtask

  initial begin
    reset_dut();
    out_ready = 1'b1;

    // ---- phase 1: one full beat, good CRC ------------------------------------
    send_packet(AxiBw, 1'b0);

    // ---- phase 2: multi-beat, partial last beat, good CRC --------------------
    send_packet(AxiBw * 2 + 3, 1'b0);

    // ---- phase 3: corrupted CRC ------------------------------------------------
    send_packet(AxiBw + 5, 1'b1);

    // ---- phase 4: zero-length packet (eop with no bytes) ----------------------
    begin
      automatic logic [7:0] empty_beat[] = new[0];
      send_beat(empty_beat, 1'b1, 1'b1, software_crc32('{}));
      exp_crc_err_q.push_back(8'b0);
      exp_len_err_q.push_back(8'b1);
    end

    // ---- phase 5: back-to-back packets, no gap ---------------------------------
    fork
      begin
        send_packet(3, 1'b0);
        send_packet(AxiBw, 1'b1);
        send_packet(2, 1'b0);
      end
    join
    @(negedge clk);
    while (got_crc_err_q.size() < exp_crc_err_q.size()) @(negedge clk);

    // ---- phase 6: randomised lengths/CRC + backpressure on both sides ---------
    for (int unsigned p = 0; p < 10; p++) begin
      automatic int unsigned len = $urandom_range(0, AxiBw * 3 + 5);
      automatic bit bad = ($urandom_range(0, 99) < 30);
      automatic bit send_done = 1'b0;
      fork
        begin
          send_packet(len, bad);
          send_done = 1'b1;
        end
        begin
          while (!send_done) begin
            out_ready = ($urandom_range(0, 99) < 70);
            @(negedge clk);
          end
          out_ready = 1'b1;
        end
      join
      while (got_crc_err_q.size() < exp_crc_err_q.size()) @(negedge clk);
    end

    // ---- scoreboard --------------------------------------------------------------
    if (got_crc_err_q.size() != exp_crc_err_q.size()) begin
      $display("ERROR: packet count mismatch, got %0d expected %0d", got_crc_err_q.size(), exp_crc_err_q.size());
      errors++;
    end else begin
      for (int unsigned i = 0; i < exp_crc_err_q.size(); i++) begin
        if (got_crc_err_q[i] !== 32'(exp_crc_err_q[i])) begin
          $display("ERROR: packet %0d crc_err got %0d expected %0d", i, got_crc_err_q[i], exp_crc_err_q[i]);
          errors++;
        end
        if (got_len_err_q[i] !== 32'(exp_len_err_q[i])) begin
          $display("ERROR: packet %0d len_err got %0d expected %0d", i, got_len_err_q[i], exp_len_err_q[i]);
          errors++;
        end
      end
    end

    $display("");
    $display("[PKT_CHECK_TB] packets=%0d", exp_crc_err_q.size());
    if (errors == 0) begin $display("[PKT_CHECK_TB] PASS"); $finish; end
    else begin $display("[PKT_CHECK_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_pkt_check failed"); end
  end

  initial begin #4_000_000; $fatal(1, "tb_pkt_check timeout"); end

endmodule
