#!/usr/bin/env bash
# Resume an interrupted 115_run_chan_top_reshape_full.sh run (e.g. WSL got
# restarted mid-flow) from a given OpenLane step id, reusing every step the
# run already finished. The half-written directory of the interrupted step
# (the highest-numbered one without state_out.json) is removed first so the
# resumed step re-takes its ordinal.
#
#   bash 117_resume_reshape_full.sh 650x985 KLayout.DRC
#
# Appends the same summary block as 115 to tools/wsl/logs/reshape_full_<shape>.summary.
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
SHIM="$HOME/.cache/openlane-tools-chan_top/bin"
LOGS="$REPO/tools/wsl/logs"
shape="${1:?shape WxH}"; from="${2:?step id e.g. KLayout.DRC}"
export PATH="$SHIM:$PATH"

CFG="$REPO/samples/sample_test_4/asic/chan_top/config_reshape_${shape}.json"
TAG="reshape_full_${shape}"
RUN="$REPO/samples/sample_test_4/asic/chan_top/runs/$TAG"
SUM="$LOGS/${TAG}.summary"
[ -d "$RUN" ] || { echo "no run dir $RUN" >&2; exit 1; }

for d in $(ls "$RUN" | grep -E '^[0-9]+-' | sort -rn); do
  if [ ! -f "$RUN/$d/state_out.json" ]; then echo "removing unfinished step dir $d"; rm -rf "$RUN/$d"; else break; fi
done

echo "=== $shape : RESUME from $from $(date -Is) ===" | tee -a "$SUM"
cd "$ROOT"
"$OL" --run-tag "$TAG" --from "$from" "$CFG" >> "$LOGS/${TAG}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
M="$RUN/final/metrics.json"
if [ -f "$M" ]; then
  grep -E '"(design__instance__count|design__instance__area|design__instance__utilization|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|timing__setup__ws|timing__setup__tns|timing__hold__ws|timing__hold__tns|route__wirelength|antenna__violating__nets|design__violations)"' "$M" | tee -a "$SUM"
else
  echo "no final/metrics.json - last log lines:" | tee -a "$SUM"; tail -25 "$LOGS/${TAG}.log" | tee -a "$SUM"
fi
