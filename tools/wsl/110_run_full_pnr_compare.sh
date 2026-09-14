#!/usr/bin/env bash
# Re-verify the SYNTH_STRATEGY choices picked from 107_synth_explore.sh's
# pre-placement comparison by running the FULL default OpenLane flow (real
# placement/routing, not just synthesis+STAPrePNR) and diffing against each
# design's last full-flow run from before SYNTH_STRATEGY was set in
# config.json. Runs chan_ctrl and cnt_sat concurrently via
# 109_run_full_pnr.sh, since each uses its own per-design shim.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/110_run_full_pnr_compare.sh
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
SAMPLE="$REPO/samples/sample_test_4"
SCRIPT="$REPO/tools/wsl/109_run_full_pnr.sh"
LOGDIR="$SAMPLE/asic/pnr_compare_logs"
mkdir -p "$LOGDIR"

# Baseline (pre-SYNTH_STRATEGY, AREA 0 default) full-flow runs, read before
# this script's new runs are launched.
declare -A BASELINE_RUN=(
  [chan_ctrl]="RUN_2026-08-28_19-29-14"
  [cnt_sat]="RUN_2026-08-26_12-43-50"
)

metric() {
  local file="$1" key="$2"
  grep -E "\"$key\":" "$file" | head -1 | sed -E 's/.*: *([0-9.eE+-]+).*/\1/'
}

echo "=== Baseline (pre-SYNTH_STRATEGY) metrics ==="
for d in chan_ctrl cnt_sat; do
  f="$SAMPLE/asic/$d/runs/${BASELINE_RUN[$d]}/final/metrics.json"
  area="$(metric "$f" design__instance__area)"
  ws="$(metric "$f" timing__setup__ws)"
  tns="$(metric "$f" timing__setup__tns)"
  echo "  $d (${BASELINE_RUN[$d]}): area=${area} um^2  worst_slack=${ws}ns  tns=${tns}"
done

echo
echo "=== Running full P&R with new SYNTH_STRATEGY (chan_ctrl=AREA2, cnt_sat=AREA1), concurrently ==="
pids=()
for d in chan_ctrl cnt_sat; do
  bash "$SCRIPT" "$d" > "$LOGDIR/${d}_full_pnr.log" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done
echo "both runs finished"

echo
echo "=== New metrics (SYNTH_STRATEGY applied) ==="
for d in chan_ctrl cnt_sat; do
  RUN="$(find "$SAMPLE/asic/$d/runs" -maxdepth 1 -type d -name 'RUN_*' | sort | tail -1)"
  f="$RUN/final/metrics.json"
  if [ -f "$f" ]; then
    area="$(metric "$f" design__instance__area)"
    ws="$(metric "$f" timing__setup__ws)"
    tns="$(metric "$f" timing__setup__tns)"
    echo "  $d ($RUN): area=${area} um^2  worst_slack=${ws}ns  tns=${tns}"
  else
    echo "  $d: NO final/metrics.json - check $LOGDIR/${d}_full_pnr.log"
  fi
done

{
  echo "Full P&R re-verification of SYNTH_STRATEGY picks"
  echo "Generated: $(date -Iseconds)"
  echo
  echo "Baseline (AREA 0 default):"
  for d in chan_ctrl cnt_sat; do
    f="$SAMPLE/asic/$d/runs/${BASELINE_RUN[$d]}/final/metrics.json"
    echo "  $d: area=$(metric "$f" design__instance__area) um^2 worst_slack=$(metric "$f" timing__setup__ws)ns tns=$(metric "$f" timing__setup__tns)"
  done
  echo
  echo "After SYNTH_STRATEGY (chan_ctrl=AREA 2, cnt_sat=AREA 1):"
  for d in chan_ctrl cnt_sat; do
    RUN="$(find "$SAMPLE/asic/$d/runs" -maxdepth 1 -type d -name 'RUN_*' | sort | tail -1)"
    f="$RUN/final/metrics.json"
    echo "  $d ($RUN): area=$(metric "$f" design__instance__area) um^2 worst_slack=$(metric "$f" timing__setup__ws)ns tns=$(metric "$f" timing__setup__tns)"
  done
} > "$LOGDIR/comparison_summary.txt"
echo
echo "written: $LOGDIR/comparison_summary.txt"
