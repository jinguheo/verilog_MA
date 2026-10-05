#!/usr/bin/env bash
# Resume a finished/failed PPA3 run from a later step, e.g. the signoff tail (Magic streamout -> DRC -> LVS).
#   bash 123_resume_ppa3.sh antfix3 Magic.StreamOut ppa3_antfix2 20-openroad-irdropreport
# args: config variant, first step id, source run dir (under runs/), source step dir (its state_out.json is the initial state)
# New run dir: runs/ppa3_<variant>_signoff
set -uo pipefail
variant="${1:?variant}"; from="${2:?first step}"; srun="${3:?source run}"; sstep="${4:?source step dir}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"
CFG="$BASE/config_${variant}.json"
STATE="$BASE/runs/$srun/$sstep/state_out.json"
TAG="ppa3_${variant}_signoff"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/${TAG}.summary"
[ -f "$CFG" ] && [ -f "$STATE" ] || { echo "missing $CFG or $STATE" >&2; exit 1; }
echo "=== $TAG start $(date -Is) from $from (state $srun/$sstep) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite --with-initial-state "$STATE" --from "$from" "$CFG" > "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
RUN="$BASE/runs/$TAG"
echo "last step: $(ls -d "$RUN"/[0-9]* 2>/dev/null | tail -1)" | tee -a "$SUM"
M="$RUN/final/metrics.json"
[ -f "$M" ] && grep -E '"(antenna__violating__nets|antenna__violating__pins|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|timing__setup__ws|timing__hold__ws|design__instance__area|power__total|design__xor_difference__count)"' "$M" | tee -a "$SUM"
