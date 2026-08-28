// Sample Test 4, phase 5 RTL: interrupt/perf aggregation and top-level wiring.
//
// $DAQ_ROOT is set by the scripts under scripts/.

-f $DAQ_ROOT/filelist/rtl_phase4.f

$DAQ_ROOT/rtl/irq/irq_ctrl.sv
$DAQ_ROOT/rtl/stat/perf_cnt.sv
$DAQ_ROOT/rtl/daq_subsystem.sv
