#!/usr/bin/env bash
# Launch a PPA3 run script fully detached (setsid+nohup) so it survives the calling wsl.exe session.
#   bash 121_launch_ppa3_detached.sh 120_run_ppa3_antenna_fix.sh
#   bash 121_launch_ppa3_detached.sh 122_run_ppa3_variant.sh antfix2
set -euo pipefail

D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
s="${1:?script name}"; shift
mkdir -p "$D/logs"
setsid nohup bash "$D/$s" "$@" > "$D/logs/launch_${s%.sh}_$*.out" 2>&1 < /dev/null &
echo "launched $s pid $!"
sleep 5
