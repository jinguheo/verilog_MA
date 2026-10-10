#!/usr/bin/env bash
# PPA3 flow with (1) fail-fast power check and (2) automatic repair of the met4-met5 vias pdngen could not insert at macro power pins.
#   A) openlane --to OpenROAD.GeneratePDN
#   B) pdn_fix_failed_vias.tcl: re-insert the missing vias from the "[PDN-0110] No via inserted between met4 and met5" warnings
#   C) PSM connectivity check on the repaired odb -> abort here (fail-fast, ~3 min) if anything is still unconnected
#   D) openlane --from Odb.RemovePDNObstructions  (rest of the flow, run tag ppa3_<variant>)
#   bash 131_ppa3_pdnfix_flow.sh <variant>      (config_<variant>.json)
set -uo pipefail
variant="${1:?variant}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"; CFG="$BASE/config_${variant}.json"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/ppa3_${variant}_pdnfix.summary"; T="$REPO/tools/wsl"
echo "=== $variant pdnfix flow start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "ppa3_${variant}_a" --overwrite --to OpenROAD.GeneratePDN "$CFG" > "$LOGS/ppa3_${variant}_a.log" 2>&1
S="$BASE/runs/ppa3_${variant}_a"; PDN=$(ls -d "$S"/*generatepdn | tail -1)
[ -f "$PDN/state_out.json" ] || { echo "PDN step failed" | tee -a "$SUM"; exit 1; }
grep "No via inserted between met4 and met5" "$PDN/openroad-generatepdn.log" | sed -E 's/.*at \(([0-9.]+), ([0-9.]+)\) - \(([0-9.]+), ([0-9.]+)\) on (\w+).*/\5 \1 \2 \3 \4/' > "$S/via_jobs.txt"
echo "failed met4-met5 vias from pdngen: $(wc -l < "$S/via_jobs.txt")" | tee -a "$SUM"
ODB_IN=$(ls "$PDN"/*.odb | head -1); ODB_OUT="$S/ppa3_adc_capture_top.fixed.odb"
ODB_IN="$ODB_IN" ODB_OUT="$ODB_OUT" VIA_JOBS="$S/via_jobs.txt" openroad -exit -no_splash "$T/pdn_fix_failed_vias.tcl" 2>&1 | grep -E "FIXED|summary" | tee -a "$SUM"
cnt=$(ODB_IN="$ODB_OUT" openroad -exit -no_splash "$T/pdn_psm_count.tcl" 2>&1 | grep -cE "PSM-0038|PSM-0039|PSM-0069")
echo "PSM warnings after repair: $cnt" | tee -a "$SUM"
if [ "$cnt" != "0" ]; then echo "FAIL-FAST: power grid still not connected after the via repair -> flow stopped" | tee -a "$SUM"; exit 3; fi
cat > "$S/write_def.tcl" <<TCL
read_db $ODB_OUT
write_def $S/ppa3_adc_capture_top.fixed.def
TCL
openroad -exit -no_splash "$S/write_def.tcl" > /dev/null 2>&1
python3 - "$PDN/state_out.json" "$ODB_OUT" "$S/ppa3_adc_capture_top.fixed.def" "$S/state_fixed.json" <<'PY'
import json,sys
st=json.load(open(sys.argv[1])); st['odb']=sys.argv[2]; st['def']=sys.argv[3]
json.dump(st,open(sys.argv[4],'w'),indent=2)
PY
echo "power grid connected - continuing full flow" | tee -a "$SUM"
"$OL" --run-tag "ppa3_${variant}" --overwrite --with-initial-state "$S/state_fixed.json" --from Odb.RemovePDNObstructions "$CFG" > "$LOGS/ppa3_${variant}.log" 2>&1
echo "exit code: $? ($(date -Is))" | tee -a "$SUM"
