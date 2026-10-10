#!/usr/bin/env bash
# PPA3 flow with a FAIL-FAST power check.
# OpenLane records "N power grid violations" as a *deferred* error and keeps running for ~2 h; the problem then only shows up in LVS.
# This driver runs up to Checker.PowerGridViolations (~2 min), aborts right there if any violation / unconnected macro pin is reported,
# and otherwise continues with the rest of the flow from the PDN state.
#   bash 130_ppa3_failfast.sh <variant> [extra openlane args after the second step...]
#   (config_<variant>.json, run tags ppa3_<variant>_pdnchk and ppa3_<variant>)
set -uo pipefail
variant="${1:?variant}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"; CFG="$BASE/config_${variant}.json"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/ppa3_${variant}_failfast.summary"
echo "=== $variant fail-fast start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "ppa3_${variant}_pdnchk" --overwrite --to Checker.PowerGridViolations "$CFG" > "$LOGS/ppa3_${variant}_pdnchk.log" 2>&1
viol=$(grep -o "[0-9]* power grid violations" "$LOGS/ppa3_${variant}_pdnchk.log" | head -1 | grep -o "^[0-9]*")
unc=$(grep -c "PSM-0039" "$LOGS/ppa3_${variant}_pdnchk.log")
echo "power grid violations: ${viol:-0}   unconnected-instance warnings: $unc" | tee -a "$SUM"
grep "PSM-0039" "$LOGS/ppa3_${variant}_pdnchk.log" | sed 's/^\[[0-9:]*\] //' | grep -o "u_[A-Za-z0-9_.]*/[a-z]*" | sort -u | sed 's/^/  unconnected: /' | tee -a "$SUM"
if [ "${viol:-0}" != "0" ] || [ "$unc" != "0" ]; then
  echo "FAIL-FAST: power connection broken -> flow stopped (saved ~2 h). Fix the PDN, then rerun." | tee -a "$SUM"
  exit 3
fi
STATE=$(ls -d "$BASE/runs/ppa3_${variant}_pdnchk"/*powergridviolations | tail -1)/state_out.json
echo "power check clean, continuing full flow" | tee -a "$SUM"
"$OL" --run-tag "ppa3_${variant}" --overwrite --with-initial-state "$STATE" --from Odb.RemovePDNObstructions "$CFG" > "$LOGS/ppa3_${variant}.log" 2>&1
echo "exit code: $? ($(date -Is))" | tee -a "$SUM"
