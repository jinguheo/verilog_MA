#!/usr/bin/env bash
# Detached launcher for 122 (shapes as args, staggered). SCOPE=full to include DRC/LVS; VARIANT=axi54ant2 etc.
set -euo pipefail
D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
mkdir -p "$D/logs"
for s in "$@"; do
  setsid nohup bash "$D/122_run_reshape_antenna.sh" "$s" "${SCOPE:-sta}" "${VARIANT:-axi54ant}" > "$D/logs/try_${s}_${VARIANT:-axi54ant}.out" 2>&1 < /dev/null &
  echo "launched $s ${VARIANT:-axi54ant} pid $!"; sleep 25
done
