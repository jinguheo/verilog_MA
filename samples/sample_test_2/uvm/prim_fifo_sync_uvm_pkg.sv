package prim_fifo_sync_uvm_pkg;
  import uvm_pkg::*;
  `include "uvm_macros.svh"

  typedef enum bit [1:0] {FIFO_RESET, FIFO_PUSH, FIFO_POP} fifo_op_e;

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

  class fifo_driver extends uvm_driver #(fifo_item);
    virtual prim_fifo_sync_if vif;
    uvm_analysis_port #(fifo_item) result_ap;
    int unsigned expected_depth;
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
            @(negedge vif.clk_i); vif.rready_i<=0;
            result_ap.write(observed);
          end
          default: reset_dut();
        endcase
        seq_item_port.item_done();
      end
    endtask
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
      phase.raise_objection(this);
      order_seq.start(env.agent.seqr);
      depth_seq.start(env.agent.seqr);
      repeat(2) @(posedge env.agent.drv.vif.clk_i);
      phase.drop_objection(this);
    endtask
  endclass
endpackage
