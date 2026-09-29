/// sta-blackbox
// STA/OpenROAD declaration of the selected hard macro. The behavioral model
// remains used by simulation; this declaration deliberately carries no logic.
module sram22_1024x32m8w8 (
  input wire clk, rstb, ce, we,
  input wire [3:0] wmask,
  input wire [9:0] addr,
  input wire [31:0] din,
  output wire [31:0] dout
);
endmodule
