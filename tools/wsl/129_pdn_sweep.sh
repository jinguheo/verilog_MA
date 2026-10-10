#!/usr/bin/env bash
# Sweep PDN strap offsets on config_adcpwr.json and report which ADC power pins stay unconnected (fast: stops at the power-grid check).
#   bash 129_pdn_sweep.sh
set -uo pipefail
REPO=/mnt/d/MyWork/Veriolg_MA; BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"; LOGS="$REPO/tools/wsl/logs"
OUT="$LOGS/pdn_sweep.txt"; : > "$OUT"
for vo in 16.32 10 22 28 34 40 46 52; do
  python3 - "$BASE" "$vo" <<'PY'
import json,sys
b,vo=sys.argv[1],float(sys.argv[2])
d=json.load(open(f'{b}/config_adcpwr.json'))
d['FP_PDN_VOFFSET']=vo
json.dump(d,open(f'{b}/config_adcpwr_s.json','w'),indent=2)
PY
  bash "$REPO/tools/wsl/127_pdn_probe.sh" adcpwr_s
  n=$(grep -c "PSM-0039" "$LOGS/ppa3_adcpwr_s.probe"); tot=$(grep -o "[0-9]* power grid violations" "$LOGS/ppa3_adcpwr_s.probe" | head -1)
  pins=$(grep "PSM-0039" "$LOGS/ppa3_adcpwr_s.probe" | grep -o "u_adc/[a-z]*\|sram22/v[a-z]*" | tr '\n' ' ')
  echo "VOFFSET=$vo unconnected_lines=$n [$pins] $tot" | tee -a "$OUT"
done
echo DONE >> "$OUT"
