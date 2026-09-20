// SPDX-License-Identifier: Apache-2.0
// Physical-only black-box model for synthesis and hierarchical P&R.
// Pin names intentionally match the released LEF and extracted SPICE views.

`default_nettype none

(* blackbox *)
module sky130_ef_ip__adc3v_12bit (
    input  wire [11:0] adc_dac_val,
    input  wire        adc_ena,
    input  wire        adc_reset,
    output wire        adc_comp_out,
    input  wire        adc_hold,
    inout  wire        adc_vrefL,
    inout  wire        vssd,
    inout  wire        adc_vrefH,
    input  wire        adc_trim,
    inout  wire        adc_vCM,
    input  wire        adc_in,
    inout  wire        vccd,
    inout  wire        vdda,
    inout  wire        vssa
);
endmodule

`default_nettype wire
