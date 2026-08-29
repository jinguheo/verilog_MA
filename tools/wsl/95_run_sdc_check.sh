#!/usr/bin/env bash
# Validate the SDC against the already-synthesized chan_top netlist, without
# re-running P&R. A few seconds instead of ~10 minutes.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/95_run_sdc_check.sh
set -euo pipefail
STA_BIN="$(find /nix/store -maxdepth 3 -type f -name sta -perm -u+x 2>/dev/null | grep opensta | head -1)"
[ -x "$STA_BIN" ] || { echo "sta not found" >&2; exit 1; }
"$STA_BIN" -no_init -exit /mnt/d/MyWork/Veriolg_MA/tools/wsl/94_sdc_check.tcl
