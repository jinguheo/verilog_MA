#!/usr/bin/env bash
# Why did *sync_wptr*/*/d and *sync_rptr*/*/d match nothing? Find the actual
# hierarchical instance/pin names OpenSTA sees in the synthesized netlist.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/91_find_sync_names.sh
set -uo pipefail

NL=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37/06-yosys-synthesis/chan_top.nl.v

echo "=== instances with sync_wptr / sync_rptr in the name ==="
grep -oE '\bu_cdc_fifo\.sync_[a-z]*[a-zA-Z0-9_.\\]*' "$NL" 2>/dev/null | sort -u | head -20

echo
echo "=== broader: anything named sync_wptr or sync_rptr at all ==="
grep -n 'sync_wptr\|sync_rptr' "$NL" 2>/dev/null | head -10

echo
echo "=== does synthesis flatten prim_flop_2sync, losing the instance name entirely? ==="
grep -c 'prim_flop_2sync' "$NL" 2>/dev/null || echo 0
grep -n 'module chan_top' "$NL" | head -1
echo "--- cells whose name contains 'gen_intq' or 'intq' (prim_flop_2sync internal reg name) ---"
grep -oE '\bu_cdc_fifo[a-zA-Z0-9_.\\]*intq[a-zA-Z0-9_.\\]*' "$NL" 2>/dev/null | sort -u | head -10

echo
echo "=== list ALL u_cdc_fifo.* hierarchical names (post-synthesis, flattened design) ==="
grep -oE '\\?u_cdc_fifo\.[a-zA-Z0-9_.\\]+' "$NL" 2>/dev/null | sed 's/\\//g' | sort -u | head -40
