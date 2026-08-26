// Block-level testbench for rtl/stream/chan_ctrl.sv.
//
// Drives pkt_done_i/crc_err_i/len_err_i directly (as pkt_check would) and
// checks the FSM lands in the state its own transition table promises for
// every edge listed in the module header - this is a state-machine block, so
// "exercise every state and every transition at least once" is the actual
// coverage goal, not a byte-count scoreboard the way the stream-packing
// blocks needed.
//
// Uses the posedge-monitor acceptance pattern for the one valid/ready
// channel here (beat_valid_i/beat_ready_o).
//
// Phases:
//   1. Idle -> Armed -> Idle (enable then disable, no packet)
//   2. Armed -> Running -> Armed (clean packet, still enabled)          - Done cause
//   3. Armed -> Running -> Idle (clean packet, disabled during it)
//   4. Armed -> Running -> Draining -> Idle (disabled mid-packet)
//   5. Running -> Error (crc_err_i at pkt_done_i), Error -> Idle (abort) - Crc cause
//   6. Draining -> Error (len_err_i at pkt_done_i), Error -> Idle (abort)- Err cause
//   7. hard abort mid-packet, from Running and from Draining
//   8. accept gating: no beats accepted in Idle or Error
//   9. ch_busy_o / ch_err_o track the state exactly as documented

