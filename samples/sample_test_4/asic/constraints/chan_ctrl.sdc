# Timing constraints for chan_ctrl.
#
# Replaces OpenLane's generic fallback SDC. Until this file was wired in, every
# run logged "'PNR_SDC_FILE' is not defined. Using generic fallback SDC for
# OpenROAD PnR steps", which means the reported slack was measured against a
# default clock rather than this design's intent.
#
# chan_ctrl is single-clock, so there is nothing asynchronous to except here.
# The multi-clock case is chan_top.sdc.

set clk_name  clk_i
set clk_port  [get_ports clk_i]
set clk_period 10.0

create_clock -name $clk_name -period $clk_period $clk_port

# Uncertainty covers jitter plus the skew the clock tree has not been built with
# yet. 5% pre-CTS is a conventional block-level allowance; propagated timing
# after CTS replaces the skew part with the real number.
set_clock_uncertainty [expr {$clk_period * 0.05}] $clk_name
set_clock_transition  [expr {$clk_period * 0.02}] $clk_name

# Everything that is not the clock is a data port.
#
# `all_inputs -no_clocks` rather than remove_from_collection: the latter is a
# Synopsys DC command and OpenSTA rejects it outright
# ("invalid command name remove_from_collection"), which is what made the first
# version of this file abort every STA corner.
set data_inputs [all_inputs -no_clocks]

# Budget: assume the driving and receiving blocks each consume 30% of the
# period, leaving 40% inside this block. Deliberately pessimistic for a block
# taken in isolation - the real numbers come from the parent once chan_top and
# the subsystem exist.
set io_budget [expr {$clk_period * 0.30}]

set_input_delay  -clock $clk_name $io_budget $data_inputs
set_output_delay -clock $clk_name $io_budget [all_outputs]

# Reset is asynchronous by construction: it is asserted asynchronously and
# released through a synchroniser, so timing it against the clock would report a
# violation that has no meaning.
if {[llength [get_ports -quiet rst_ni]] > 0} {
  set_false_path -from [get_ports rst_ni]
}

# Drive and load. Without these the tool assumes an ideal driver and no load,
# which flatters input transition times and hides real slew problems.
set_driving_cell -lib_cell sky130_fd_sc_hd__inv_2 -pin Y $data_inputs
set_load [expr {5 * 0.0091}] [all_outputs]

# Keep a little margin on the ports so the block does not rely on being driven
# by an unrealistically strong cell.
set_max_transition [expr {$clk_period * 0.15}] [current_design]
set_max_fanout 16 [current_design]
