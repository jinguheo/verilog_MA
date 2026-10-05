#!/usr/bin/env bash
# PPA3 flow with custom PDN + manual ADC power-rail stitching:
#   A) openlane --to OpenROAD.GeneratePDN   (config_pdn_a.json: macro grids, SRAM met2->met4 via stack)
#   B) pdn_stitch_adc.tcl on the PDN odb, new state with the stitched odb/def
#   C) openlane --from Odb.RemovePDNObstructions [--to <step>]
#   bash 128_pdn_stitch_flow.sh <tag> [last step id]       e.g.  bash 128_pdn_stitch_flow.sh ppa3_pdn1 Checker.PowerGridViolations
set -uo pipefail
tag="${1:?tag}"; to="${2:-}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"; CFG="$BASE/config_pdn_a.json"
LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"; SUM="$LOGS/${tag}.summary"
echo "=== $tag start $(date -Is) ===" | tee "$SUM"
cd "$ROOT"
"$OL" --run-tag "${tag}_a" --overwrite --to OpenROAD.GeneratePDN "$CFG" > "$LOGS/${tag}_a.log" 2>&1
S="$BASE/runs/${tag}_a"; PDN=$(ls -d "$S"/*generatepdn | tail -1)
[ -f "$PDN/state_out.json" ] || { echo "PDN step failed (no state_out)" | tee -a "$SUM"; exit 1; }
ODB_IN=$(ls "$PDN"/*.odb | head -1); ODB_OUT="$S/ppa3_adc_capture_top.stitched.odb"
ODB_IN="$ODB_IN" ODB_OUT="$ODB_OUT" openroad -exit -no_splash "$REPO/tools/wsl/pdn_stitch_adc.tcl" 2>&1 | tee -a "$SUM"
cat > "$S/write_def.tcl" <<TCL
read_db $ODB_OUT
write_def $S/ppa3_adc_capture_top.stitched.def
TCL
openroad -exit -no_splash "$S/write_def.tcl" > /dev/null 2>&1
python3 - "$PDN/state_out.json" "$ODB_OUT" "$S/ppa3_adc_capture_top.stitched.def" "$S/state_stitched.json" <<'PY'
import json,sys
st=json.load(open(sys.argv[1])); st['odb']=sys.argv[2]; st['def']=sys.argv[3]
json.dump(st,open(sys.argv[4],'w'),indent=2)
PY
echo "stitched state: $S/state_stitched.json" | tee -a "$SUM"
TO=(); [ -n "$to" ] && TO=(--to "$to")
"$OL" --run-tag "${tag}" --overwrite --with-initial-state "$S/state_stitched.json" --from Odb.RemovePDNObstructions "${TO[@]}" "$CFG" > "$LOGS/${tag}.log" 2>&1
rc=$?
echo "exit code: $rc ($(date -Is))" | tee -a "$SUM"
grep -E "PSM-0039|power grid violations|clear\." "$LOGS/${tag}.log" | grep -i "psm\|power grid" | sed 's/^\[[0-9:]*\] //' | cut -c1-150 | tee -a "$SUM"
M="$BASE/runs/$tag/final/metrics.json"
[ -f "$M" ] && grep -E '"(timing__setup__ws|timing__hold__ws|antenna__violating__nets|route__drc_errors|magic__drc_error__count|klayout__drc_error__count|design__lvs_error__count|design__xor_difference__count|magic__illegal_overlap__count)"' "$M" | tee -a "$SUM"
