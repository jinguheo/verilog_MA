#!/usr/bin/env bash
# Detached launcher for 120_resume_reshape_try.sh (any shape/variant/from-step/scope).
#   bash 124_resume_try_detached.sh 590x1085 axi54ant2 Odb.CellFrequencyTables full
set -euo pipefail
D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
mkdir -p "$D/logs"
setsid nohup bash "$D/120_resume_reshape_try.sh" "$@" > "$D/logs/resume_try_${1}_${2}.out" 2>&1 < /dev/null &
echo "resumed $1 $2 from $3 ($4) pid $!"
