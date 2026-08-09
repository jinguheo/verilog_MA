// AXI4-Lite to internal register-bus (regbus) bridge.
//
// Generic in Aw/Dw so it is independently testable (and reusable) rather than
// baked to DAQ's specific register map; daq_csr.sv is the map, this module is
// only the protocol. Everything about offsets, RO/RW/W1C, and byte-strobe
// application lives on the far side of the regbus.
//
// Design choices
// --------------
// - One outstanding regbus transaction at a time, read or write. AW and W are
//   still captured independently, since a master may legally present them on
//   different cycles, but only one combined write or one read is ever in
//   flight against the backend. This is the standard simplification for a
//   low-throughput control-plane register file - OpenTitan's TL-UL register
//   adapters make the same choice - and it means a master cannot pipeline a
//   second request while waiting on this one's B/R response. A CSR bus is not
//   where that costs anything.
// - Fixed priority when a write and a read are both ready to issue the same
//   cycle: write wins, so a write that unblocks a subsequent read (arm a
//   channel, then poll it) is never held behind that read.
// - The regbus backend responds combinationally, in the same cycle
//   reg_valid_o is asserted: reg_rdata_i/reg_error_i are pure functions of
//   reg_addr_o and the backend's own (already-flopped) register state, so
//   there is no combinational path back through this module. A write's flop
//   update happens on the backend's own next posedge, gated by the same
//   reg_valid_o/reg_write_o this module drove this cycle.
// - reg_error_i maps to AXI DECERR uniformly. Nothing in the register map
//   needs SLVERR yet - daq_csr treats a write to a read-only address as a
//   legal no-op rather than an error, which is what most register generators
//   do - so reg_error_i here only ever means "no such address".

module axil_slave
  import axi_pkg::*;
