#!/usr/bin/env bash
# Fast worst-corner timing ESTIMATE for chan_top, without waiting for a full
# P&R run to signoff.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/101_chan_top_worst_corner_estimate.sh [CLOCK_PORT_PERIOD_OVERRIDES...]
#
# Why this exists: the 2026-08-30 signoff run showed chan_top's "closes at
# 10/32 ns" claim was never actually checked at the worst corner
# (nom_ss_100C_1v60) - only at nom_tt_025C_1v80 (typical), via a mid-flow
# STAMidPNR checkpoint that OpenLane's own script comment says "supports one
# defined corner per-process" (openlane/scripts/openroad/sta/corner.tcl) -
# that one corner is whatever `DEFAULT_CORNER` resolves to, which defaults to
# the PDK's typical corner (`config/pdk_compat.py`: DEFAULT_CORNER =
# nom_<default_pvt>), not the worst one.
#
# Two OpenLane 2 CLI features make a fast, worst-corner-targeted estimate
# possible instead of re-running the full ~1hr flow per candidate period:
#   -c/--override-config DEFAULT_CORNER=... : make every mid-flow STAMidPNR
#     checkpoint (there are 4 in the Classic flow) evaluate the worst corner
#     instead of typical, for this run only - no config.json edit needed.
#   -T/--to OpenROAD.STAMidPNR-3            : stop right after the 4th
#     STAMidPNR checkpoint (after GlobalRouting + RepairDesignPostGRT +
#     ResizerTimingPostGRT, before DetailedRouting) - this uses
#     `estimate_parasitics -global_routing` (real global-route topology, not
#     just placement-based wire-cap guessing), the best estimate available
#     before the expensive DetailedRouting/RCX/signoff steps. Skips
#     DetailedRouting, antenna repair, fill insertion, RCX, and STAPostPNR -
#     the slowest part of the flow - while still getting a routing-aware
#     timing number, not just a placement guess.
#
# This is NOT a substitute for a real signoff run - `estimate_parasitics` is
# an estimate, not extracted SPEF - but it is far more meaningful than
# 94_sdc_check.tcl's old zero-parasitics check, and dramatically faster than
# waiting for full detailed routing + RCX to find out a period doesn't close.
# Once a period estimate looks promising here, confirm it with a real
# 87_run_chan_top.sh (or a fresh copy of it) full run before trusting it.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/chan_top/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
WORST_CORNER="nom_ss_100C_1v60"   # "max_ss_100C_1v60" is the true worst-of-9 (RUN_2026-08-30_20-00-29/final/metrics.json:
                                   # WNS -8.4ns vs this corner's -7.94ns) but DEFAULT_CORNER's liberty lookup
                                   # (yosys synthesis's toolbox.filter_views(config, config["LIB"])) only resolves
                                   # against "nom_*"-prefixed corners - config/pdk_compat.py's own DEFAULT_CORNER
                                   # default is built as f"nom_{default_pvt}", and a "max_*" override left
                                   # DFFLIBMAP with zero liberty files ("ERROR: Missing -liberty liberty_file
                                   # option!"). nom_ss_100C_1v60 is still a legitimately bad corner (same slow
                                   # process/high temp/low voltage combination, just not the absolute worst of
                                   # the 9) and keeps synthesis's own liberty lookup working.

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools/bin"
rm -rf "$SHIM"; mkdir -p "$SHIM"
for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
  tool="${spec%%:*}"; pref="${spec#*:}"
  d="$(pick_bin "$tool" "${pref:-.}")" || true
  [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
done
ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
export PATH="$SHIM:$PATH"

echo "worst corner forced : $WORST_CORNER"
echo "stopping after       : OpenROAD.STAMidPNR-3 (post-GlobalRouting estimate)"
echo "extra overrides      : $*"
echo

cd "$ROOT"
OVERRIDE_ARGS=(-c "DEFAULT_CORNER=$WORST_CORNER")
for kv in "$@"; do
  OVERRIDE_ARGS+=(-c "$kv")
done
"$OL" --to OpenROAD.STAMidPNR-3 "${OVERRIDE_ARGS[@]}" "$CFG"

echo
echo "=== newest run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/chan_top/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
find "$RUN" -path '*stamidpnr-3*' -name 'wns.max.rpt' -exec echo {} \; -exec cat {} \;
find "$RUN" -path '*stamidpnr-3*' -name 'ws.max.rpt' -exec echo {} \; -exec cat {} \;
find "$RUN" -path '*stamidpnr-3*' -name 'tns.max.rpt' -exec echo {} \; -exec cat {} \;
