#!/usr/bin/env bash
# Timing-closure experiment: take an already-placed chan_top reshape run
# (reshape_full_<shape>, from 115) and re-run ONLY the back end (CTS -> route ->
# post-PnR STA, optionally on to signoff) with a variant config, reusing the
# detailed-placement state instead of redoing synthesis+placement (~20 min saved).
#
#   bash 118_run_reshape_variant.sh 650x985 hold0                # CTS -> STAPostPNR (~25 min)
#   bash 118_run_reshape_variant.sh 650x985 hold0 full           # CTS -> end incl. DRC/LVS
#
# Variant config: samples/sample_test_4/asic/chan_top/config_reshape_<shape>_<variant>.json
# Run dir:        runs/reshape_try_<shape>_<variant>   Summary: logs/reshape_try_<shape>_<variant>.summary
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
shape="${1:?shape}"; variant="${2:?variant}"; scope="${3:-sta}"
BASE="$REPO/samples/sample_test_4/asic/chan_top"
CFG="$BASE/config_reshape_${shape}_${variant}.json"
STATE="$BASE/runs/reshape_full_${shape}/33-openroad-detailedplacement/state_out.json"
TAG="reshape_try_${shape}_${variant}"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"
SUM="$LOGS/${TAG}.summary"
[ -f "$CFG" ] && [ -f "$STATE" ] || { echo "missing $CFG or $STATE" >&2; exit 1; }

TO=(); [ "$scope" = "sta" ] && TO=(--to OpenROAD.STAPostPNR)
echo "=== $TAG scope=$scope start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite --with-initial-state "$STATE" --from OpenROAD.CTS "${TO[@]}" "$CFG" > "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
RUN="$BASE/runs/$TAG"
M="$RUN/final/metrics.json"
if [ -f "$M" ]; then
  grep -E '"(timing__setup__ws|timing__setup__tns|timing__hold__ws|timing__setup_vio__count|design__instance__count|design__instance__area|route__wirelength|antenna__violating__nets|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|power__total)"' "$M" | tee -a "$SUM"
else
  # stopped at STAPostPNR: no final/, read the post-PnR STA summary instead
  S=$(ls -d "$RUN"/*stapostpnr 2>/dev/null | tail -1)
  [ -n "$S" ] && grep -E 'max_ss_100C_1v60|nom_ss|nom_tt' "$S/summary.rpt" | cut -c1-120 | tee -a "$SUM"
  [ -n "$S" ] || { echo "no STA output; log tail:" | tee -a "$SUM"; tail -20 "$LOGS/${TAG}.log" | tee -a "$SUM"; }
fi
