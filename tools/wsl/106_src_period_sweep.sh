#!/usr/bin/env bash
# axi_clk closes around 30ns (previous sweep). Hold axi_clk generously above
# that and find what src_period the skid_buffer/pkt_align byte-select chain
# actually needs, using the real routed+extracted parasitics.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/106_src_period_sweep.sh
set -euo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
DEF="$(find "$RUN" -maxdepth 2 -name 'chan_top.def' | sort | tail -1)"
SPEF="$RUN/53-openroad-rcx/max/chan_top.max.spef"
PDK=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd
PDK_LIB="$PDK/lib/sky130_fd_sc_hd__ss_100C_1v60.lib"
LEF_TECH="$PDK/techlef/sky130_fd_sc_hd__nom.tlef"
LEF_CELLS="$PDK/lef/sky130_fd_sc_hd.lef"
LEF_EF="$PDK/lef/sky130_ef_sc_hd.lef"
OR_BIN="$(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null | grep 'python3.*env' | head -1)"

SCRIPT=/tmp/src_sweep.tcl
for src_p in 6 8 10 12; do
  cat > "$SCRIPT" <<TCL
read_liberty $PDK_LIB
read_lef $LEF_TECH
read_lef $LEF_CELLS
read_lef $LEF_EF
read_def $DEF
read_spef $SPEF
create_clock -name src_clk -period $src_p.0 [get_ports src_clk_i]
create_clock -name axi_clk -period 40.0 [get_ports axi_clk_i]
set_clock_uncertainty [expr {$src_p * 0.05}] src_clk
set_clock_uncertainty 2.0 axi_clk
set_clock_groups -asynchronous -group [get_clocks src_clk] -group [get_clocks axi_clk]
set_false_path -from [get_ports rst_ni]
puts "--- src_clk group ---"
report_worst_slack -max
report_tns
TCL
  echo "=== src_clk period = ${src_p} ns (axi_clk fixed at 40 ns) ==="
  "$OR_BIN" -no_init -exit "$SCRIPT" 2>&1 | grep -E 'worst slack|tns|Error'
  echo
done
