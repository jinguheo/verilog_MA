# Timing constraints for chan_top — the first multi-clock block in this project.
#
# chan_top spans two asynchronous domains:
#   src_clk_i  packet source ingress
#   axi_clk_i  packet check, channel FSM, AXI-side beat output
#
# Every crossing between them goes through one reused primitive
# (prim_fifo_async, instance u_cdc_fifo) plus a prim_rst_sync per domain. There
# is no hand-rolled synchronisation, which is what makes the exceptions below
# short and auditable rather than a list of one-off waivers.
#
# Getting these exceptions wrong is not cosmetic. Without them STA treats the
# domain crossings as synchronous paths and reports violations that do not
# exist; worse, the optimiser then spends area and power "fixing" them by
# upsizing cells and inserting buffers, which does nothing for CDC.
#
# Written for OpenSTA. Synopsys DC collection commands are NOT available -
# remove_from_collection and append_to_collection both fail with "invalid
# command name" and abort every corner, which is how the first two versions of
# this file died.

# Periods, and why these specific numbers.
#
# 6.0 / 10.0 (matching the UVM testbench's default half-periods) do NOT close:
# a first signoff run at 6/10 failed with setup violations in every tt/ss
# corner (worst: nom_ss_100C_1v60, WNS -23.1 ns, TNS -4465 ns, 3786 violating
# endpoints - see RESULTS.md / NEXT_SESSION.md for the full account). That
# 6/10 pairing was carried over from the RTL simulation environment, where it
# only had to be self-consistent, not meet a manufacturing timing budget - it
# was never validated against synthesized logic depth until this run.
#
# Root-caused to two independent combinational structures via the routed
# netlist + RC-extracted SPEF at the ss_100C_1v60 (worst) corner, not guessed:
#   - axi_clk domain: pkt_check's byte-enable-aware CRC-32 (8 chained
#     crc32_byte_step calls, each an unrolled 8-bit serial shift-XOR - see
#     pkt_check.sv), fed by the CDC FIFO's combinational read-side memory mux,
#     closes to WNS -0.95 ns by axi_period=30 and to positive slack by 32.
#   - src_clk domain: skid_buffer's out_data_q mux, selected by the
#     late-arriving skid_valid_q and fed by pkt_align's variable-index byte
#     accumulator (nxt_data[byte_cnt_q*8+:8]), closes to +0.57 ns at
#     src_period=10 (still -1.33 ns at 8).
# The two are genuinely independent: raising axi_period alone plateaued at
# worst slack -3.23 ns no matter how far it went, because that residual
# violation was entirely inside the fixed-period src_clk domain and axi_period
# has no effect on it.
#
# 32 / 10 is the periods-only fix verified against the routed design (empirical
# bisection, not calculation): src_clk=8 still violates (-1.33 ns), 10 is clean
# (+0.57 ns, TNS 0); axi_clk=30 leaves -0.95 ns, 32 gives margin. Pipelining
# pkt_check's CRC chain and/or pkt_align's byte accumulator would let both
# clocks run faster than this - not attempted this session; these numbers are
# the "no RTL changes" answer, not a claim that faster is unreachable.
#
# CORRECTION (2026-09-14, found jointly by two concurrent sessions working
# this repo - see RESULTS.md's "Correction" note for the full account): the
# bisection above re-timed RUN_2026-08-28_19-41-37's real DEF + extracted
# SPEF against substituted candidate periods - real parasitics, so the
# specific numbers above are genuine and reproducible - but that physical
# implementation was itself placed/routed/optimized targeting 6/10 ns (see
# the paragraph above), not 32/10. A layout over-built for an aggressive 6/10
# target predictably has slack left over when re-graded against a much
# looser 32/10 requirement after the fact; that is NOT the same as what a
# from-scratch synthesis+P&R run actually targeting 32/10 from the start
# produces, since the tool calibrates its own optimization effort to
# whatever period it is given. Two independent from-scratch 32/10-targeted
# runs since (RUN_2026-08-30_20-00-29, and a DEFAULT_CORNER=nom_ss_100C_1v60
# retarget experiment) both show real setup violations at the worst corner
# despite this bisection - so treat 32/10 as validated for the *typical*
# corner only, not the worst corner, until a genuinely from-scratch run
# closes clean at the worst corner too.
#
# SECOND CORRECTION (2026-09-14, same day): the "no RTL change can close the
# worst corner, axi_period plateaus at -3.23 ns no matter how far it goes"
# claim two paragraphs up is ALSO an artifact of the same mistake - that
# plateau was measured against RUN_2026-08-28_19-41-37 (the 6/10-targeted
# netlist) too, with an additionally incomplete hand-written Tcl constraint
# set that omitted this file's own set_input_delay/set_output_delay budgets
# (30% of each period, reserved for board-level IO - e.g. ch_cause_o has an
# axi_budget deadline, not the full axi_period). Re-swept against
# RUN_2026-08-30_20-00-29 (the genuine 32/10-targeted netlist) by sourcing
# THIS file unmodified except for the two period lines below (so every real
# exception - IO budgets, CDC max_delay, driving_cell/load, max_transition -
# stays exactly as signoff uses it, not reimplemented by hand): axi_clk alone
# (src forced to 1000 ns) goes -7.90 ns at 32, -2.75 at 40, +2.41 ns (TNS 0)
# at 48, and keeps climbing linearly past 100 ns - no plateau. src_clk alone
# (axi forced to 1000 ns) goes -1.00 ns at 10, +0.90 ns (TNS 0) at 12, also
# linear. Combined, src=12/axi=48 closes the whole design (+0.90 ns, TNS 0) -
# verified against this same routed netlist's real parasitics. A genuinely
# from-scratch run AT 12/48 (not a re-timing of a 10/32-targeted layout) is
# the actual confirmation and is what these period values below now reflect -
# see RESULTS.md for that run's outcome. If it holds, RTL pipelining of
# pkt_check's CRC chain / pkt_align's byte accumulator is NOT required to
# close chan_top's worst corner - a modest periods-only relaxation is.
#
# THIRD CORRECTION (2026-09-18): the 12/48 from-scratch confirmation run
# (RUN_2026-09-18_21-19-11) landed real - WNS -8.4ns/926 violations dropped
# to WNS -2.73ns/5 violations, a massive improvement, but not fully closed.
# All 5 remaining violations are exclusively axi_clk (ch_cause_o[0]/[2], the
# same CRC/CDC-mux path documented above) across the ss corners - src_clk at
# 12ns is already fully clean (0 violations at every corner, every run so
# far). Bumping only axi_period to 52 ns (src_period stays 12.0, no reason
# to touch a domain that's already clean) - a modest ~8% increase given the
# gap is only -2.73 ns out of 48. See RESULTS.md for this run's outcome.
set src_clk_name src_clk
set axi_clk_name axi_clk
set src_period   12.0
set axi_period   52.0