module tb_chan_ctrl;
  import daq_pkg::*;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic ch_enable, ch_abort;
  logic in_valid, in_ready, in_sop, in_eop;
  logic [AxiDw-1:0] in_data;
  logic [AxiBw-1:0] in_strb;
  logic out_valid, out_ready, out_sop, out_eop;
  logic [AxiDw-1:0] out_data;
  logic [AxiBw-1:0] out_strb;
  logic pkt_done, crc_err, len_err;
  logic ch_busy, ch_err;
  logic [NumIrqCause-1:0] ch_cause;

  chan_ctrl dut (
    .clk_i (clk), .rst_ni (rst_n),
    .ch_enable_i (ch_enable), .ch_abort_i (ch_abort),
    .beat_valid_i (in_valid), .beat_ready_o (in_ready),
    .beat_data_i (in_data), .beat_strb_i (in_strb),
    .beat_sop_i (in_sop), .beat_eop_i (in_eop),
    .beat_valid_o (out_valid), .beat_ready_i (out_ready),
    .beat_data_o (out_data), .beat_strb_o (out_strb),
    .beat_sop_o (out_sop), .beat_eop_o (out_eop),
    .pkt_done_i (pkt_done), .crc_err_i (crc_err), .len_err_i (len_err),
    .ch_busy_o (ch_busy), .ch_err_o (ch_err), .ch_cause_o (ch_cause)
  );

  logic in_taken;
  always @(posedge clk) in_taken = in_valid & in_ready;

  int unsigned errors = 0;

  // ch_cause_o is gated by `accepting`, which is state_q-derived - and the
  // very packet completion that raises a cause bit is often also what moves
  // state_q on (Running -> Error, for instance) on that same edge. Reading
  // ch_cause_o procedurally after the fact (once signal_pkt_done's task has
  // returned, i.e. after that edge has already committed the new state)
  // reads the *new* state's accepting value, not the one the RTL actually
  // used to compute the pulse - so a check placed there can see 0 even
  // though the pulse was genuinely 1 for the one cycle that mattered. Latch
  // each cause combinationally-adjacent to the edge instead, the same
  // technique tb_chan_top.sv's done_cause_seen uses.
  bit [NumIrqCause-1:0] cause_seen;
  always @(posedge clk) if (rst_n) cause_seen |= ch_cause;

  // A beat accepted while forwarding (Armed/Running/Draining) must reach the
  // output side unchanged; a beat accepted while draining (Idle - see
  // chan_ctrl.sv's header) must be discarded, never forwarded. Either way
  // out_valid must never assert without a matching accepted beat.
  logic dut_forwarding;
  assign dut_forwarding = (dut.state_q == ChArmed) | (dut.state_q == ChRunning) | (dut.state_q == ChDraining);

  always @(posedge clk) begin
    if (rst_n && in_taken && dut_forwarding) begin
      if (out_valid !== 1'b1 || out_sop !== in_sop || out_eop !== in_eop ||
          out_data !== in_data || out_strb !== in_strb) begin
        $display("ERROR: accepted beat did not reach beat_*_o unchanged");
        errors++;
      end
    end else if (rst_n && in_taken && !dut_forwarding) begin
      if (out_valid !== 1'b0) begin
        $display("ERROR: a drained (non-forwarding) beat was forwarded anyway");
        errors++;
      end
    end else if (rst_n && out_valid) begin
      $display("ERROR: beat_valid_o set without a matching accepted beat");
      errors++;
    end
  end

  task automatic reset_dut();
    ch_enable = 0; ch_abort = 0;
    in_valid = 0; in_data = '0; in_strb = '0; in_sop = 0; in_eop = 0;
    out_ready = 1;
    pkt_done = 0; crc_err = 0; len_err = 0;
    rst_n = 1'b0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk);
  endtask

  task automatic check_state(input ch_state_e exp, input string label);
    if (dut.state_q !== exp) begin
      $display("ERROR: %s - state=%s expected %s", label, dut.state_q.name(), exp.name());
      errors++;
    end
  endtask

  task automatic check(input bit cond, input string label);
    if (!cond) begin $display("ERROR: %s", label); errors++; end
  endtask

  // Offers one beat and waits for it to be accepted (or not, if the caller
  // expects backpressure - see phase 8, which does not call this).
  task automatic send_beat(input bit sop, input bit eop);
    in_data = AxiDw'({$urandom, $urandom});
    in_strb = '1;
    in_sop = sop; in_eop = eop;
    in_valid = 1'b1;
    @(negedge clk);
    while (!in_taken) @(negedge clk);
    in_valid = 1'b0;
  endtask

  // Pulses pkt_done_i (and crc_err_i/len_err_i alongside it) for one cycle,
  // as pkt_check would the same cycle it accepts a packet's eop beat.
  task automatic signal_pkt_done(input bit bad_crc, input bit bad_len);
    pkt_done = 1'b1; crc_err = bad_crc; len_err = bad_len;
    @(negedge clk);
    pkt_done = 1'b0; crc_err = 1'b0; len_err = 1'b0;
  endtask

  initial begin
    reset_dut();
    check_state(ChIdle, "reset");
    check(!ch_busy && !ch_err, "reset: busy/err both clear");

    // ---- phase 1: Idle -> Armed -> Idle, no packet ---------------------------
    ch_enable = 1'b1;
    @(negedge clk);
    check_state(ChArmed, "phase1: enable -> Armed");
    check(in_ready === 1'b1, "phase1: Armed accepts (ready high)");
    ch_enable = 1'b0;
    @(negedge clk);
    check_state(ChIdle, "phase1: disable while Armed -> Idle");

    // ---- phase 2: Armed -> Running -> Armed, clean packet --------------------
    ch_enable = 1'b1;
    @(negedge clk);
    check_state(ChArmed, "phase2: re-enable -> Armed");
    send_beat(1'b1, 1'b0);
    check_state(ChRunning, "phase2: sop accepted -> Running");
    check(ch_busy === 1'b1, "phase2: busy during Running");
    cause_seen = '0;
    send_beat(1'b0, 1'b1);
    signal_pkt_done(1'b0, 1'b0);
    check_state(ChArmed, "phase2: clean pkt_done, still enabled -> Armed");
    check(cause_seen[IrqCauseDone] === 1'b1, "phase2: Done cause pulsed");
    check(ch_busy === 1'b0, "phase2: busy clears back in Armed");

    // ---- phase 3: Armed -> Running -> Idle, disabled exactly at pkt_done -----
    send_beat(1'b1, 1'b1);  // single-beat packet
    ch_enable = 1'b0;       // drop enable the same cycle pkt_done arrives
    signal_pkt_done(1'b0, 1'b0);
    check_state(ChIdle, "phase3: clean pkt_done, disabled -> Idle");

    // ---- phase 4: Armed -> Running -> Draining -> Idle ------------------------
    ch_enable = 1'b1;
    @(negedge clk);
    send_beat(1'b1, 1'b0);
    check_state(ChRunning, "phase4: sop accepted -> Running");
    ch_enable = 1'b0;
    @(negedge clk);
    check_state(ChDraining, "phase4: disabled mid-packet -> Draining");
    check(in_ready === 1'b1, "phase4: Draining still accepts the in-flight packet");
    send_beat(1'b0, 1'b1);
    signal_pkt_done(1'b0, 1'b0);
    check_state(ChIdle, "phase4: clean pkt_done while Draining -> Idle");

    // ---- phase 5: Running -> Error (crc), Error -> Idle (abort) --------------
    ch_enable = 1'b1;
    @(negedge clk);
    cause_seen = '0;
    send_beat(1'b1, 1'b1);
    signal_pkt_done(1'b1, 1'b0);  // crc_err
    check_state(ChError, "phase5: crc_err at pkt_done -> Error");
    check(ch_err === 1'b1, "phase5: ch_err_o set in Error");
    check(cause_seen[IrqCauseCrc] === 1'b1, "phase5: Crc cause pulsed");
    check(in_ready === 1'b0, "phase5: Error does not accept");
    ch_abort = 1'b1;
    @(negedge clk);
    ch_abort = 1'b0;
    check_state(ChIdle, "phase5: abort clears Error -> Idle");
    check(ch_err === 1'b0, "phase5: ch_err_o clears with the state");

    // ---- phase 6: Draining -> Error (len), Error -> Idle (abort) -------------
    ch_enable = 1'b1;
    @(negedge clk);
    send_beat(1'b1, 1'b0);
    ch_enable = 1'b0;
    @(negedge clk);
    check_state(ChDraining, "phase6: disabled mid-packet -> Draining");
    cause_seen = '0;
    send_beat(1'b0, 1'b1);
    signal_pkt_done(1'b0, 1'b1);  // len_err
    check_state(ChError, "phase6: len_err at pkt_done while Draining -> Error");
    check(cause_seen[IrqCauseErr] === 1'b1, "phase6: Err cause pulsed for len_err");
    ch_abort = 1'b1;
    @(negedge clk);
    ch_abort = 1'b0;
    check_state(ChIdle, "phase6: abort clears Error -> Idle");

    // ---- phase 7: hard abort mid-packet, from Running and from Draining ------
    ch_enable = 1'b1;
    @(negedge clk);
    send_beat(1'b1, 1'b0);
    check_state(ChRunning, "phase7a: sop accepted -> Running");
    ch_abort = 1'b1;
    @(negedge clk);
    ch_abort = 1'b0;
    check_state(ChIdle, "phase7a: abort mid-Running -> Idle (packet abandoned)");

    ch_enable = 1'b1;
    @(negedge clk);
    send_beat(1'b1, 1'b0);
    ch_enable = 1'b0;
    @(negedge clk);
    check_state(ChDraining, "phase7b: disabled mid-packet -> Draining");
    ch_abort = 1'b1;
    @(negedge clk);
    ch_abort = 1'b0;
    check_state(ChIdle, "phase7b: abort mid-Draining -> Idle (packet abandoned)");

    // ---- phase 8: Idle drains and discards; Error refuses outright -----------
    // Idle does not refuse a beat outright - it accepts and discards it (see
    // chan_ctrl.sv's header for why: leftover bytes from an abandoned
    // session must not survive to be misread as the next session's sop).
    // What Idle must never do is forward one: out_valid must stay low
    // throughout, however many beats it drains.
    check_state(ChIdle, "phase8: precondition Idle");
    in_valid = 1'b1; in_sop = 1'b1; in_eop = 1'b1; in_data = '0; in_strb = '1;
    repeat (3) @(negedge clk);
    check(in_taken === 1'b1, "phase8: Idle drains (accepts) a stale beat");
    check(out_valid === 1'b0, "phase8: Idle never forwards what it drains");
    in_valid = 1'b0;

    ch_enable = 1'b1;
    @(negedge clk);
    send_beat(1'b1, 1'b1);
    signal_pkt_done(1'b1, 1'b0);
    check_state(ChError, "phase8: precondition Error");
    in_valid = 1'b1; in_sop = 1'b1; in_eop = 1'b1;
    repeat (3) @(negedge clk);
    check(in_taken === 1'b0, "phase8: Error refuses a beat");
    in_valid = 1'b0;
    ch_abort = 1'b1;
    @(negedge clk);
    ch_abort = 1'b0;
    check_state(ChIdle, "phase8: cleanup abort -> Idle");
    ch_enable = 1'b0;
    @(negedge clk);

    $display("");
    if (errors == 0) begin $display("[CHAN_CTRL_TB] PASS"); $finish; end
    else begin $display("[CHAN_CTRL_TB] FAIL: %0d error(s)", errors); $fatal(1, "tb_chan_ctrl failed"); end
  end

  initial begin #1_000_000; $fatal(1, "tb_chan_ctrl timeout"); end

endmodule
