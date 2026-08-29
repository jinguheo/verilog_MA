#!/usr/bin/env bash
# Understand what DependencyInstaller.sh does beyond apt, and where it refuses
# to run on Ubuntu 26.04, so the from-source pieces can be driven directly.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/17_inspect_dependency_installer.sh
set -uo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
DI="$ORFS/etc/DependencyInstaller.sh"

echo "=== file ==="
wc -l "$DI"

echo
echo "=== the version guard that rejects 26.04 ==="
grep -nE '20\.04|22\.04|24\.04|Unsupported|supported' "$DI" | head -20

echo
echo "=== functions defined ==="
grep -nE '^[a-zA-Z_][a-zA-Z0-9_]*\s*\(\)' "$DI" | head -40

echo
echo "=== things installed from source / prebuilt (not apt) ==="
grep -nE 'ortools|OR-Tools|or-tools|wget|curl .*-L|tar .*x|cmake --install|make install|git clone' "$DI" | head -30

echo
echo "=== ortools section in full ==="
awk '/ortools|OR[-_]?Tools/{found=1} found{print NR": "$0} /^}/{if(found) exit}' "$DI" | head -45

echo
echo "=== does OpenROAD's own DependencyInstaller exist too? ==="
OR_DI="$ORFS/tools/OpenROAD/etc/DependencyInstaller.sh"
if [ -f "$OR_DI" ]; then
  wc -l "$OR_DI"
  grep -nE 'ortools|or-tools' "$OR_DI" | head -10
else
  echo '(none)'
fi
