#!/usr/bin/env bash
# Run OpenLane on chan_top - the first multi-clock design here.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/87_run_chan_top.sh
#
# Differs from 80_run_openlane.sh in one respect: the working directory.
# chan_top pulls prim_fifo_async and prim_rst_sync from the OpenTitan corpus at
# /mnt/d/MyWork/verilog, which is outside this repository, and OpenLane refuses
# to read anything above its working directory. Launching from /mnt/d/MyWork -
# the nearest common ancestor of both trees - satisfies that without vendoring
# a copy of prim into this repo.
#
# PATH handling is the same and for the same reasons: expose only the nix tool
# binaries by symlink (a whole nix bin directory would shadow python3), and pin
# python3 to the venv interpreter.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/chan_top/config.json"
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

SHIM="$HOME/.cache/openlane-tools/bin"
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
echo "clocks      : src_clk_i (6 ns) + axi_clk_i (10 ns), asynchronous"
echo "sdc         : samples/sample_test_4/asic/constraints/chan_top.sdc"
"$OL" --version
echo

cd "$ROOT"
"$OL" "$CFG"

echo
echo "=== newest run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/chan_top/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
[ -f "$RUN/final/metrics.json" ] && echo 'final/metrics.json written' || echo 'no final metrics'
