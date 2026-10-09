# NOTE: PDK_ROOT, PDK and CACE_ROOT are set in the local environment by CACE

set PDK_ROOT $::env(PDK_ROOT)
set PDK $::env(PDK)
set CACE_ROOT $::env(CACE_ROOT)

set circuit1 [readnet spice $CACE_ROOT/netlist/layout/simple_analog_switch_ena1v8.spice]
set circuit2 [readnet spice $CACE_ROOT/netlist/schematic/simple_analog_switch_ena1v8.spice]
readnet spice $PDK_ROOT/$PDK/libs.ref/sky130_fd_sc_hvl/spice/sky130_fd_sc_hvl.spice $circuit2  
lvs "$circuit1 simple_analog_switch_ena1v8" "$circuit2 simple_analog_switch_ena1v8" $PDK_ROOT/$PDK/libs.tech/netgen/${PDK}_setup.tcl simple_analog_switch_ena1v8_comp.out -json
