#!/usr/bin/env bash
# What RTL signal do the anonymous gate names in the src_clk violation actually
# correspond to? Yosys keeps a mapping in the synthesis log / can be queried by
# looking at what nets connect to these specific cell instances.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/105_identify_signals.sh
set -uo pipefail

NL=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37/06-yosys-synthesis/chan_top.nl.v

for inst in _18491_ _18551_ _18521_ _18528_; do
  echo "=== $inst ==="
  grep -A6 "^  sky130_fd_sc_hd__[a-z0-9_]* $inst (" "$NL" | head -8
  echo
done

echo "=== is there a hierarchical (pre-flatten) name hint anywhere? ==="
grep -n "\\\\$inst\b" "$NL" 2>/dev/null | head -3

echo
echo "=== what named (non-anon) nets feed into this cluster - check the Q of _18491_ ==="
grep -B1 -A1 '\.Q(_18491_' "$NL" 2>/dev/null | head -10