#(
  parameter int unsigned Aw = daq_pkg::AxilAw,
  parameter int unsigned Dw = daq_pkg::AxilDw
) (
  input  logic               clk_i,
  input  logic                rst_ni,

  // AXI4-Lite slave port
  input  logic [Aw-1:0]        awaddr_i,
  input  logic                  awvalid_i,
  output logic                  awready_o,

  input  logic [Dw-1:0]         wdata_i,
  input  logic [(Dw/8)-1:0]     wstrb_i,
  input  logic                   wvalid_i,
  output logic                   wready_o,

  output logic [1:0]             bresp_o,
  output logic                    bvalid_o,
  input  logic                    bready_i,

  input  logic [Aw-1:0]           araddr_i,
  input  logic                     arvalid_i,
  output logic                     arready_o,

  output logic [Dw-1:0]            rdata_o,
  output logic [1:0]               rresp_o,
  output logic                      rvalid_o,
  input  logic                      rready_i,

  // regbus master port, to the register backend
  output logic                      reg_valid_o,
  output logic                      reg_write_o,
  output logic [Aw-1:0]             reg_addr_o,
  output logic [Dw-1:0]             reg_wdata_o,
  output logic [(Dw/8)-1:0]         reg_wstrb_o,
  input  logic [Dw-1:0]             reg_rdata_i,
  input  logic                       reg_error_i
);

  typedef enum logic [1:0] { StIdle, StWrResp, StRdResp } st_e;
  st_e st_q, st_d;

  // ---- AW/W/AR capture (single entry each) ---------------------------------
  logic             awcap_q;
  logic [Aw-1:0]    awaddr_q;
  logic             wcap_q;
  logic [Dw-1:0]    wdata_q;
  logic [(Dw/8)-1:0] wstrb_q;
  logic             arcap_q;
  logic [Aw-1:0]    araddr_q;

  assign awready_o = (st_q == StIdle) & ~awcap_q;
  assign wready_o  = (st_q == StIdle) & ~wcap_q;
  assign arready_o = (st_q == StIdle) & ~arcap_q;

  // "Available this cycle" - either already captured, or arriving right now
  // and about to be captured/bypassed.
  logic aw_avail, w_avail, wr_ready, rd_ready;
  assign aw_avail = awcap_q | (awvalid_i & awready_o);
  assign w_avail  = wcap_q  | (wvalid_i  & wready_o);
  assign wr_ready = aw_avail & w_avail;
  assign rd_ready = arcap_q | (arvalid_i & arready_o);

  logic issue_write, issue_read;
  assign issue_write = (st_q == StIdle) & wr_ready;
  assign issue_read  = (st_q == StIdle) & rd_ready & ~issue_write;

  // Bypass mux: use the just-arrived value directly when nothing was
  // captured yet, so a same-cycle AW+W pair issues with no extra latency.
  assign reg_valid_o = issue_write | issue_read;
  assign reg_write_o = issue_write;
  assign reg_addr_o  = issue_write ? (awcap_q ? awaddr_q : awaddr_i)
                                    : (arcap_q ? araddr_q : araddr_i);
  assign reg_wdata_o = wcap_q ? wdata_q : wdata_i;
  assign reg_wstrb_o = wcap_q ? wstrb_q : wstrb_i;

  logic [1:0] resp_q;
  logic [Dw-1:0] rdata_q;

  always_comb begin
    st_d = st_q;
    unique case (st_q)
      StIdle:   if (issue_write)        st_d = StWrResp;
                else if (issue_read)    st_d = StRdResp;
      StWrResp: if (bvalid_o & bready_i) st_d = StIdle;
      StRdResp: if (rvalid_o & rready_i) st_d = StIdle;
      default:  st_d = StIdle;
    endcase
  end

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      st_q    <= StIdle;
      awcap_q <= 1'b0; awaddr_q <= '0;
      wcap_q  <= 1'b0; wdata_q  <= '0; wstrb_q <= '0;
      arcap_q <= 1'b0; araddr_q <= '0;
      resp_q  <= 2'b00;
      rdata_q <= '0;
    end else begin
      st_q <= st_d;

      // Capture whatever arrived this cycle and was not consumed by an issue
      // this same cycle (the bypass path above already used it directly).
      if (awvalid_i & awready_o & ~issue_write) begin
        awcap_q <= 1'b1; awaddr_q <= awaddr_i;
      end
      if (wvalid_i & wready_o & ~issue_write) begin
        wcap_q <= 1'b1; wdata_q <= wdata_i; wstrb_q <= wstrb_i;
      end
      if (arvalid_i & arready_o & ~issue_read) begin
        arcap_q <= 1'b1; araddr_q <= araddr_i;
      end

      if (issue_write) begin awcap_q <= 1'b0; wcap_q <= 1'b0; end
      if (issue_read)  begin arcap_q <= 1'b0; end

      if (issue_write) begin
        resp_q <= reg_error_i ? RespDecErr : RespOkay;
      end
      if (issue_read) begin
        resp_q  <= reg_error_i ? RespDecErr : RespOkay;
        rdata_q <= reg_rdata_i;
      end
    end
  end

  assign bvalid_o = (st_q == StWrResp);
  assign bresp_o  = resp_q;
  assign rvalid_o = (st_q == StRdResp);
  assign rresp_o  = resp_q;
  assign rdata_o  = rdata_q;

`ifdef DAQ_SVA
  default disable iff (!rst_ni);

  // At most one of AW-capture / W-capture / AR-capture is ever "in progress
  // and unresolved for more than the cycle it arrived" simultaneously with a
  // response being presented - i.e. the single-outstanding design intent.
  p_single_outstanding: assert property (@(posedge clk_i)
    !(bvalid_o && rvalid_o));

  // A held response must not change value before it is accepted.
  p_bresp_stable: assert property (@(posedge clk_i)
    bvalid_o && !bready_i |=> bvalid_o && $stable(bresp_o));
  p_rresp_stable: assert property (@(posedge clk_i)
    rvalid_o && !rready_i |=> rvalid_o && $stable(rdata_o) && $stable(rresp_o));
`endif

endmodule