create_clock -name $src_clk_name -period $src_period [get_ports src_clk_i]
create_clock -name $axi_clk_name -period $axi_period [get_ports axi_clk_i]

set_clock_uncertainty [expr {$src_period * 0.05}] $src_clk_name
set_clock_uncertainty [expr {$axi_period * 0.05}] $axi_clk_name
set_clock_transition  [expr {$src_period * 0.02}] $src_clk_name
set_clock_transition  [expr {$axi_period * 0.02}] $axi_clk_name

# ---------------------------------------------------------------------------
# The asynchronous relationship
# ---------------------------------------------------------------------------
# This is the load-bearing constraint. -asynchronous removes every path between
# the two groups from setup and hold analysis. It is correct here precisely
# because the only crossings are the async FIFO's gray pointers and the reset
# synchronisers - both designed to tolerate an arbitrary phase relationship.
set_clock_groups -asynchronous \
  -group [get_clocks $src_clk_name] \
  -group [get_clocks $axi_clk_name]

# ---------------------------------------------------------------------------
# Bound the crossings that -asynchronous just un-timed
# ---------------------------------------------------------------------------
# -asynchronous says "do not compare these clocks". It does not say "let this
# path take as long as it likes". A gray-coded pointer only stays gray-coded at
# the far end if all its bits arrive within one destination clock period; if
# routing skews them apart, the receiver can sample a value that was never on
# the bus.
#
# The standard way to state that bound without reintroducing a clock
# relationship is `-datapath_only`, but OpenSTA's set_max_delay genuinely does
# not implement it - it is absent from Sdc.tcl's own flag list
# (parse_key_args in set_path_delay only knows -from/-to/-through/-rise/-fall/
# -ignore_clock_latency/-reset_path), not merely spelled differently. Using it
# aborts SDC reading outright ("not a known keyword or flag"), which is how the
# previous version of this file died on every corner.
#
# set_max_delay without that flag is used instead. It still creates an
# explicit maximum-delay exception on the named pins that overrides the
# (otherwise nonexistent, thanks to -asynchronous) default check, which is the
# property that actually matters here: an upper bound exists on this path. What
# is lost is the clock-latency/uncertainty exclusion -datapath_only would give
# on a tool that supports it - a real but second-order gap given this design's
# margins, not one worth blocking on for this tool.
#
# prim_fifo_async instantiates prim_flop_2sync as sync_wptr (write pointer,
# gray-coded, sampled into axi_clk to compute empty) and sync_rptr (read
# pointer, sampled into src_clk to compute full).
#
# The naive pattern *sync_wptr*/*/d matches nothing after synthesis: synthesis
# flattens the design, so there is no submodule boundary left at that path -
# what survives is the net name of the synchroniser's own Q output
# (u_cdc_fifo.sync_rptr.intq[N]), not a pin path. Verified against the netlist
# directly:
#   sky130_fd_sc_hd__dfrtp_2 _18994_ ( .CLK(src_clk_i),
#     .D(u_cdc_fifo.fifo_rptr_gray_q[0]), .Q(u_cdc_fifo.sync_rptr.intq[0]) );
# _18994_ IS the first-stage synchroniser flop - the async gray-code bit is
# sampled at its own D pin, which is exactly what -datapath_only needs to
# bound. The second-stage flop (D=intq[N], Q=fifo_rptr_gray_sync[N]) is an
# ordinary same-domain path and needs no exception.
#
# So: find the net, take its driving (output) pin, take the cell that pin
# belongs to, and take THAT cell's own input pin - the two-hop indirection is
# necessary because "the D pin of the flop whose Q is this net" is not
# expressible as a single collection query.
set cdc_budget [expr {min($src_period, $axi_period)}]

