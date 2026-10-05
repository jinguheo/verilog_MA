#!/usr/bin/env bash
# PPA3 track A: close the 2 antenna violations left by RUN_2026-09-24_14-07-59 and keep going to the end of the
# OpenLane flow (steps 59-74: WriteLEF, antenna/XOR/Magic+KLayout DRC, LVS ...), reusing the placed+CTS state
# (step 37) so synthesis/placement/CTS (~25 min) are not redone.
#
#   bash 120_run_ppa3_antenna_fix.sh            # runs in the foreground; use nohup/setsid to detach
#
# Config: asic/ppa3_adc_capture/config_antenna_fix.json (GRT_ANTENNA_ITERS 3->10, GRT_ANTENNA_MARGIN 10->20)
# Run dir: runs/ppa3_antenna_fix        Summary: logs/ppa3_antenna_fix.summary
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"
CFG="$BASE/config_antenna_fix.json"
STATE="$BASE/runs/RUN_2026-09-24_14-07-59/37-openroad-stamidpnr-2/state_out.json"
TAG="ppa3_antenna_fix"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"
SUM="$LOGS/${TAG}.summary"
[ -f "$CFG" ] && [ -f "$STATE" ] || { echo "missing $CFG or $STATE" >&2; exit 1; }
echo "=== $TAG start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite --with-initial-state "$STATE" --from OpenROAD.GlobalRouting "$CFG" > "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
RUN="$BASE/runs/$TAG"
echo "last step: $(ls -d "$RUN"/[0-9]* 2>/dev/null | tail -1)" | tee -a "$SUM"
M="$RUN/final/metrics.json"
[ -f "$M" ] && grep -E '"(antenna__violating__nets|antenna__violating__pins|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|timing__setup__ws|timing__hold__ws|design__instance__area|power__total)"' "$M" | tee -a "$SUM"
