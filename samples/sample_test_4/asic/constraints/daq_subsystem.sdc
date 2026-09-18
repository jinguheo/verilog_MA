# Timing constraints for daq_subsystem — the full 8-channel chip top.
#
# Clock domains, and why there are 9 of them, not 3.
#
# PLAN.md's original sketch had three domains (reg_clk, axi_clk, src_clk).
# The actual RTL (see daq_subsystem.sv's own header comment) ties reg_clk and
# axi_clk together into one clk_i, because daq_csr.sv/axil_slave.sv were both
# built assuming same-cycle combinational access to ch_busy_i/ch_cause_i/etc,
# not a real CDC boundary. What's left as genuine CDC is exactly what
# chan_top.sdc already handles per-channel: each src_clk_i[c] crossing into
# clk_i through chan_top's own prim_fifo_async (instance u_cdc_fifo) plus a
# prim_rst_sync. With NumCh=8 independent channels, that's clk_i plus 8
# src_clk_i[c] domains — 9 clocks. Nothing here assumes the 8 channels share
# a common source PLL; they're kept mutually asynchronous to each other too,
# which is the conservative and generally correct assumption for independent
# DAQ front-ends.
#
# Written for OpenSTA, same dialect notes as chan_top.sdc: no
# remove_from_collection/append_to_collection, no -datapath_only on
# set_max_delay (both abort SDC reading outright on this tool).

# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------
# clk_i: chan_top's own axi_clk_i needed 32 ns to close (root-caused to
# pkt_check's CRC-32 chain and the CDC FIFO's read-side mux — see
# chan_top.sdc). clk_i here carries all of that PLUS dma_sched's arbitration
# tree and daq_csr's write-commit path layered on top, so 32 ns is a floor
# carried over from chan_top, not a validated number for this design — it is
# very likely to need loosening once this actually runs through STA against
# a routed netlist. Not tuned yet; this is a first attempt, same as
# chan_top's original 6/10 was before its own root-cause pass.
#
# src_clk_i[c]: reused at chan_top's own proven 10 ns for every channel.
# Each channel is a bit-for-bit repeat of the same chan_top logic with no new
# combinational path added between src_clk domain elements at this level, so
# there is no reason to expect a different number per channel.
set num_ch    8
set clk_period 32.0
set src_period 10.0

create_clock -name clk -period $clk_period [get_ports clk_i]
set_clock_uncertainty [expr {$clk_period * 0.05}] clk
set_clock_transition  [expr {$clk_period * 0.02}] clk

set src_clk_names {}
for {set c 0} {$c < $num_ch} {incr c} {
  set cname "src_clk_$c"
  lappend src_clk_names $cname
  create_clock -name $cname -period $src_period [get_ports "src_clk_i\[$c\]"]
  set_clock_uncertainty [expr {$src_period * 0.05}] $cname
  set_clock_transition  [expr {$src_period * 0.02}] $cname
}

# ---------------------------------------------------------------------------
# The asynchronous relationship — every group against every other group
# ---------------------------------------------------------------------------
# clk_i and each src_clk_i[c] are async (real CDC, via prim_fifo_async).
# Channels are also kept async to each other: nothing in this design
# synchronises one channel's source clock to another's, so treating them as
# related would be an unsupported assumption, not a simplification.
set clock_groups_args {}
lappend clock_groups_args -group [get_clocks clk]
foreach cname $src_clk_names {
  lappend clock_groups_args -group [get_clocks $cname]
}
set_clock_groups -asynchronous {*}$clock_groups_args

# ---------------------------------------------------------------------------
# Bound the crossings that -asynchronous just un-timed
# ---------------------------------------------------------------------------
# Same two-hop indirection as chan_top.sdc: after synthesis flattens the
# design, what survives per-channel is the synchroniser's own Q net
# (gen_chan[c].u_chan_top.u_cdc_fifo.sync_rptr.intq[N]), not a submodule pin
# path. Looked up per channel explicitly rather than via a single wildcard
# over the generate index — chan_top.sdc's own [*] wildcard is proven only
# for a bit-index inside one instance, not for a generate-array instance
# name component, and getting this silently wrong (empty match, no warning)
# is exactly the failure mode the -quiet + explicit-count-check guards below
# exist to catch.
set cdc_budget [expr {min($src_period, $clk_period)}]

proc cdc_input_pins {net_pattern} {
  set q_pins [get_pins -quiet -of_objects [get_nets -quiet $net_pattern] -filter "direction==output"]
  if {[llength $q_pins] == 0} { return {} }
  set cells [get_cells -quiet -of_objects $q_pins]
  return [get_pins -quiet -of_objects $cells -filter "direction==input&&name==D"]
}

