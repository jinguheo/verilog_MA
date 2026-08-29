#!/usr/bin/env bash
# Analog / mixed-signal toolchain.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/52_analog_tools.sh
#
# Why each:
#   xschem  - schematic capture; the standard front end for sky130 analog work
#             and what produces the ngspice netlists.
#   xyce    - parallel SPICE from Sandia; faster than ngspice once a circuit
#             grows. Optional, tried but not required.
#   gaw     - waveform viewer that reads ngspice raw files directly.
#   octave  - post-processing of simulation output.
#
# ngspice, magic, netgen-lvs and the sky130 device models are already present.
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== from the distro ==="
for p in xschem xyce gaw octave python3-numpy python3-matplotlib; do
  printf '%-20s ' "$p"
  if ! apt-cache show "$p" >/dev/null 2>&1; then
    echo 'not in repo'
  elif sudo -n apt-get install -y -qq "$p" >/dev/null 2>&1; then
    echo 'ok'
  else
    echo 'FAILED'
  fi
done

echo
echo "=== versions ==="
for t in ngspice xschem Xyce gaw octave magic netgen-lvs; do
  printf '%-11s ' "$t"
  if command -v "$t" >/dev/null 2>&1; then command -v "$t"; else echo '(not installed)'; fi
done

echo
echo "=== sky130 analog assets ==="
PDK="$HOME/eda/pdk/sky130A"
printf 'ngspice models   : %s files\n' "$(find -L "$PDK/libs.tech/ngspice" -type f 2>/dev/null | wc -l)"
printf 'xschem symbols   : %s\n' "$(find -L "$PDK/libs.tech/xschem" -maxdepth 1 -type d 2>/dev/null | wc -l)"
printf 'magic tech       : '; find -L "$PDK/libs.tech/magic" -name 'sky130A.tech' 2>/dev/null | head -1
printf 'netgen setup     : '; find -L "$PDK/libs.tech/netgen" -name '*setup.tcl' 2>/dev/null | head -1
printf 'primitive devices: %s\n' "$(find -L "$PDK/libs.ref/sky130_fd_pr" -maxdepth 1 -type d 2>/dev/null | wc -l)"

echo
echo "=== ngspice can load a sky130 model? ==="
# A one-line smoke test: ask ngspice to source the corner file and quit.
CORNER="$(find -L "$PDK/libs.tech/ngspice" -name 'sky130.lib.spice' 2>/dev/null | head -1)"
if [ -n "$CORNER" ]; then
  echo "corner lib: $CORNER"
  printf '.lib %s tt\n.end\n' "$CORNER" > /tmp/_sky130_smoke.spice
  ngspice -b /tmp/_sky130_smoke.spice 2>&1 | tail -5
else
  echo 'sky130.lib.spice not found'
fi

echo
df -h "$HOME" | tail -1
