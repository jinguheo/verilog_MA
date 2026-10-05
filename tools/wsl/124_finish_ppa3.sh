#!/usr/bin/env bash
# Drive the PPA3 signoff tail to the END of the flow.
# Waits for the running PPA3 run, then resumes (config_antfix4 = signoff checkers non-fatal) from the step that stopped
# the previous run, repeatedly, until a run produces final/metrics.json. The violation counts are kept in the metrics.
#   bash 124_finish_ppa3.sh ppa3_antfix3_signoff
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"
CFG="$BASE/config_antfix4.json"
LOGS="$REPO/tools/wsl/logs"; SUM="$LOGS/ppa3_finish.summary"
cur="${1:?first run tag}"
echo "=== ppa3 finish driver start $(date -Is) from $cur ===" | tee -a "$SUM"
for n in 1 2 3 4 5 6; do
  while pgrep -f "openlane.*--run-tag ppa3_" > /dev/null; do sleep 30; done
  RUN="$BASE/runs/$cur"
  if [ -f "$RUN/final/metrics.json" ]; then echo "finished: $cur has final/metrics.json" | tee -a "$SUM"; break; fi
  last=$(ls "$RUN" | grep -E '^[0-9]+-' | sort | while read d; do [ -f "$RUN/$d/state_out.json" ] && echo "$d"; done | tail -1)
  step=$(grep -o "Running '[A-Za-z0-9.]*'" "$RUN/flow.log" | tail -1 | sed "s/Running '//; s/'//")
  echo "[$n] $cur stopped; last good step $last; resume from $step ($(date -Is))" | tee -a "$SUM"
  [ -n "$last" ] && [ -n "$step" ] || { echo "cannot determine resume point" | tee -a "$SUM"; break; }
  next="ppa3_fin$n"
  cd "$ROOT"
  "$OL" --run-tag "$next" --overwrite --with-initial-state "$RUN/$last/state_out.json" --from "$step" "$CFG" > "$LOGS/${next}.log" 2>&1
  echo "[$n] $next exit $? ($(date -Is))" | tee -a "$SUM"
  cur="$next"
done
RUN="$BASE/runs/$cur"
M="$RUN/final/metrics.json"
[ -f "$M" ] && grep -E '"(antenna__violating__nets|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|design__xor_difference__count|timing__setup__ws|timing__hold__ws|design__instance__area|power__total)"' "$M" | tee -a "$SUM"
echo "=== done $(date -Is) final run $cur ===" | tee -a "$SUM"
