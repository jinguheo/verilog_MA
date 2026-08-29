#!/usr/bin/env bash
# The distro yosys installed earlier in this session shadows the one OpenLane
# expects. OpenLane calls `yosys -y <script.py>` (pyosys); yosys 0.52 from apt
# has no -y option, so the flow dies at Generate JSON Header.
#
# Find the yosys the working runs actually used.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/81_find_openlane_yosys.sh
set -uo pipefail

echo "=== what is on PATH now ==="
command -v yosys && yosys -V 2>&1 | head -1

echo
echo "=== does that yosys support -y? ==="
yosys -y /dev/null 2>&1 | head -2

echo
echo "=== yosys binaries elsewhere on the system ==="
for d in /nix/store /home/oem/.venvs /home/oem/openlane_venv_311 /home/oem/.nix-profile /opt; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 6 -type f -name yosys -perm -u+x 2>/dev/null | head -5
done

echo
echo "=== which PATH did the working run record? ==="
OK=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_ctrl/runs/RUN_2026-08-26_13-14-47
grep -ohE '/nix/store/[a-z0-9]+-[^"/]*yosys[^"/:]*' "$OK"/*/COMMANDS "$OK"/flow.log 2>/dev/null | sort -u | head -5
echo '--- any nix store path at all in that run ---'
grep -ohE '/nix/store/[a-z0-9]{32}-[^"/:]+' "$OK/flow.log" 2>/dev/null | sort -u | head -8

echo
echo "=== nix present? ==="
command -v nix 2>/dev/null || echo 'nix not on PATH'
ls -d /nix/store 2>/dev/null && echo "nix store entries: $(ls /nix/store 2>/dev/null | wc -l)" || echo 'no /nix/store'
