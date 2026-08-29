#!/usr/bin/env bash
# Two questions before touching any RTL:
#  1. Did the CDC exception in chan_top.sdc actually match anything real, or is
#     it silently a no-op (in which case src_clk -> axi_clk paths would be
#     analyzed as fully synchronous and every "violation" involving them is
#     fake)?
#  2. What is downstream of the axi_clk flop _19137_ (fifo_rptr_q[2]) that fans
#     out through ~50 gates before hitting ch_cause_o? That is a same-domain
#     violation and is the one that matters regardless of #1.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/90_check_cdc_exception.sh
set -uo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_top/runs/RUN_2026-08-28_19-41-37
STA="$RUN/54-openroad-stapostpnr"
R="$STA/nom_ss_100C_1v60/max.rpt"

echo "=== do the src_clk-startpoint violations cross into axi_clk? ==="
# Pull out a src_clk-clocked startpoint block and read its Path Group + endpoint.
awk '/^Startpoint: _17737_/{p=1} p{print} p && /^Endpoint:/{c++} p && c==1 && /^Path Type:/{exit}' "$R" | head -6

echo
echo "=== sanity: did set_max_delay -datapath_only actually apply anywhere? ==="
grep -c 'data path only\|datapath_only\|data_path_only' "$STA/nom_ss_100C_1v60/sta.log" 2>/dev/null || echo 0
grep -B2 -A2 -i 'sync_wptr\|sync_rptr' "$RUN/asic/constraints/chan_top.sdc" 2>/dev/null
grep -c 'WARNING: sync_.ptr pins not matched' "$STA"/*/sta.log 2>/dev/null || true
grep -rn 'WARNING: sync_' "$STA"/nom_ss_100C_1v60/sta.log 2>/dev/null || echo "(no warning printed - exception pins were matched)"

echo
echo "=== instance name of the axi_clk flop feeding ch_cause_o ==="
grep -B40 '^Endpoint: ch_cause_o\[0\]' "$R" | grep -oE '_[0-9]+_/Q \(sky130_fd_sc_hd__dfrtp' | head -3

echo
echo "=== what RTL signal is fifo_rptr_q[2] used for, besides the pointer compare? ==="
grep -n 'fifo_rptr_q\|rptr_q\b' /mnt/d/MyWork/verilog/dbs/opentitan/hw/ip/prim/rtl/prim_fifo_async.sv | head -15

echo
echo "=== does chan_top.sv or chan_ctrl.sv read the raw pointer for anything besides depth/occupancy? ==="
grep -n 'rptr\|rdepth\|occupancy\|rvalid\|rdata' /mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/rtl/stream/chan_top.sv | head -20