proc cdc_input_pins {net_pattern} {
  set q_pins [get_pins -quiet -of_objects [get_nets -quiet $net_pattern] -filter "direction==output"]
  if {[llength $q_pins] == 0} { return {} }
  set cells [get_cells -quiet -of_objects $q_pins]
  # name==D, not just direction==input: a dfrtp cell's other input pins (CLK,
  # RESET_B) also match direction==input, and picking those up too silently
  # widened this from "6 CDC input pins" to "18 pins, only a third of them
  # actually D" the first time this was written.
  return [get_pins -quiet -of_objects $cells -filter "direction==input&&name==D"]
}

set rptr_pins [cdc_input_pins {u_cdc_fifo.sync_rptr.intq[*]}]
if {[llength $rptr_pins] > 0} {
  set_max_delay $cdc_budget -to $rptr_pins
} else {
  puts "WARNING: sync_rptr synchroniser D pins not matched - CDC exception not applied"
}

set wptr_pins [cdc_input_pins {u_cdc_fifo.sync_wptr.intq[*]}]
if {[llength $wptr_pins] > 0} {
  set_max_delay $cdc_budget -to $wptr_pins
} else {
  puts "WARNING: sync_wptr synchroniser D pins not matched - CDC exception not applied"
}

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------
# One asynchronous reset in, synchronised per domain by prim_rst_sync. The input
# port itself is never timed; the synchronised outputs are ordinary synchronous
# signals inside their own domain and are left alone.
set_false_path -from [get_ports rst_ni]

# ---------------------------------------------------------------------------
# IO budgets
# ---------------------------------------------------------------------------
# Source-side ports are relative to src_clk, AXI-side ports to axi_clk.
# Assigning both to one clock would produce meaningless numbers on half of them.
# Ports are listed explicitly by direction because OpenSTA has no reliable way
# to filter a port collection by direction in a portable script.
set src_in   [get_ports -quiet {src_valid_i src_data_i[*] src_sop_i src_eop_i src_crc_i[*]}]
set src_out  [get_ports -quiet {src_ready_o}]
set axi_in   [get_ports -quiet {beat_ready_i ch_enable_i ch_abort_i}]
set axi_out  [get_ports -quiet {beat_valid_o beat_data_o[*] beat_strb_o[*] beat_sop_o beat_eop_o \
                                ch_busy_o ch_err_o ch_cause_o[*]}]

set src_budget [expr {$src_period * 0.30}]
set axi_budget [expr {$axi_period * 0.30}]

if {[llength $src_in]  > 0} { set_input_delay  -clock $src_clk_name $src_budget $src_in }
if {[llength $src_out] > 0} { set_output_delay -clock $src_clk_name $src_budget $src_out }
if {[llength $axi_in]  > 0} { set_input_delay  -clock $axi_clk_name $axi_budget $axi_in }
if {[llength $axi_out] > 0} { set_output_delay -clock $axi_clk_name $axi_budget $axi_out }

# ---------------------------------------------------------------------------
# Electrical environment
# ---------------------------------------------------------------------------
# rst_ni is included here; it is false-pathed above, so a driving cell on it
# affects nothing that is timed.
set_driving_cell -lib_cell sky130_fd_sc_hd__inv_2 -pin Y [all_inputs -no_clocks]
set_load [expr {5 * 0.0091}] [all_outputs]

set_max_transition [expr {$axi_period * 0.15}] [current_design]
set_max_fanout 16 [current_design]
