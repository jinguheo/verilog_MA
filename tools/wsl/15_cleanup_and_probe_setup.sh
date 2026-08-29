#!/usr/bin/env bash
# The host clock is fixed, so drop the apt date workaround, then work out how
# far ORFS setup.sh actually got before it bailed on Ubuntu 26.04.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/15_cleanup_and_probe_setup.sh
set -uo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"

echo "=== removing the apt clock-skew workaround ==="
if [ -f /etc/apt/apt.conf.d/99-clock-skew ]; then
  sudo -n rm -f /etc/apt/apt.conf.d/99-clock-skew
  echo 'removed'
else
  echo 'not present'
fi
echo "--- apt still works without it? ---"
sudo -n apt-get update -qq && echo 'apt-get update: OK' || echo 'apt-get update: FAILED (workaround may be needed again)'

echo
echo "=== setup.sh options ==="
sed -n '1,60p' "$ORFS/etc/DependencyInstaller.sh" 2>/dev/null | grep -nE '^\s*(-|_help|usage|echo .*-)' | head -25
echo '--- usage text ---'
bash "$ORFS/setup.sh" -h 2>&1 | head -25

echo
echo "=== are the OpenROAD build dependencies actually present? ==="
for p in cmake ninja swig bison flex tcl-dev libboost-all-dev libeigen3-dev libspdlog-dev \
         libreadline-dev zlib1g-dev libffi-dev; do
  printf '%-22s ' "$p"
  if dpkg -s "$p" >/dev/null 2>&1; then echo 'installed'; else echo 'MISSING'; fi
done

echo
echo "=== tools ORFS expects, already satisfied from the distro ==="
for t in klayout yosys cmake ninja swig; do
  printf '%-9s ' "$t"; command -v "$t" 2>/dev/null || echo '(none)'
done

echo
echo "=== ORFS tree ==="
du -sh "$ORFS" 2>/dev/null
ls -1 "$ORFS/tools" 2>/dev/null
