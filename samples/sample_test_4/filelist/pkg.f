// Everything the phase-1 RTL and testbenches depend on, but no design modules
// of our own. Split out from rtl_phase1.f so the mutation runs can swap the
// design files while keeping the identical dependency set.
//
// $DAQ_ROOT is set by the scripts under scripts/.

-f $DAQ_ROOT/filelist/prim.f

$DAQ_ROOT/rtl/pkg/axi_pkg.sv
$DAQ_ROOT/rtl/pkg/daq_pkg.sv
