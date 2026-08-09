package prim_fifo_sync_uvm_pkg;
  import uvm_pkg::*;
  `include "uvm_macros.svh"

  typedef enum bit [2:0] {FIFO_RESET, FIFO_PUSH, FIFO_POP, FIFO_PUSH_NEG, FIFO_POP_NEG} fifo_op_e;

  class fifo_item extends uvm_sequence_item;
    rand fifo_op_e op;
    rand bit [7:0] data;
    `uvm_object_utils_begin(fifo_item)
      `uvm_field_enum(fifo_op_e, op, UVM_DEFAULT)
      `uvm_field_int(data, UVM_DEFAULT)
    `uvm_object_utils_end
    function new(string name="fifo_item"); super.new(name); endfunction
  endclass

  class fifo_smoke_seq extends uvm_sequence #(fifo_item);
    `uvm_object_utils(fifo_smoke_seq)
    function new(string name="fifo_smoke_seq"); super.new(name); endfunction
    task body();
      fifo_item tr;
      tr=fifo_item::type_id::create("push_0"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h3c; finish_item(tr);
      tr=fifo_item::type_id::create("push_1"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'ha5; finish_item(tr);
      tr=fifo_item::type_id::create("push_2"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h5a; finish_item(tr);
      tr=fifo_item::type_id::create("pop_0"); start_item(tr); tr.op=FIFO_POP; tr.data='0; finish_item(tr);
      tr=fifo_item::type_id::create("pop_1"); start_item(tr); tr.op=FIFO_POP; tr.data='0; finish_item(tr);
      tr=fifo_item::type_id::create("pop_2"); start_item(tr); tr.op=FIFO_POP; tr.data='0; finish_item(tr);
    endtask
  endclass

  class fifo_fill_drain_seq extends uvm_sequence #(fifo_item);
    `uvm_object_utils(fifo_fill_drain_seq)
    function new(string name="fifo_fill_drain_seq"); super.new(name); endfunction
    task body();
      fifo_item tr;
      tr=fifo_item::type_id::create("fill_0"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h11; finish_item(tr);
      tr=fifo_item::type_id::create("fill_1"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h22; finish_item(tr);
      tr=fifo_item::type_id::create("fill_2"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h33; finish_item(tr);
      tr=fifo_item::type_id::create("fill_3"); start_item(tr); tr.op=FIFO_PUSH; tr.data=8'h44; finish_item(tr);
      repeat (4) begin tr=fifo_item::type_id::create("drain"); start_item(tr); tr.op=FIFO_POP; tr.data='0; finish_item(tr); end
    endtask
  endclass

  // REQ-FIFO-005: reject paths. Fills to full and attempts one more push
  // (must be rejected, not silently accepted/overflowed), then drains to
  // empty and attempts one more pop (must be rejected, not silently valid).
  // FIFO_PUSH_NEG/FIFO_POP_NEG are handled by a dedicated driver branch that
  // treats "DUT correctly refuses" as success and only raises uvm_error if
  // the DUT accepts the push or shows valid data while empty.
  class fifo_negative_seq extends uvm_sequence #(fifo_item);
    `uvm_object_utils(fifo_negative_seq)
    function new(string name="fifo_negative_seq"); super.new(name); endfunction
    task body();
      fifo_item tr;
      for (int unsigned i = 0; i < 4; i++) begin
        tr=fifo_item::type_id::create($sformatf("neg_fill_%0d", i));
        start_item(tr); tr.op=FIFO_PUSH; tr.data=8'hc0 + i[7:0]; finish_item(tr);
      end
      tr=fifo_item::type_id::create("neg_push_at_full"); start_item(tr); tr.op=FIFO_PUSH_NEG; tr.data=8'hde; finish_item(tr);
      repeat (4) begin tr=fifo_item::type_id::create("neg_drain"); start_item(tr); tr.op=FIFO_POP; tr.data='0; finish_item(tr); end
      tr=fifo_item::type_id::create("neg_pop_at_empty"); start_item(tr); tr.op=FIFO_POP_NEG; tr.data='0; finish_item(tr);
    endtask
  endclass

  // Constrained-random traffic. fifo_item declares `rand op`/`rand data` for
  // interface completeness, but this sequence deliberately does NOT call
  // item.randomize()/with{}: Verilator's constraint solver shells out to an
  // external SAT/SMT process (z3/boolector/etc, see VERILATOR_SOLVER), and on
  // this Windows+MinGW build that handshake fails even when the solver binary
  // is pointed to directly ("Unable to communicate with SAT solver") - a
  // known class of Windows popen/pipe issue, not something fixable from this
  // repo. $urandom/$urandom_range need no external process and give the same
  // "genuinely randomized op/data per item" result. An unconstrained op
  // sequence could still request an illegal pop-at-empty/push-at-full at any
  // point, which fifo_driver's plain FIFO_PUSH/FIFO_POP branches treat as a
  // bug (that's what the negative sequence above is for, driven
  // deliberately) - so this sequence keeps a local shadow of depth and picks
  // only legal ops from it, while data and the push/pop mix in the middle of
  // the range are genuinely randomized per item.
  class fifo_random_seq extends uvm_sequence #(fifo_item);
    `uvm_object_utils(fifo_random_seq)
    function new(string name="fifo_random_seq"); super.new(name); endfunction
    task body();
      fifo_item tr;
      int unsigned depth = 0;
      int unsigned num_items = 16 + $urandom_range(8); // 16..24
      repeat (num_items) begin
        tr = fifo_item::type_id::create("rand_tr");
        start_item(tr);
        if (depth == 0) tr.op = FIFO_PUSH;
        else if (depth == 4) tr.op = FIFO_POP;
        else tr.op = $urandom_range(1) ? FIFO_PUSH : FIFO_POP;
        tr.data = 8'($urandom_range(255));
        finish_item(tr);
        if (tr.op == FIFO_PUSH) depth++; else depth--;
      end
      // Drain back to empty so the scoreboard's reference queue and the
      // depth-tracking checks in fifo_driver both close out cleanly.
      while (depth > 0) begin
        tr = fifo_item::type_id::create("rand_drain");
        start_item(tr); tr.op = FIFO_POP; tr.data = '0; finish_item(tr);
        depth--;
      end
    endtask
  endclass

  class fifo_driver extends uvm_driver #(fifo_item);
    virtual prim_fifo_sync_if vif;
    uvm_analysis_port #(fifo_item) result_ap;
    int unsigned expected_depth;

    // Functional coverage: op type crossed with the resulting depth bucket
    // (empty / mid / full). Verilator 5.051 cannot parse a `covergroup`
    // declared inside a class when referenced as another member's data type
    // ("Expecting a data type" — confirmed with a minimal standalone repro;
    // the same covergroup works fine at module scope). A plain hit-count
    // matrix gives the same bin-coverage information without hitting that
    // limitation.
    typedef enum { DEPTH_EMPTY, DEPTH_MID, DEPTH_FULL } depth_bucket_e;
    int unsigned cov_hits[fifo_op_e][depth_bucket_e];
    function depth_bucket_e depth_bucket(int unsigned depth_after);
      if (depth_after == 0) return DEPTH_EMPTY;
      if (depth_after == 4) return DEPTH_FULL;
      return DEPTH_MID;
    endfunction
    function void cov_sample(fifo_op_e op, int unsigned depth_after);
      cov_hits[op][depth_bucket(depth_after)] = cov_hits[op][depth_bucket(depth_after)] + 1;
    endfunction

    // REQ-FIFO-005 reject-path coverage: how many times the negative sequence
    // actually exercised "attempt push while full" / "attempt pop while
    // empty" and the DUT correctly refused it.
    int unsigned neg_full_reject_hits, neg_empty_reject_hits;

    `uvm_component_utils(fifo_driver)
    function new(string name, uvm_component parent); super.new(name,parent); result_ap=new("result_ap",this); endfunction
    function void build_phase(uvm_phase phase);
      super.build_phase(phase);
      if(!uvm_config_db#(virtual prim_fifo_sync_if)::get(this,"","vif",vif)) `uvm_fatal("NOVIF","virtual interface missing")
    endfunction
    task reset_dut();
      vif.wvalid_i<=0; vif.rready_i<=0; vif.wdata_i<=0; vif.clr_i<=0; vif.rst_ni<=0;
      repeat(2) @(posedge vif.clk_i); vif.rst_ni<=1; repeat(2) @(posedge vif.clk_i); #1;
      expected_depth=0;
      if(vif.depth_o!==0 || vif.rvalid_o!==0) `uvm_error("REQ-FIFO-001","reset state is not empty")
    endtask
    task run_phase(uvm_phase phase);
      fifo_item req, observed;
      reset_dut();
      forever begin
        seq_item_port.get_next_item(req);
        case(req.op)
          FIFO_PUSH: begin
            @(negedge vif.clk_i); vif.wdata_i<=req.data; vif.wvalid_i<=1;
            @(posedge vif.clk_i); if(!vif.wready_o) `uvm_error("FIFO_DRV","write rejected"); #1; expected_depth++;
            if(vif.depth_o!==expected_depth) `uvm_error("REQ-FIFO-002","write did not increment depth")
            if(expected_depth==4 && !vif.full_o) `uvm_error("REQ-FIFO-002","full_o not asserted at depth 4")
            cov_sample(req.op, expected_depth);
            @(negedge vif.clk_i); vif.wvalid_i<=0;
            observed=fifo_item::type_id::create("observed_push");
            observed.op=req.op;
            observed.data=req.data;
            result_ap.write(observed);
          end
          FIFO_POP: begin
            @(negedge vif.clk_i);
            if(!vif.rvalid_o) `uvm_error("FIFO_DRV","read from empty FIFO");
            observed=fifo_item::type_id::create("observed_pop");
            observed.op=req.op;
            observed.data=vif.rdata_o;
            vif.rready_i<=1; @(posedge vif.clk_i); #1; expected_depth--;
            if(vif.depth_o!==expected_depth) `uvm_error("REQ-FIFO-004","read did not decrement depth")
            cov_sample(req.op, expected_depth);
            @(negedge vif.clk_i); vif.rready_i<=0;
            result_ap.write(observed);
          end
          FIFO_PUSH_NEG: begin
            // Deliberately attempt a push while the FIFO is expected full.
            // This is NOT an error by itself - the point is to check the DUT
            // refuses it (wready_o low, depth unchanged). It IS an error if
            // the DUT silently accepts it (overflow).
            @(negedge vif.clk_i); vif.wdata_i<=req.data; vif.wvalid_i<=1;
            @(posedge vif.clk_i);
            if (vif.wready_o) `uvm_error("REQ-FIFO-005", "push accepted while full - overflow")
            else neg_full_reject_hits++;
            #1;
            if (vif.depth_o !== expected_depth) `uvm_error("REQ-FIFO-005", "depth changed on a rejected full-push")
            @(negedge vif.clk_i); vif.wvalid_i<=0;
          end
          FIFO_POP_NEG: begin
            // Deliberately attempt a pop while the FIFO is expected empty.
            // Error only if the DUT shows valid read data while empty
            // (underflow) - a low rvalid_o here is the correct refusal.
            @(negedge vif.clk_i);
            if (vif.rvalid_o) `uvm_error("REQ-FIFO-005", "rvalid asserted while empty - underflow")
            else neg_empty_reject_hits++;
            vif.rready_i<=1; @(posedge vif.clk_i); #1;
            if (vif.depth_o !== expected_depth) `uvm_error("REQ-FIFO-005", "depth changed on a rejected empty-pop")
            @(negedge vif.clk_i); vif.rready_i<=0;
          end
          default: reset_dut();
        endcase
        seq_item_port.item_done();
      end
    endtask
    function void report_phase(uvm_phase phase);
      fifo_op_e ops[2] = '{FIFO_PUSH, FIFO_POP};
      depth_bucket_e buckets[3] = '{DEPTH_EMPTY, DEPTH_MID, DEPTH_FULL};
      string bucket_name[3] = '{"empty", "mid", "full"};
      int unsigned hit_bins = 0;
      string line = "";
      foreach (ops[i]) begin
        foreach (buckets[j]) begin
          int unsigned n = cov_hits[ops[i]][buckets[j]];
          if (n > 0) hit_bins++;
          line = {line, $sformatf(" %0s.%0s=%0d", ops[i].name(), bucket_name[j], n)};
        end
      end
      `uvm_info("FIFO_COV", $sformatf("op x depth bins hit: %0d/6 (%0.1f%%) —%0s",
                hit_bins, 100.0*hit_bins/6.0, line), UVM_NONE)
      // int'() casts are load-bearing: `a>0` is a 1-bit result and the sum is
      // self-determined inside $sformatf, so 1'b1+1'b1 truncated to 1'b0 and
      // the line printed "0/2" while both bins were actually hit.
      `uvm_info("FIFO_COV", $sformatf("REQ-FIFO-005 reject bins hit: %0d/2 (full-reject=%0d, empty-reject=%0d)",
                int'(neg_full_reject_hits>0)+int'(neg_empty_reject_hits>0), neg_full_reject_hits, neg_empty_reject_hits), UVM_NONE)
    endfunction
  endclass

  class fifo_monitor extends uvm_component;
    virtual prim_fifo_sync_if vif;
    int unsigned writes, reads;
    `uvm_component_utils(fifo_monitor)
    function new(string name, uvm_component parent); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase);
      if(!uvm_config_db#(virtual prim_fifo_sync_if)::get(this,"","vif",vif)) `uvm_fatal("NOVIF","virtual interface missing")
    endfunction
    task run_phase(uvm_phase phase);
      forever begin
        @(posedge vif.clk_i);
        if(vif.wvalid_i && vif.wready_o) writes++;
        if(vif.rvalid_o && vif.rready_i) reads++;
      end
    endtask
  endclass

  class fifo_scoreboard extends uvm_component;
    uvm_analysis_imp #(fifo_item, fifo_scoreboard) analysis_export;
    bit [7:0] expected_q[$];
    int unsigned matched_count, mismatches;
    `uvm_component_utils(fifo_scoreboard)
    function new(string name, uvm_component parent); super.new(name,parent); analysis_export=new("analysis_export",this); endfunction
    function void write(fifo_item tr);
      if(tr.op==FIFO_PUSH) expected_q.push_back(tr.data);
      else if(tr.op==FIFO_POP) begin
        if(expected_q.size()==0) begin mismatches++; `uvm_error("FIFO_SB","unexpected read") end
        else if(tr.data!==expected_q.pop_front()) begin mismatches++; `uvm_error("FIFO_SB",$sformatf("data mismatch got=%02h",tr.data)) end
        else matched_count++;
      end
    endfunction
    function void check_phase(uvm_phase phase);
      if(expected_q.size()!=0 || mismatches!=0) `uvm_error("FIFO_SB","scoreboard did not close cleanly")
      else `uvm_info("FIFO_SB",$sformatf("UVM FIFO PASS: %0d checked reads",matched_count),UVM_NONE)
    endfunction
  endclass

  class fifo_agent extends uvm_agent;
    uvm_sequencer #(fifo_item) seqr;
    fifo_driver drv;
    fifo_monitor mon;
    `uvm_component_utils(fifo_agent)
    function new(string name, uvm_component parent); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase); seqr=uvm_sequencer#(fifo_item)::type_id::create("seqr",this); drv=fifo_driver::type_id::create("drv",this); mon=fifo_monitor::type_id::create("mon",this); endfunction
    function void connect_phase(uvm_phase phase); drv.seq_item_port.connect(seqr.seq_item_export); endfunction
  endclass

  class fifo_env extends uvm_env;
    fifo_agent agent;
    fifo_scoreboard sb;
    `uvm_component_utils(fifo_env)
    function new(string name, uvm_component parent); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase); agent=fifo_agent::type_id::create("agent",this); sb=fifo_scoreboard::type_id::create("sb",this); endfunction
    function void connect_phase(uvm_phase phase); agent.drv.result_ap.connect(sb.analysis_export); endfunction
  endclass

  class fifo_smoke_test extends uvm_test;
    fifo_env env;
    `uvm_component_utils(fifo_smoke_test)
    function new(string name, uvm_component parent); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase); env=fifo_env::type_id::create("env",this); endfunction
    task run_phase(uvm_phase phase);
      fifo_smoke_seq seq=fifo_smoke_seq::type_id::create("seq");
      phase.raise_objection(this); seq.start(env.agent.seqr); repeat(2) @(posedge env.agent.drv.vif.clk_i); phase.drop_objection(this);
    endtask
  endclass

  class fifo_requirements_test extends uvm_test;
    fifo_env env;
    `uvm_component_utils(fifo_requirements_test)
    function new(string name, uvm_component parent); super.new(name,parent); endfunction
    function void build_phase(uvm_phase phase); env=fifo_env::type_id::create("env",this); endfunction
    task run_phase(uvm_phase phase);
      fifo_smoke_seq order_seq=fifo_smoke_seq::type_id::create("req_fifo_003_order");
      fifo_fill_drain_seq depth_seq=fifo_fill_drain_seq::type_id::create("req_fifo_002_004_depth");
      fifo_negative_seq neg_seq=fifo_negative_seq::type_id::create("req_fifo_005_negative");
      fifo_random_seq rand_seq=fifo_random_seq::type_id::create("req_fifo_random");
      phase.raise_objection(this);
      order_seq.start(env.agent.seqr);
      depth_seq.start(env.agent.seqr);
      neg_seq.start(env.agent.seqr);
      rand_seq.start(env.agent.seqr);
      repeat(2) @(posedge env.agent.drv.vif.clk_i);
      phase.drop_objection(this);
    endtask
  endclass
endpackage
