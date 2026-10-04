#!/usr/bin/env bash
# Resume an interrupted 118_run_reshape_variant.sh run (tag reshape_try_<shape>_<variant>)
# from a given OpenLane step id, reusing every finished step. Same idea as
# 117_resume_reshape_full.sh, but for the timing-closure variant runs.
#
#   bash 120_resume_reshape_try.sh 650x985 axi54 OpenROAD.DetailedRouting full
#   bash 120_resume_reshape_try.sh 590x1085 axi54 OpenROAD.DetailedRouting sta
#
# The half-written directory of the interrupted step (highest-numbered one with no
# state_out.json) is removed first. scope=sta stops after OpenROAD.STAPostPNR.
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
shape="${1:?shape}"; variant="${2:?variant}"; from="${3:?step id}"; scope="${4:-sta}"
BASE="$REPO/samples/sample_test_4/asic/chan_top"
CFG="$BASE/config_reshape_${shape}_${variant}.json"
TAG="reshape_try_${shape}_${variant}"
RUN="$BASE/runs/$TAG"
LOGS="$REPO/tools/wsl/logs"; SUM="$LOGS/${TAG}.summary"
[ -d "$RUN" ] && [ -f "$CFG" ] || { echo "missing $RUN or $CFG" >&2; exit 1; }

for d in $(ls "$RUN" | grep -E '^[0-9]+-' | sort -rn); do
  if [ ! -f "$RUN/$d/state_out.json" ]; then echo "removing unfinished step dir $d"; rm -rf "$RUN/$d"; else break; fi
done
TO=(); [ "$scope" = "sta" ] && TO=(--to OpenROAD.STAPostPNR)
echo "=== $TAG RESUME from $from scope=$scope $(date -Is) ===" | tee -a "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --from "$from" "${TO[@]}" "$CFG" >> "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
M="$RUN/final/metrics.json"
if [ -f "$M" ]; then
  grep -E '"(timing__setup__ws|timing__setup__tns|timing__hold__ws|timing__setup_vio__count|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|antenna__violating__nets|route__wirelength|power__total)"' "$M" | tee -a "$SUM"
else
  S=$(ls -d "$RUN"/*stapostpnr 2>/dev/null | tail -1)
  [ -n "$S" ] && grep -E 'max_ss_100C_1v60' "$S/summary.rpt" | cut -c1-120 | tee -a "$SUM"
  [ -n "$S" ] || { echo "no STA output; log tail:" | tee -a "$SUM"; tail -15 "$LOGS/${TAG}.log" | tee -a "$SUM"; }
fi