set all_rptr_pins {}
set all_wptr_pins {}
for {set c 0} {$c < $num_ch} {incr c} {
  set base "gen_chan\[$c\].u_chan_top.u_cdc_fifo"
  set rp [cdc_input_pins "${base}.sync_rptr.intq\[*\]"]
  set wp [cdc_input_pins "${base}.sync_wptr.intq\[*\]"]
  if {[llength $rp] == 0} { puts "WARNING: channel $c sync_rptr synchroniser D pins not matched" }
  if {[llength $wp] == 0} { puts "WARNING: channel $c sync_wptr synchroniser D pins not matched" }
  lappend all_rptr_pins {*}$rp
  lappend all_wptr_pins {*}$wp
}
if {[llength $all_rptr_pins] > 0} { set_max_delay $cdc_budget -to $all_rptr_pins }
if {[llength $all_wptr_pins] > 0} { set_max_delay $cdc_budget -to $all_wptr_pins }
puts "INFO: CDC exceptions applied to [llength $all_rptr_pins] sync_rptr + [llength $all_wptr_pins] sync_wptr pins across $num_ch channels"

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------
# One asynchronous reset in, synchronised per domain (once for clk_i via
# rst_n_sync, once per channel inside each chan_top instance). The input port
# itself is never timed; synchronised outputs are ordinary in-domain signals.
set_false_path -from [get_ports rst_ni]

# ---------------------------------------------------------------------------
# IO budgets
# ---------------------------------------------------------------------------
# Per-channel source ports are relative to that channel's own src_clk_i[c] —
# NOT a shared clock, since each bit of these vectors genuinely belongs to a
# different clock domain. CSR (AXI4-Lite slave), the AXI4 read/write master
# ports, and irq_o are all clk_i now that reg_clk/axi_clk are merged.
#
# -quiet + explicit-count guards throughout: if synthesis names an unpacked
# array port differently than assumed here (src_data_i[c]/src_crc_i[c] are
# unpacked arrays, not guaranteed to survive with this exact bus-index
# naming), this must not abort the whole SDC read over a best-effort IO
# budget — unlike the CDC exceptions above, getting this section wrong
# doesn't create a false pass, just a less precise environment model.
set clk_budget [expr {$clk_period * 0.30}]

for {set c 0} {$c < $num_ch} {incr c} {
  set cname "src_clk_$c"
  set src_budget [expr {$src_period * 0.30}]
  set sin  [get_ports -quiet "src_valid_i\[$c\] src_data_i\[$c\]* src_sop_i\[$c\] src_eop_i\[$c\] src_crc_i\[$c\]*"]
  set sout [get_ports -quiet "src_ready_o\[$c\]"]
  if {[llength $sin]  > 0} { set_input_delay  -clock $cname $src_budget $sin }
  if {[llength $sout] > 0} { set_output_delay -clock $cname $src_budget $sout }
}

set clk_in  [get_ports -quiet {s_axil_awaddr_i[*] s_axil_awvalid_i s_axil_wdata_i[*] s_axil_wstrb_i[*] \
                                s_axil_wvalid_i s_axil_bready_i s_axil_araddr_i[*] s_axil_arvalid_i \
                                s_axil_rready_i m_axi_arready_i m_axi_rvalid_i m_axi_rdata_i[*] \
                                m_axi_rresp_i[*] m_axi_rlast_i m_axi_rid_i[*] m_axi_awready_i \
                                m_axi_wready_i m_axi_bvalid_i m_axi_bresp_i[*] m_axi_bid_i[*]}]
set clk_out [get_ports -quiet {s_axil_awready_o s_axil_wready_o s_axil_bresp_o[*] s_axil_bvalid_o \
                                s_axil_arready_o s_axil_rdata_o[*] s_axil_rresp_o[*] s_axil_rvalid_o \
                                m_axi_arvalid_o m_axi_araddr_o[*] m_axi_arlen_o[*] m_axi_arsize_o[*] \
                                m_axi_arburst_o[*] m_axi_arid_o[*] m_axi_arcache_o[*] m_axi_arprot_o[*] \
                                m_axi_rready_o m_axi_awvalid_o m_axi_awaddr_o[*] m_axi_awlen_o[*] \
                                m_axi_awsize_o[*] m_axi_awburst_o[*] m_axi_awid_o[*] m_axi_awcache_o[*] \
                                m_axi_awprot_o[*] m_axi_wvalid_o m_axi_wdata_o[*] m_axi_wstrb_o[*] \
                                m_axi_wlast_o m_axi_bready_o irq_o}]

if {[llength $clk_in]  > 0} { set_input_delay  -clock clk $clk_budget $clk_in }
if {[llength $clk_out] > 0} { set_output_delay -clock clk $clk_budget $clk_out }

# ---------------------------------------------------------------------------
# Electrical environment
# ---------------------------------------------------------------------------
set_driving_cell -lib_cell sky130_fd_sc_hd__inv_2 -pin Y [all_inputs -no_clocks]
set_load [expr {5 * 0.0091}] [all_outputs]

set_max_transition [expr {$clk_period * 0.15}] [current_design]
set_max_fanout 16 [current_design]
