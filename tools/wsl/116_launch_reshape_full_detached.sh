#!/usr/bin/env bash
# Launch two parallel 115_run_chan_top_reshape_full.sh workers fully detached
# from the calling session (setsid + nohup), so a multi-hour flow survives the
# caller's shell/tool timeout. Prints the two PIDs and returns immediately.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/116_launch_reshape_full_detached.sh
set -euo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
S="$REPO/tools/wsl/115_run_chan_top_reshape_full.sh"
L="$REPO/tools/wsl/logs"
mkdir -p "$L"

setsid nohup bash "$S" 590x1085 650x985 > "$L/worker_A.out" 2>&1 < /dev/null &
echo "worker A pid $!  (590x1085 -> 650x985)"
sleep 40   # stagger: runs are named by tag, but synthesis start-up shouldn't collide
setsid nohup bash "$S" 500x1280 450x1422 > "$L/worker_B.out" 2>&1 < /dev/null &
echo "worker B pid $!  (500x1280 -> 450x1422)"
