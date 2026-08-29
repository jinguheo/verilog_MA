#!/usr/bin/env bash
# At axi_clk=30ns the worst slack floors at -3.23ns and stops improving with
# more axi_clk period. Find out what that path actually is - if it does not
# involve axi_clk at all, more axi_clk period was never going to fix it.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/104_worst_path_at_30.sh
set -euo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
DEF="$(find "$RUN" -maxdepth 2 -name 'chan_top.def' | sort | tail -1)"
SPEF="$RUN/53-openroad-rcx/max/chan_top.max.spef"
PDK="/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd"
PDK_LIB="$PDK/lib/sky130_fd_sc_hd__ss_100C_1v60.lib"
LEF_TECH="$PDK/techlef/sky130_fd_sc_hd__nom.tlef"
LEF_CELLS="$PDK/lef/sky130_fd_sc_hd.lef"
LEF_EF="$PDK/lef/sky130_ef_sc_hd.lef"
OR_BIN="$(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null | grep 'python3.*env' | head -1)"

cat > /tmp/worst30.tcl <<TCL
read_liberty $PDK_LIB
read_lef $LEF_TECH
read_lef $LEF_CELLS
read_lef $LEF_EF
read_def $DEF
read_spef $SPEF
create_clock -name src_clk -period 6.0  [get_ports src_clk_i]
create_clock -name axi_clk -period 30.0 [get_ports axi_clk_i]
set_clock_uncertainty 0.3 src_clk
set_clock_uncertainty 1.5 axi_clk
set_clock_groups -asynchronous -group [get_clocks src_clk] -group [get_clocks axi_clk]
set_false_path -from [get_ports rst_ni]
report_checks -path_delay max -group_count 3 -endpoint_count 3
report_worst_slack -max
TCL

"$OR_BIN" -no_init -exit /tmp/worst30.tcl 2>&1
