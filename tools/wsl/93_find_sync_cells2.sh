#!/usr/bin/env bash
set -uo pipefail
NL=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37/06-yosys-synthesis/chan_top.nl.v

echo "=== full cell blocks touching sync_rptr.intq[0] ==="
grep -n 'sync_rptr\\\.intq\[0\]\|sync_rptr\.intq\[0\]' "$NL" | head -10

echo
echo "=== context around each match (5 lines before, for the instance name/type) ==="
grep -n 'intq\[0\] )' "$NL" | grep 'sync_rptr' | while IFS=: read -r ln rest; do
  echo "--- line $ln ---"
  sed -n "$((ln-6)),$((ln+1))p" "$NL"
  echo
done
