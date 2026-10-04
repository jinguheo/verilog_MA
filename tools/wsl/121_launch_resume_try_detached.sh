#!/usr/bin/env bash
# Detached launcher for the three axi54 timing-closure resumes (650x985 full flow,
# 590x1085 and 450x1422 up to post-PnR STA). Staggered; prints PIDs and returns.
#   bash 121_launch_resume_try_detached.sh
set -euo pipefail
D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
mkdir -p "$D/logs"
go() { setsid nohup bash "$D/120_resume_reshape_try.sh" "$@" > "$D/logs/resume_try_${1}_${2}.out" 2>&1 < /dev/null & echo "resumed $1 $2 ($4) pid $!"; sleep 20; }
go 650x985 axi54 OpenROAD.DetailedRouting full
go 590x1085 axi54 OpenROAD.DetailedRouting sta
go 450x1422 axi54 OpenROAD.DetailedRouting sta
