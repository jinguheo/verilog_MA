#!/usr/bin/env bash
# Verify the sky130 PDK has the files a real flow needs.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/41_pdk_verify.sh
#
# volare installs the selected build under $PDK_ROOT/volare/... and points
# sky130A at it with a symlink, so every traversal here uses `find -L`.
set -uo pipefail

PDK_ROOT="$HOME/eda/pdk"
A="$PDK_ROOT/sky130A"

echo "=== sky130A resolves to ==="
readlink -f "$A"

echo
echo "=== counts ==="
printf 'liberty (.lib) : %s\n' "$(find -L "$A" -name '*.lib'  2>/dev/null | wc -l)"
printf 'LEF     (.lef) : %s\n' "$(find -L "$A" -name '*.lef'  2>/dev/null | wc -l)"
printf 'GDS            : %s\n' "$(find -L "$A" -name '*.gds*' 2>/dev/null | wc -l)"
printf 'verilog models : %s\n' "$(find -L "$A" -name '*.v'    2>/dev/null | wc -l)"

echo
echo "=== tech files for magic / klayout / netgen ==="
find -L "$A/libs.tech" -maxdepth 2 -type f 2>/dev/null | head -14

echo
echo "=== target library: sky130_fd_sc_hd ==="
HD="$A/libs.ref/sky130_fd_sc_hd"
printf 'techlef : '; find -L "$HD/techlef" -name '*.lef' 2>/dev/null | head -2
printf 'macro lef: '; find -L "$HD/lef" -name '*.lef' 2>/dev/null | head -2
echo '--- typical corner used for signoff ---'
find -L "$HD/lib" -name '*tt_025C_1v80*' 2>/dev/null | head -3

echo
echo "=== size on disk ==="
du -shL "$A" 2>/dev/null | cut -f1
df -h "$HOME" | tail -1
