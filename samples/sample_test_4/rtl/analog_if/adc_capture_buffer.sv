// Triggered ADC acquisition buffer for PPA experiment 2.
//
// Two 12-bit samples plus four status bits per sample are packed into one
// 32-bit word. The synchronous single-port array matches the selected SRAM22
// 4 KiB SRAM22 behavior through adc_capture_sram. The readout FSM explicitly
// accounts for the macro's registered (one-cycle) read response.
// Before trigger it is circular; after PostTriggerSamples accepted samples it
// freezes. Readout is only allowed while frozen, so single-port collisions are
// impossible by construction.
module adc_capture_buffer #(
  parameter int unsigned AdcBits            = 12,
  parameter int unsigned FlagBits           = 4,
  parameter int unsigned DepthWords         = 1024,
  parameter int unsigned PostTriggerSamples = 512,
  localparam int unsigned AddrW              = $clog2(DepthWords),
  localparam int unsigned SampleCntW         = $clog2(DepthWords * 2 + 1),
  localparam int unsigned PostCntW           = $clog2(PostTriggerSamples + 1)
) (
  input  logic clk_i,
  input  logic rst_ni,
  input  logic arm_i,
  input  logic trigger_i,
  input  logic                  sample_valid_i,
  output logic                  sample_ready_o,
  input  logic [AdcBits-1:0]    sample_i,
  input  logic [FlagBits-1:0]   sample_flags_i,
  output logic                  armed_o,
  output logic                  triggered_o,
  output logic                  capture_done_o,
  output logic [SampleCntW-1:0] sample_count_o,
  input  logic                  read_start_i,
  output logic                  read_valid_o,
  input  logic                  read_ready_i,
  output logic [31:0]           read_data_o,
  output logic                  read_first_o,
  output logic                  read_last_o,
  output logic                  read_done_o
);
  localparam int unsigned SampleBits = AdcBits + FlagBits;
  initial begin
    if (SampleBits != 16) $fatal(1, "AdcBits+FlagBits must equal 16");
    if (DepthWords < 2 || (DepthWords & (DepthWords - 1)) != 0)
      $fatal(1, "DepthWords must be a power of two >= 2");
    if (PostTriggerSamples < 1 || PostTriggerSamples > DepthWords * 2)
      $fatal(1, "PostTriggerSamples outside buffer capacity");
  end

  logic [AddrW-1:0] wr_ptr_q, read_base_q, read_addr_q;
  logic [AddrW:0] valid_words_q, read_words_q, read_index_q;
  logic half_valid_q;
  logic [15:0] half_sample_q;
  logic [PostCntW-1:0] post_remaining_q;
  logic [15:0] sample16;
  typedef enum logic [1:0] {RdIdle, RdIssue, RdWait, RdValid} read_state_e;
  read_state_e read_state_q;
  logic mem_en, mem_we;
  logic [9:0] mem_addr;
  logic [31:0] mem_wdata, mem_rdata;
  logic capture_stop_now, capture_commit_word;

  assign sample16 = {sample_flags_i, sample_i};
  assign sample_ready_o = armed_o && !capture_done_o && !read_valid_o;
  wire sample_fire = sample_valid_i && sample_ready_o;
  wire read_fire = read_valid_o && read_ready_i;

  always_comb begin
    capture_stop_now = 1'b0;
    if (!triggered_o && trigger_i) capture_stop_now = (PostTriggerSamples == 1);
    else if (triggered_o) capture_stop_now = (post_remaining_q <= PostCntW'(1));
    capture_commit_word = sample_fire && (half_valid_q || capture_stop_now);
  end

  // Capture and readout cannot overlap: when frozen, only the read FSM owns
  // the one SRAM port. DepthWords is deliberately fixed to the selected macro.
  always_comb begin
    mem_en = 1'b0; mem_we = 1'b0; mem_addr = {10{1'b0}}; mem_wdata = '0;
    if (capture_commit_word) begin
      mem_en = 1'b1; mem_we = 1'b1;
      mem_addr = 10'(wr_ptr_q);
      mem_wdata = half_valid_q ? {sample16, half_sample_q} : {16'h0, sample16};
    end else if (read_state_q == RdIssue) begin
      mem_en = 1'b1;
      mem_addr = 10'(read_addr_q);
    end
  end

  adc_capture_sram u_capture_sram (
    .clk_i, .en_i(mem_en), .we_i(mem_we), .wmask_i(4'hf),
    .addr_i(mem_addr), .wdata_i(mem_wdata), .rdata_o(mem_rdata)
  );

  function automatic logic [AddrW-1:0] ptr_next(input logic [AddrW-1:0] ptr);
    ptr_next = (ptr == AddrW'(DepthWords - 1)) ? '0 : ptr + AddrW'(1);
  endfunction

  always_ff @(posedge clk_i or negedge rst_ni) begin
    if (!rst_ni) begin
      armed_o <= 1'b0; triggered_o <= 1'b0; capture_done_o <= 1'b0;
      sample_count_o <= '0; wr_ptr_q <= '0; valid_words_q <= '0;
      half_valid_q <= 1'b0; half_sample_q <= '0; post_remaining_q <= '0;
      read_base_q <= '0; read_addr_q <= '0; read_words_q <= '0;
      read_index_q <= '0; read_valid_o <= 1'b0; read_data_o <= '0;
      read_first_o <= 1'b0; read_last_o <= 1'b0; read_done_o <= 1'b0;
      read_state_q <= RdIdle;
    end else begin
      read_done_o <= 1'b0;
      if (arm_i) begin
        armed_o <= 1'b1; triggered_o <= 1'b0; capture_done_o <= 1'b0;
        sample_count_o <= '0; wr_ptr_q <= '0; valid_words_q <= '0;
        half_valid_q <= 1'b0; post_remaining_q <= '0; read_valid_o <= 1'b0;
        read_state_q <= RdIdle;
      end else begin
        if (armed_o && !capture_done_o && trigger_i && !triggered_o) begin
          triggered_o <= 1'b1;
          post_remaining_q <= PostCntW'(PostTriggerSamples);
        end

        if (sample_fire) begin : capture_sample
          logic stop_now;
          logic commit_word;
          logic [AddrW-1:0] next_wr;
          logic [AddrW:0] next_valid_words;

          stop_now = 1'b0;
          if (!triggered_o && trigger_i) begin
            triggered_o <= 1'b1;
            if (PostTriggerSamples == 1) stop_now = 1'b1;
            else post_remaining_q <= PostCntW'(PostTriggerSamples - 1);
          end else if (triggered_o) begin
            if (post_remaining_q <= PostCntW'(1)) stop_now = 1'b1;
            else post_remaining_q <= post_remaining_q - PostCntW'(1);
          end

          if (sample_count_o < SampleCntW'(DepthWords * 2))
            sample_count_o <= sample_count_o + SampleCntW'(1);

          commit_word = half_valid_q || stop_now;
          if (commit_word) begin
            // The storage port is driven in this same clock edge through a
            // registered write below; values are latched here for it.
            next_wr = ptr_next(wr_ptr_q);
            wr_ptr_q <= next_wr;
            next_valid_words = (valid_words_q < (AddrW+1)'(DepthWords))
                             ? valid_words_q + (AddrW+1)'(1) : valid_words_q;
            valid_words_q <= next_valid_words;
            half_valid_q <= 1'b0;
            if (stop_now) begin
              capture_done_o <= 1'b1;
              armed_o <= 1'b0;
              read_words_q <= next_valid_words;
              read_base_q <= (next_valid_words == (AddrW+1)'(DepthWords)) ? next_wr : '0;
            end
          end else begin
            half_sample_q <= sample16;
            half_valid_q <= 1'b1;
          end
        end

        if (read_start_i && capture_done_o && read_state_q == RdIdle && read_words_q != '0) begin
          read_addr_q <= read_base_q; read_index_q <= '0;
          read_state_q <= RdIssue;
        end else if (read_state_q == RdIssue) begin
          read_state_q <= RdWait;
        end else if (read_state_q == RdWait) begin
          read_data_o <= mem_rdata; read_valid_o <= 1'b1;
          read_first_o <= (read_index_q == '0);
          read_last_o <= (read_index_q + (AddrW+1)'(1) == read_words_q);
          read_state_q <= RdValid;
        end else if (read_fire) begin
          if (read_last_o) begin
            read_valid_o <= 1'b0; read_first_o <= 1'b0; read_last_o <= 1'b0;
            read_done_o <= 1'b1;
            read_state_q <= RdIdle;
          end else begin
            read_index_q <= read_index_q + (AddrW+1)'(1);
            read_addr_q <= ptr_next(read_addr_q);
            read_valid_o <= 1'b0;
            read_state_q <= RdIssue;
          end
        end
      end
    end
  end
endmodule
