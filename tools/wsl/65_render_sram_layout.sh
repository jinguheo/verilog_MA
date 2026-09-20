#!/usr/bin/env bash
set -euo pipefail
GDS=/mnt/d/MyWork/Veriolg_MA/analog/third_party/sky130_sram_macros/sky130_sram_1kbyte_1rw1r_32x256_8/sky130_sram_1kbyte_1rw1r_32x256_8.gds
OUT=/mnt/d/MyWork/Veriolg_MA/analog/layout_render
PDK="$HOME/eda/pdk/sky130A"

[ -f "$GDS" ] || { echo "GDS not found: $GDS" >&2; exit 1; }
LYP="$(find -L "$PDK/libs.tech/klayout" -name '*.lyp' 2>/dev/null | head -1 || true)"

klayout -z -rd gds="$GDS" -rd lyp="${LYP:-}" -rd out="$OUT" -r /mnt/d/MyWork/Veriolg_MA/tools/wsl/render_gds.py
