#!/usr/bin/env bash
# What is actually failing setup in chan_top? Guessing at the critical path is
# cheap and usually wrong; the STA reports name it.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/88_analyze_timing.sh
set -uo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
STA="$RUN/54-openroad-stapostpnr"

echo "=== reports available ==="
ls -1 "$STA"/nom_ss_100C_1v60/ 2>/dev/null | head -20

echo
echo "=== worst setup path, slow corner ==="
# max.rpt holds the setup (max-delay) paths.
R="$STA/nom_ss_100C_1v60/max.rpt"
[ -f "$R" ] || R="$(find "$STA" -name 'max.rpt' | head -1)"
echo "report: $R"
sed -n '1,80p' "$R" 2>/dev/null

echo
echo "=== which modules appear in failing endpoints ==="
# Group the startpoint/endpoint names by RTL instance so the offender is obvious.
grep -hoE '(u_[a-z0-9_]+/)+' "$R" 2>/dev/null | sed 's|/$||' | sort | uniq -c | sort -rn | head -15
