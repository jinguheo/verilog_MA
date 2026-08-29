#!/usr/bin/env bash
# Finish the analog side and report overall readiness.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/53_finish_analog.sh
#
# Xyce and gaw are not in the Ubuntu 26.04 archive. Neither is required:
#   - ngspice covers the simulation need; Xyce is a speed upgrade for large
#     circuits, and building it from source is a separate multi-hour project.
#   - waveform viewing is covered by gtkwave (digital VCD) and by reading
#     ngspice raw files with numpy/matplotlib, which is scriptable and better
#     suited to automated characterisation than a GUI viewer.
set -uo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== extra analog helpers available in the distro ==="
for p in python3-scipy xterm tcl-tclreadline; do
  printf '%-20s ' "$p"
  if ! apt-cache show "$p" >/dev/null 2>&1; then echo 'not in repo'
  elif sudo -n apt-get install -y -qq "$p" >/dev/null 2>&1; then echo 'ok'
  else echo 'FAILED'; fi
done

echo
echo "=== does ngspice have the sky130 raw-file reader path working? ==="
python3 - <<'PY' 2>&1 | head -5
try:
    import numpy, matplotlib
    print("numpy", numpy.__version__, "| matplotlib", matplotlib.__version__, "-> raw-file post-processing OK")
except Exception as e:
    print("post-processing stack missing:", e)
PY

echo
echo "=== xschem sky130 setup present? ==="
PDK="$HOME/eda/pdk/sky130A"
ls -1 "$PDK/libs.tech/xschem" 2>/dev/null | head -10

echo
echo "=== OVERALL TOOL INVENTORY ==="
printf '%-14s %s\n' 'STAGE' 'TOOL'
for pair in \
  "RTL sim:verilator" "RTL sim:iverilog" "waveform:gtkwave" \
  "synthesis:yosys" "P&R:openroad" "STA:sta" \
  "DRC:magic" "DRC:klayout" "LVS:netgen-lvs" \
  "schematic:xschem" "SPICE:ngspice" "math:octave"; do
  stage="${pair%%:*}"; tool="${pair##*:}"
  printf '%-14s %-12s ' "$stage" "$tool"
  command -v "$tool" >/dev/null 2>&1 && echo 'installed' || echo 'MISSING'
done

echo
echo "=== OpenROAD build progress ==="
ORFS="$HOME/eda/OpenROAD-flow-scripts"
if pgrep -f 'bazel|cc1plus|ninja' >/dev/null 2>&1; then
  echo "build is running: $(pgrep -fc 'bazel|cc1plus|ninja|java') related processes"
else
  echo 'no build processes currently running'
fi
find "$ORFS/tools/OpenROAD/build" -maxdepth 3 -name openroad -perm -u+x 2>/dev/null | head -2 \
  || echo '(openroad binary not produced yet)'
tail -3 "$ORFS/tools/OpenROAD/build/openroad_build.log" 2>/dev/null || true

echo
df -h "$HOME" | tail -1
