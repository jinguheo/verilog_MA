#!/usr/bin/env bash
# Find OpenSTA's actual set_max_delay syntax from its own Tcl sources rather
# than guessing.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/96_check_opensta_syntax.sh
set -uo pipefail

STA_DIR="$(find /nix/store -maxdepth 1 -type d -name '*opensta*' 2>/dev/null | head -1)"
echo "opensta store dir: $STA_DIR"

echo
echo "=== grep for set_max_delay definition ==="
grep -rn 'proc set_max_delay\|sta_proc set_max_delay\|define_cmd_args.*set_max_delay' "$STA_DIR" 2>/dev/null | head -10

echo
echo "=== grep for datapath_only anywhere in opensta's own tcl/share ==="
grep -rn 'datapath_only\|data_path_only' "$STA_DIR" 2>/dev/null | head -20

echo
echo "=== does 'help' inside sta show it? ==="
STA_BIN="$(find /nix/store -maxdepth 3 -type f -name sta -perm -u+x 2>/dev/null | grep opensta | head -1)"
echo "puts [sta::cmd_usage_msg set_max_delay]" | "$STA_BIN" -no_init -exit /dev/stdin 2>&1 | tail -10
