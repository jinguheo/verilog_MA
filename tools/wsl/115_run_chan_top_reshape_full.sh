#!/usr/bin/env bash
# FULL OpenLane flow (CTS, route, fill, STA, DRC, LVS - everything) for chan_top
# reshape candidates, following the placement-only probe in
# 114_render_chan_top_reshapes.sh. Each shape gets its own named run directory
# (--run-tag reshape_full_<WxH>) so results can't be confused with the
# placement-only probe runs or the signed-off 800x800 run.
#
# Shapes passed as args run SEQUENTIALLY in this process; launch the script
# twice with disjoint shape lists to run two flows in parallel (the box has 8
# cores / 15 GB - two flows fit, four would starve each other).
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/115_run_chan_top_reshape_full.sh 650x985 500x1280
#
# Per-shape summary lands in tools/wsl/logs/reshape_full_<shape>.summary.
set -uo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
SHIM="$HOME/.cache/openlane-tools-chan_top/bin"
LOGS="$REPO/tools/wsl/logs"

[ -x "$OL" ] || { echo "openlane not found at $OL" >&2; exit 1; }
[ -L "$SHIM/yosys" ] || { echo "shim missing at $SHIM - run 111_run_chan_top_safe.sh or 114_* once first" >&2; exit 1; }
export PATH="$SHIM:$PATH"
mkdir -p "$LOGS"

[ "$#" -gt 0 ] || { echo "usage: $0 WxH [WxH...]" >&2; exit 1; }

for shape in "$@"; do
  CFG="$REPO/samples/sample_test_4/asic/chan_top/config_reshape_${shape}.json"
  [ -f "$CFG" ] || { echo "no config for $shape" >&2; continue; }
  TAG="reshape_full_${shape}"
  SUM="$LOGS/${TAG}.summary"
  echo "=== $shape : full flow start $(date -Is) ===" | tee "$SUM"
  cd "$ROOT"
  "$OL" --run-tag "$TAG" --overwrite "$CFG" > "$LOGS/${TAG}.log" 2>&1
  rc=$?
  echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
  RUN="$REPO/samples/sample_test_4/asic/chan_top/runs/$TAG"
  M="$RUN/final/metrics.json"
  if [ -f "$M" ]; then
    grep -E '"(design__instance__count|design__instance__area|design__instance__utilization|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|timing__setup__ws|timing__setup__tns|timing__hold__ws|timing__hold__tns|route__wirelength|antenna__violating__nets|design__violations)"' "$M" | tee -a "$SUM"
  else
    echo "no final/metrics.json - flow stopped early; last log lines:" | tee -a "$SUM"
    tail -25 "$LOGS/${TAG}.log" | tee -a "$SUM"
  fi
done
