#!/usr/bin/env bash
# Stronger antenna repair on an already-timed chan_top reshape run: restart from
# OpenROAD.GlobalRouting (state after the post-CTS STA, step 04 of reshape_try_<shape>_axi54)
# with GRT_ANTENNA_MARGIN/ITERS raised (config_reshape_<shape>_axi54ant.json).
#
#   bash 122_run_reshape_antenna.sh 590x1085 [sta|full] [variant]   # default sta, variant axi54ant (or axi54ant2)
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
shape="${1:?shape}"; scope="${2:-sta}"; variant="${3:-axi54ant}"
BASE="$REPO/samples/sample_test_4/asic/chan_top"
CFG="$BASE/config_reshape_${shape}_${variant}.json"
STATE="$BASE/runs/reshape_try_${shape}_axi54/04-openroad-stamidpnr-2/state_out.json"
TAG="reshape_try_${shape}_${variant}"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/${TAG}.summary"
[ -f "$CFG" ] && [ -f "$STATE" ] || { echo "missing $CFG or $STATE" >&2; exit 1; }
TO=(); [ "$scope" = "sta" ] && TO=(--to OpenROAD.STAPostPNR)
echo "=== $TAG scope=$scope start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite --with-initial-state "$STATE" --from OpenROAD.GlobalRouting "${TO[@]}" "$CFG" > "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
RUN="$BASE/runs/$TAG"; M="$RUN/final/metrics.json"
if [ -f "$M" ]; then
  grep -E '"(timing__setup__ws|timing__setup_vio__count|timing__hold__ws|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|antenna__violating__nets|antenna__violating__pins)"' "$M" | tee -a "$SUM"
else
  A=$(ls -d "$RUN"/*checkantennas-1 2>/dev/null | tail -1)
  [ -n "$A" ] && grep -E '"antenna__violating__(nets|pins)"' "$A/or_metrics_out.json" 2>/dev/null | tee -a "$SUM"
  S=$(ls -d "$RUN"/*stapostpnr 2>/dev/null | tail -1)
  [ -n "$S" ] && grep -E 'max_ss_100C_1v60' "$S/summary.rpt" | cut -c1-120 | tee -a "$SUM"
  [ -n "$S" ] || { echo "no STA output; log tail:" | tee -a "$SUM"; tail -15 "$LOGS/${TAG}.log" | tee -a "$SUM"; }
fi
