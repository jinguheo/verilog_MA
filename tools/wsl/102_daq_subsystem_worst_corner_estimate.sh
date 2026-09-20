#!/usr/bin/env bash
# Fast worst-corner timing ESTIMATE for daq_subsystem, same technique as
# 101_chan_top_worst_corner_estimate.sh - a funnel filter before committing
# many hours to a full from-scratch signoff run.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/102_daq_subsystem_worst_corner_estimate.sh
#
# Why this exists: daq_subsystem has never completed a full run (killed by
# session/host teardown every time, ~107k cells vs chan_top's ~29.5k - a
# from-scratch signoff realistically costs multiple hours). Rather than
# spend that budget on periods only inherited from chan_top's own
# since-corrected first guess (10/32 ns), this forces every mid-flow
# STAMidPNR checkpoint to evaluate a genuinely bad corner
# (nom_ss_100C_1v60 - see 101's own comment for why not the absolute worst
# max_ss_100C_1v60: DEFAULT_CORNER's liberty lookup only resolves nom_*
# corners) using the SAME 48/12 ns periods chan_top's own from-scratch run
# is confirming. If this comes back clearly hopeless (large negative WNS,
# not just a few ns), that's cheap evidence to retune before spending the
# full multi-hour budget; if it looks promising, follow up with a real full
# run (100_run_daq_subsystem.sh) to confirm - exactly like chan_top's own
# 101 estimate -> 111 full-confirmation sequence.
#
# Uses daq_subsystem's OWN dedicated shim (openlane-tools-daq, same path
# 100_run_daq_subsystem.sh uses) - not chan_top's shim, so this can run
# alongside chan_top's still-live confirmation run without racing it.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
WORST_CORNER="nom_ss_100C_1v60"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-daq/bin"
rm -rf "$SHIM"; mkdir -p "$SHIM"
for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
  tool="${spec%%:*}"; pref="${spec#*:}"
  d="$(pick_bin "$tool" "${pref:-.}")" || true
  [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
done
ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
export PATH="$SHIM:$PATH"

echo "worst corner forced : $WORST_CORNER"
echo "periods              : clk_i=48ns / src_clk_i[c]=12ns (from constraints/daq_subsystem.sdc)"
echo "note                 : -T/--to did not reliably stop chan_top's own 101 run early either -"
echo "                       this may run to completion regardless. Check mid-flow STAMidPNR"
echo "                       reports as they appear rather than waiting only for the end."
echo

cd "$ROOT"
"$OL" --to OpenROAD.STAMidPNR-3 -c "DEFAULT_CORNER=$WORST_CORNER" "$CFG"

echo
echo "=== newest run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/daq_subsystem/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
find "$RUN" -path '*stamidpnr-3*' -name 'wns.max.rpt' -exec echo {} \; -exec cat {} \;
find "$RUN" -path '*stamidpnr-3*' -name 'ws.max.rpt' -exec echo {} \; -exec cat {} \;
find "$RUN" -path '*stamidpnr-3*' -name 'tns.max.rpt' -exec echo {} \; -exec cat {} \;
