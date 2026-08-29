#!/usr/bin/env bash
# u_cdc_fifo.sync_rptr.intq / sync_wptr.intq survive synthesis as NET names (the
# Q output of the synchronizer's own flop), not as pins matchable by
# */sync_wptr*/*/d - there is no submodule left to have a D pin at that path
# after flattening. Find the actual driving cell for each bit so the SDC
# exception can target its real D pin (the D pin of the flop that has this net
# as its own Q is exactly where the async gray-code bit is sampled).
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/92_find_sync_cells.sh
set -uo pipefail

NL=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37/06-yosys-synthesis/chan_top.nl.v

for net in 'u_cdc_fifo.sync_rptr.intq\[0\]' 'u_cdc_fifo.sync_wptr.intq\[0\]'; do
  echo "=== driver of $net ==="
  grep -B3 -E "\.Q\($net\)|\.Q \($net\)" "$NL" | head -8
  echo
done

echo "=== how many bits in each ==="
grep -oE 'sync_rptr\.intq\[[0-9]+\]' "$NL" | sort -u -t'[' -k2 -n
grep -oE 'sync_wptr\.intq\[[0-9]+\]' "$NL" | sort -u -t'[' -k2 -n

echo
echo "=== general form: find the DFF cell instance name for one bit ==="
awk '/sync_rptr\.intq\[0\]/{print; if(++n>1 && /^  \(/) exit} /sky130_fd_sc_hd__dfrtp/{last_inst=$0} END{}' "$NL" | head -20
