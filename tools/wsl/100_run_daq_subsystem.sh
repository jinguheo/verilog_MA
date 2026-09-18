#!/usr/bin/env bash
# Run OpenLane on daq_subsystem - the full 8-channel chip top.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/100_run_daq_subsystem.sh
#
# Same working-directory reasoning as 87_run_chan_top.sh: daq_subsystem pulls
# prim_fifo_async/prim_rst_sync/prim_arbiter_tree from the OpenTitan corpus at
# /mnt/d/MyWork/verilog, outside this repo, and OpenLane refuses to read above
# its working directory - so this launches from /mnt/d/MyWork.
#
# Uses its OWN tool shim (openlane-tools-daq, not chan_top's openlane-tools):
# chan_top may still be running (85_run/87_run built and rely on the shared
# shim), and this script's rm -rf/rebuild of a shim directory would race with
# any of chan_top's later flow steps that resolve a tool through PATH. A
# separate shim costs nothing and removes that risk entirely.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"

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

echo "working dir : $ROOT"
echo "config      : $CFG"
echo "clocks      : clk_i (32 ns) + 8x src_clk_i[c] (10 ns each), all asynchronous"
echo "sdc         : samples/sample_test_4/asic/constraints/daq_subsystem.sdc"
echo "note        : first run for this design - CLOCK_PERIOD/DIE_AREA in"
echo "              config.json are seed estimates, not validated numbers."
"$OL" --version
echo

cd "$ROOT"
"$OL" "$CFG"

echo
echo "=== newest run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/daq_subsystem/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
[ -f "$RUN/final/metrics.json" ] && echo 'final/metrics.json written' || echo 'no final metrics'
