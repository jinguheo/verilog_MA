#!/usr/bin/env bash
# Launch 118_run_reshape_variant.sh for several variants of one shape in
# parallel, fully detached (setsid+nohup), staggered so synthesis-free start-up
# doesn't collide.
#   bash 119_launch_variants_detached.sh 650x985 hold0 hold0_setup axi54
set -euo pipefail
D=/mnt/d/MyWork/Veriolg_MA/tools/wsl
shape="${1:?shape}"; shift
mkdir -p "$D/logs"
for v in "$@"; do
  setsid nohup bash "$D/118_run_reshape_variant.sh" "$shape" "$v" ${SCOPE:+$SCOPE} > "$D/logs/try_${shape}_${v}.out" 2>&1 < /dev/null &
  echo "launched $shape $v pid $!"
  sleep 25
done
