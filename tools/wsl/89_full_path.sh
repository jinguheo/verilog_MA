#!/usr/bin/env bash
# Read the whole worst-case setup path, and the module-instance histogram across
# all failing endpoints, not just the first one.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/89_full_path.sh
set -uo pipefail

STA=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37/54-openroad-stapostpnr
R="$STA/nom_ss_100C_1v60/max.rpt"

echo "=== full worst path (through to the endpoint and slack) ==="
sed -n '1,140p' "$R"

echo
echo "=== how many distinct startpoint/endpoint pairs are in this report? ==="
grep -c '^Startpoint:' "$R"

echo
echo "=== startpoints across all reported paths ==="
grep '^Startpoint:' "$R" | sort | uniq -c | sort -rn | head -15

echo
echo "=== endpoints across all reported paths ==="
grep '^Endpoint:' "$R" | sort | uniq -c | sort -rn | head -15

echo
echo "=== violator_list.rpt (every failing endpoint, not just top N) ==="
wc -l "$STA/nom_ss_100C_1v60/violator_list.rpt" 2>/dev/null
head -20 "$STA/nom_ss_100C_1v60/violator_list.rpt" 2>/dev/null
