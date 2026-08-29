# Fast SDC syntax/match check against the already-synthesized chan_top netlist,
# without re-running the full P&R flow. Run with:
#   sta -no_init -exit tools/wsl/94_sdc_check.tcl
set RUN /mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
set PDK_LIB /home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib

read_liberty $PDK_LIB
read_verilog $RUN/06-yosys-synthesis/chan_top.nl.v
link_design chan_top

puts "=== reading SDC ==="
read_sdc /mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/constraints/chan_top.sdc

puts ""
puts "=== rptr D pins (should be exactly 6, one per gray-code bit) ==="
set net_r [get_nets {u_cdc_fifo.sync_rptr.intq[*]}]
set q_pins_r [get_pins -of_objects $net_r -filter "direction==output"]
set cells_r [get_cells -of_objects $q_pins_r]
set d_pins_r [get_pins -of_objects $cells_r -filter "direction==input&&name==D"]
puts "count: [llength $d_pins_r]"
report_object_full_names $d_pins_r

puts ""
puts "=== wptr D pins ==="
set net_w [get_nets {u_cdc_fifo.sync_wptr.intq[*]}]
set q_pins_w [get_pins -of_objects $net_w -filter "direction==output"]
set cells_w [get_cells -of_objects $q_pins_w]
set d_pins_w [get_pins -of_objects $cells_w -filter "direction==input&&name==D"]
puts "count: [llength $d_pins_w]"
report_object_full_names $d_pins_w

puts ""
puts "SDC check complete"
