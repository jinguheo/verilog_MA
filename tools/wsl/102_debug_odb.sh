#!/usr/bin/env bash
set -uo pipefail
RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
DEF="$(find "$RUN" -maxdepth 2 -name 'chan_top.def' | sort | tail -1)"
PDK_LIB=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lib/sky130_fd_sc_hd__ss_100C_1v60.lib
LEF_TECH=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/techlef/sky130_fd_sc_hd__nom.tlef
LEF_CELLS=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A/libs.ref/sky130_fd_sc_hd/lef/sky130_fd_sc_hd.lef
OR_BIN="$(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null | grep 'python3.*env' | head -1)"

echo "def: $DEF"
cat > /tmp/dbg.tcl <<TCL
read_liberty $PDK_LIB
read_lef $LEF_TECH
read_lef $LEF_CELLS
read_def $DEF
puts "loaded ok"
TCL
"$OR_BIN" -no_init -exit /tmp/dbg.tcl 2>&1 | tail -30
