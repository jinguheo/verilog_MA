#!/usr/bin/env bash
# What is still missing for a complete RTL-to-GDS + signoff flow?
# Read-only: this does not install anything while a build is running.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/50_gap_check.sh
set -uo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"

echo "=== present ==="
for t in yosys klayout magic netgen-lvs python3 bazelisk; do
  printf '%-11s ' "$t"; command -v "$t" 2>/dev/null || echo '(none)'
done

echo
echo "=== candidates still absent ==="
for t in iverilog ngspice verilator sta openroad cvc; do
  printf '%-11s ' "$t"; command -v "$t" 2>/dev/null || echo '(none)'
done

echo
echo "=== can the distro yosys read SystemVerilog? ==="
# Our RTL is SystemVerilog (packages, typedefs, structs). Plain read_verilog
# -sv is limited; the slang frontend is what Sample Test 2/3 rely on.
yosys -p 'plugin -i slang; help read_slang' 2>&1 | head -4 || echo 'slang plugin: NOT available in distro yosys'

echo
echo "=== does the ORFS yosys build include slang? ==="
grep -rniE 'yosys[_-]?slang|SLANG_REVISION' "$ORFS/tools/yosys/CMakeLists.txt" 2>/dev/null | head -5
ls -d "$ORFS/tools/yosys"/*slang* 2>/dev/null || echo '(no slang dir yet - build in progress)'

echo
echo "=== sky130 extras that matter ==="
PDK="$HOME/eda/pdk/sky130A"
printf 'SRAM macros   : '; ls -d "$PDK/libs.ref/sky130_sram_macros" 2>/dev/null || echo '(none)'
printf 'magic tech    : '; find -L "$PDK/libs.tech/magic" -name '*.tech' 2>/dev/null | head -1
printf 'netgen setup  : '; find -L "$PDK/libs.tech/netgen" -name '*setup*' 2>/dev/null | head -1
printf 'klayout drc   : '; find -L "$PDK/libs.tech/klayout" -name '*.lydrc' -o -name '*drc*' 2>/dev/null | head -1
printf 'ngspice models: '; find -L "$PDK/libs.tech/ngspice" -maxdepth 1 -type f 2>/dev/null | head -1

echo
echo "=== ORFS platforms available (which PDKs the flow can target) ==="
ls -1 "$ORFS/flow/platforms" 2>/dev/null | head -12

echo
echo "=== ORFS sky130 platform config present? ==="
ls -1 "$ORFS/flow/platforms/sky130hd" 2>/dev/null | head -8
