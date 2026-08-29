#!/usr/bin/env bash
# Report what is currently installed. Safe to re-run at any point.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/11_status.sh
#
# Deliberately does NOT use `set -e`: a missing tool is information, not a failure.
set -uo pipefail

echo "=== tool locations ==="
for t in yosys openroad sta klayout magic netgen volare python3 tclsh cmake g++ git; do
  printf '%-9s ' "$t"
  command -v "$t" 2>/dev/null || echo '(not installed)'
done

echo
echo "=== netgen: which one is it? ==="
# Debian ships two unrelated tools called netgen. The LVS tool used in ASIC
# flows is netgen-lvs; plain 'netgen' is an FEM mesh generator.
if dpkg -s netgen >/dev/null 2>&1; then
  dpkg -s netgen 2>/dev/null | grep -E '^(Package|Version)'
  dpkg -s netgen 2>/dev/null | grep -m1 '^Description'
fi
echo "--- netgen-lvs availability ---"
apt-cache policy netgen-lvs 2>/dev/null | head -3 || echo 'not in repo'

echo
echo "=== versions ==="
if command -v klayout >/dev/null 2>&1; then printf 'klayout   '; klayout -v 2>&1 | head -1; fi
if command -v magic   >/dev/null 2>&1; then printf 'magic     '; magic --version 2>&1 | head -1; fi
if command -v yosys   >/dev/null 2>&1; then printf 'yosys     '; yosys -V 2>&1 | head -1; fi
if command -v openroad >/dev/null 2>&1; then printf 'openroad  '; openroad -version 2>&1 | head -1; fi
printf 'python3   '; python3 --version 2>&1
printf 'cmake     '; cmake --version 2>&1 | head -1

echo
echo "=== pip / venv ==="
python3 -c 'import venv' 2>/dev/null && echo 'venv: ok' || echo 'venv: MISSING'
python3 -m pip --version 2>/dev/null || echo 'pip: MISSING (use venv or pipx)'

echo
echo "=== disk ==="
df -h "$HOME" | tail -1
