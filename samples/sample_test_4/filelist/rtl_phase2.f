// Sample Test 4, phase 2 RTL: AXI4-Lite CSR bridge and register file.
//
// $DAQ_ROOT is set by the scripts under scripts/.

-f $DAQ_ROOT/filelist/rtl_phase1.f

$DAQ_ROOT/rtl/csr/axil_slave.sv
$DAQ_ROOT/rtl/csr/daq_csr.sv
