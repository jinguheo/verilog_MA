#!/usr/bin/env bash
# Fill the remaining gaps found by 50_gap_check.sh.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/51_install_gaps.sh
#
# Why each:
#   iverilog  - gate-level simulation with SDF back-annotation. Verilator does
#               not support SDF timing, so post-synthesis and post-layout GLS
#               need Icarus.
#   ngspice   - the sky130 PDK ships ngspice models; needed for any SPICE-level
#               check on an extracted netlist.
#   verilator - fast RTL simulation inside WSL (the existing one is a Windows
#               build and cannot be driven from here).
#   gtkwave   - waveform viewer for the VCDs the above produce.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== installing ==="
for p in iverilog ngspice verilator gtkwave; do
  printf '%-10s ' "$p"
  if sudo -n apt-get install -y -qq "$p" >/dev/null 2>&1; then echo 'ok'; else echo 'FAILED'; fi
done

echo
echo "=== versions ==="
for t in iverilog ngspice verilator gtkwave; do
  printf '%-10s ' "$t"
  if command -v "$t" >/dev/null 2>&1; then "$t" -V 2>&1 | head -1 || "$t" --version 2>&1 | head -1; else echo '(missing)'; fi
done

echo
echo "=== can GUI tools display? (WSLg) ==="
echo "DISPLAY=${DISPLAY:-<unset>}  WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-<unset>}"
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo 'WSLg appears available - KLayout and Magic GUIs should open on the Windows desktop.'
else
  echo 'No display detected - GUI tools would need to run in batch mode only.'
fi

echo
echo "=== klayout batch sanity (no GUI needed) ==="
klayout -b -e -rd x=1 -r /dev/null 2>&1 | head -3 || echo '(klayout batch invocation differs; will check later)'

echo
df -h "$HOME" | tail -1
