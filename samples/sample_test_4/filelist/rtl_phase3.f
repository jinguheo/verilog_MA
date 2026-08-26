// Sample Test 4, phase 3 RTL: per-channel stream path.
//
// $DAQ_ROOT is set by the scripts under scripts/.

-f $DAQ_ROOT/filelist/rtl_phase2.f

$DAQ_ROOT/rtl/stream/pkt_align.sv
$DAQ_ROOT/rtl/stream/pkt_check.sv
$DAQ_ROOT/rtl/stream/chan_ctrl.sv
$DAQ_ROOT/rtl/stream/chan_top.sv
