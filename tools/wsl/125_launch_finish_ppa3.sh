#!/usr/bin/env bash
D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
mkdir -p "$D/logs"
setsid nohup bash "$D/124_finish_ppa3.sh" "${1:-ppa3_antfix3_signoff}" > "$D/logs/launch_124_finish_ppa3.out" 2>&1 < /dev/null &
echo "launched finish driver pid $!"
sleep 8
