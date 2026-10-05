#!/usr/bin/env bash
# Full PPA3 flow from RTL with a variant config (config_<variant>.json). Run dir runs/ppa3_<variant>.
#   bash 126_run_ppa3_full.sh pwr1
set -uo pipefail
variant="${1:?variant}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"
TAG="ppa3_${variant}"; LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/${TAG}.summary"
echo "=== $TAG full flow start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite "$BASE/config_${variant}.json" > "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
M="$BASE/runs/$TAG/final/metrics.json"
[ -f "$M" ] && grep -E '"(timing__setup__ws|timing__hold__ws|antenna__violating__nets|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|design__xor_difference__count|magic__illegal_overlap__count|power__total)"' "$M" | tee -a "$SUM"
