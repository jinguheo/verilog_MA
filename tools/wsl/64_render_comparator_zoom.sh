#!/usr/bin/env bash
set -euo pipefail
GDS=/mnt/d/MyWork/Veriolg_MA/analog/third_party/sky130_ef_ip__adc3v_12bit/gds/sky130_ef_ip__adc3v_12bit.gds
OUT=/mnt/d/MyWork/Veriolg_MA/analog/layout_render
LYP=/home/oem/eda/pdk/sky130A/libs.tech/klayout/tech/sky130A.lyp
klayout -z -rd gds="$GDS" -rd lyp="$LYP" -rd out="$OUT" -r /mnt/d/MyWork/Veriolg_MA/tools/wsl/render_comparator_zoom.py
