// Mutant copy of rtl/csr/axil_slave.sv. See mutants/skid_buffer_MUTANT.sv for
// why these exist and what -Mutant does with them.
//
//   MUT_AXIL_WPRIO   read wins arbitration instead of write, when both are
//                    ready the same cycle. Reachable only by the phase-2-style
//                    "independent capture" sequencing; tb_axil_slave's
//                    directed AW-before-W/W-before-AW cases exercise it, its
//                    randomised phase does not (writes and reads there are
//                    driven one at a time, never contending for the same
//                    cycle).
//   MUT_AXIL_NODECERR  reg_error_i is ignored on writes - a write to the
//                    unmapped hole reports OKAY instead of DECERR.

module axil_slave
  import axi_pkg::*;
#(
  parameter int unsigned Aw = daq_pkg::AxilAw,
  parameter int unsigned Dw = daq_pkg::AxilDw
) (
  input  logic               clk_i,
  input  logic                rst_ni,
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
  output logic [Dw-1:0]             rdata_o,
  output logic [1:0]                rresp_o,
  output logic                       rvalid_o,
  input  logic                       rready_i,
  output logic                        reg_valid_o,
  output logic                        reg_write_o,
  output logic [Aw-1:0]               reg_addr_o,
  output logic [Dw-1:0]               reg_wdata_o,
  output logic [(Dw/8)-1:0]           reg_wstrb_o,
  input  logic [Dw-1:0]               reg_rdata_i,
  input  logic                         reg_error_i
);

  typedef enum logic [1:0] { StIdle, StWrResp, StRdResp } st_e;
  st_e st_q, st_d;

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

  logic aw_avail, w_avail, wr_ready, rd_ready;
  assign aw_avail = awcap_q | (awvalid_i & awready_o);
  assign w_avail  = wcap_q  | (wvalid_i  & wready_o);
  assign wr_ready = aw_avail & w_avail;
  assign rd_ready = arcap_q | (arvalid_i & arready_o);

  logic issue_write, issue_read;
`ifdef MUT_AXIL_WPRIO
  assign issue_read  = (st_q == StIdle) & rd_ready;
  assign issue_write = (st_q == StIdle) & wr_ready & ~issue_read;
`else
  assign issue_write = (st_q == StIdle) & wr_ready;
  assign issue_read  = (st_q == StIdle) & rd_ready & ~issue_write;
`endif

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

`ifdef MUT_AXIL_NODECERR
      if (issue_write) begin
        resp_q <= RespOkay;
      end
`else
      if (issue_write) begin
        resp_q <= reg_error_i ? RespDecErr : RespOkay;
      end
`endif
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

endmodule
