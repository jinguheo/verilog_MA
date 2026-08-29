#!/usr/bin/env bash
set -uo pipefail
PDK=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af/sky130A
find "$PDK" -iname '*ef_sc_hd*' \( -name '*.lef' -o -name '*.lib' \) 2>/dev/null
