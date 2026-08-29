#!/usr/bin/env bash
# Find the axi_clk period chan_top actually closes at, using the already-placed-
# and-routed design rather than re-running P&R at each candidate period. This
# does not touch verified RTL - it answers "what frequency does this logic
# depth actually support" so that decision can be made with a real number.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/101_period_sweep.sh
set -euo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
# The run stopped at the signoff gate, before the "final/" copy step, so DEF
# and SPEF are read from their own step directories rather than final/.
DEF="$RUN/51-openroad-fillinsertion/chan_top.def"
[ -f "$DEF" ] || DEF="$(find "$RUN" -maxdepth 2 -name 'chan_top.def' | sort | tail -1)"
SPEF="$RUN/53-openroad-rcx/max/chan_top.max.spef"
PDK_LIB=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lib/sky130_fd_sc_hd__ss_100C_1v60.lib
LEF_TECH=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef
LEF_CELLS=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef
# Fill/decap cell geometry (sky130_ef_sc_hd__decap_*, used by fill insertion).
# Without this, ODB rejects the DEF outright ("unknown library cell referenced
# ... FILLER_*", then "ODB-0421 DEF parser returns an error") because the DEF
# references cells this LEF alone does not define.
LEF_EF=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lef/sky130_ef_sc_hd.lef

[ -f "$DEF" ] || { echo "no routed DEF at $DEF" >&2; exit 1; }

# read_lef/read_def/read_spef are OpenROAD (odb) commands, not part of bare
# OpenSTA - the standalone `sta` binary rejects them ("invalid command name
# read_lef"). Use the openroad binary, which embeds OpenSTA plus these.
OR_BIN="$(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null | grep 'python3.*env' | head -1)"

SCRIPT=/tmp/period_sweep.tcl

for period in 10 14 18 22 26 30 34 38; do
  cat > "$SCRIPT" <<TCL
read_liberty $PDK_LIB
read_lef $LEF_TECH
read_lef $LEF_CELLS
read_lef $LEF_EF
read_def $DEF
read_spef $SPEF
set src_period 6.0
set axi_period $period.0
create_clock -name src_clk -period \$src_period [get_ports src_clk_i]
create_clock -name axi_clk -period \$axi_period [get_ports axi_clk_i]
set_clock_uncertainty [expr {\$src_period * 0.05}] src_clk
set_clock_uncertainty [expr {\$axi_period * 0.05}] axi_clk
set_clock_groups -asynchronous -group [get_clocks src_clk] -group [get_clocks axi_clk]
set_false_path -from [get_ports rst_ni]
report_worst_slack -max
report_tns
TCL
  echo "=== axi_clk period = ${period} ns ==="
  "$OR_BIN" -no_init -exit "$SCRIPT" 2>&1 | grep -E 'worst slack|tns|Error'
  echo
done
