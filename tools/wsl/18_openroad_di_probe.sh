#!/usr/bin/env bash
# OpenROAD ships its own DependencyInstaller, and that is the one that knows how
# to install or-tools. Find out how to drive it before running anything long.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/18_openroad_di_probe.sh
set -uo pipefail

DI="$HOME/eda/OpenROAD-flow-scripts/tools/OpenROAD/etc/DependencyInstaller.sh"

echo "=== usage ==="
bash "$DI" -h 2>&1 | head -40

echo
echo "=== ubuntu version handling ==="
grep -nE 'ubuntu|Ubuntu' "$DI" | grep -iE 'version|24\.04|22\.04|20\.04|case|unsupported' | head -20

echo
echo "=== or-tools install entry points ==="
grep -nE '^_?[a-zA-Z_]+\(\)|OR_TOOLS_VERSION|_installOrTools|ortools.*install' "$DI" | grep -iE 'ortools|or_tools|or-tools|version' | head -20

echo
echo "=== how or-tools is fetched ==="
grep -nE 'or-tools.*(tar|wget|curl|releases)|releases/download' "$DI" | head -12

echo
echo "=== what prefix does it install into ==="
grep -nE 'PREFIX|prefix=|--prefix|/usr/local|\.local' "$DI" | head -15
