#!/usr/bin/env bash
# PPA3 EARLY pre-check (~3-4 min): finds floorplan/PDN problems before the 2-hour flow.
#   1. openlane --to OpenROAD.GeneratePDN                      (floorplan, macro placement, tap/endcap, PDN)
#   2. failed met4-met5 vias reported by pdngen are re-inserted (pdn_fix_failed_vias.tcl)
#   3. PSM power-connectivity check on the repaired odb         -> FAIL if any macro power pin / grid node is unconnected
#   4. tap coverage (tools/precheck/tap_coverage.tcl)           -> FAIL if rows have points > 15 um from any tap (latch-up / floating nwell risk)
# Exit code 0 = all clear, 3 = problem found. Summary: logs/ppa3_<variant>_precheck.summary (+ .json)
#   bash 132_ppa3_precheck_early.sh <variant>      (config_<variant>.json)
set -uo pipefail
variant="${1:?variant}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"; CFG="$BASE/config_${variant}.json"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/ppa3_${variant}_precheck.summary"; T="$REPO/tools/wsl"; P="$REPO/tools/precheck"
: > "$SUM"; echo "=== precheck(early) $variant $(date -Is) ===" | tee -a "$SUM"
cd "$ROOT"
"$OL" --run-tag "ppa3_${variant}_pre" --overwrite --to OpenROAD.GeneratePDN "$CFG" > "$LOGS/ppa3_${variant}_pre.log" 2>&1
S="$BASE/runs/ppa3_${variant}_pre"; PDN=$(ls -d "$S"/*generatepdn 2>/dev/null | tail -1)
if [ -z "$PDN" ] || [ ! -f "$PDN/state_out.json" ]; then echo "FAIL  floorplan/PDN step did not finish (see $LOGS/ppa3_${variant}_pre.log)" | tee -a "$SUM"; echo '{"ok":false,"failed":"flow"}' > "$LOGS/ppa3_${variant}_precheck.json"; exit 3; fi
ODB=$(ls "$PDN"/*.odb | head -1)
grep "No via inserted between met4 and met5" "$PDN/openroad-generatepdn.log" | sed -E 's/.*at \(([0-9.]+), ([0-9.]+)\) - \(([0-9.]+), ([0-9.]+)\) on (\w+).*/\5 \1 \2 \3 \4/' > "$S/via_jobs.txt"
nfail=$(wc -l < "$S/via_jobs.txt"); fixed=0; notfixed=0
if [ "$nfail" != "0" ]; then
  ODB_IN="$ODB" ODB_OUT="$S/fixed.odb" VIA_JOBS="$S/via_jobs.txt" openroad -exit -no_splash "$T/pdn_fix_failed_vias.tcl" > "$S/viafix.log" 2>&1
  fixed=$(grep -c "^FIXED" "$S/viafix.log"); notfixed=$(grep -c "^NOT FIXED" "$S/viafix.log"); ODB="$S/fixed.odb"
fi
echo "pdngen failed met4-met5 vias: $nfail  (repaired $fixed, not repairable $notfixed)" | tee -a "$SUM"
psm=$(ODB_IN="$ODB" openroad -exit -no_splash "$T/pdn_psm_count.tcl" 2>&1 | grep -cE "PSM-0038|PSM-0039|PSM-0069")
unc=$(ODB_IN="$ODB" openroad -exit -no_splash "$T/pdn_psm_count.tcl" 2>&1 | grep "PSM-0039" | grep -o "u_[A-Za-z0-9_.]*/[a-z]*" | sort -u | tr '\n' ' ')
if [ "$psm" = "0" ]; then echo "PASS  power grid connected (PSM warnings 0)" | tee -a "$SUM"; pdn_ok=true; else echo "FAIL  power grid: $psm PSM warnings, unconnected: ${unc:-?}" | tee -a "$SUM"; pdn_ok=false; fi
tap_out=$(ODB_IN="$ODB" openroad -exit -no_splash "$P/tap_coverage.tcl" 2>&1 | grep -E "TAPFAR|SUMMARY")
flag=$(echo "$tap_out" | grep -o "flagged=[0-9]*" | head -1 | cut -d= -f2)
if [ "${flag:-0}" = "0" ]; then echo "PASS  tap coverage (every row point within 15 um of a tap)" | tee -a "$SUM"; tap_ok=true; else echo "FAIL  tap coverage: $(echo "$tap_out" | grep TAPFAR | head -1) -> tap-less row fragments beside macros (move the macro or add tap/blockage)" | tee -a "$SUM"; tap_ok=false; fi
echo "{\"ok\":$([ "$pdn_ok" = true ] && [ "$tap_ok" = true ] && echo true || echo false),\"pdn\":$pdn_ok,\"tap\":$tap_ok,\"via_failed\":$nfail,\"via_fixed\":$fixed,\"psm_warnings\":$psm,\"tap_flagged_rows\":${flag:-0}}" > "$LOGS/ppa3_${variant}_precheck.json"
if [ "$pdn_ok" = true ] && [ "$tap_ok" = true ]; then echo "ALL CLEAR - safe to start the full flow" | tee -a "$SUM"; exit 0; fi
echo "STOP - fix the items above before the full flow" | tee -a "$SUM"; exit 3
