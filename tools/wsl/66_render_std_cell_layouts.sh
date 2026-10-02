#!/usr/bin/env bash
# Render every sky130 standard cell's real GDS layout to PNG for the dashboard's
# Standard Cells tab (my_dashboard/public/stdcells/layout/<lib>/<cell>.png).
set -euo pipefail
PDK="$HOME/eda/pdk/sky130A"
REF="$PDK/libs.ref"
LYP="$PDK/libs.tech/klayout/tech/sky130A.lyp"
OUT=/mnt/d/MyWork/Veriolg_MA/my_dashboard/public/stdcells/layout
SCRIPT=/mnt/d/MyWork/Veriolg_MA/tools/wsl/render_std_cell_layouts.py
render() { # lib gds prefix
  echo "== $1 =="
  klayout -z -rd gds="$2" -rd lyp="$LYP" -rd out="$OUT/$1" -rd prefix="$3" -r "$SCRIPT"
}
render sky130_fd_sc_hd  "$REF/sky130_fd_sc_hd/gds/sky130_fd_sc_hd.gds"   sky130_fd_sc_hd__
render sky130_fd_sc_hvl "$REF/sky130_fd_sc_hvl/gds/sky130_fd_sc_hvl.gds" sky130_fd_sc_hvl__
EF=$(find "$REF" -name 'sky130_ef_sc_hd*.gds' | head -1 || true)
[ -n "$EF" ] && render sky130_ef_sc_hd "$EF" sky130_ef_sc_hd__ || echo "no standalone sky130_ef_sc_hd GDS in this PDK (ef cells skipped)"
