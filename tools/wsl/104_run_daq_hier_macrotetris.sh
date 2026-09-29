#!/usr/bin/env bash
# Macro Tetris candidate for the hierarchical daq_subsystem track - same as
# 103_run_daq_subsystem_hierarchical.sh but with config_hierarchical_macrotetris.json
# (only the 8 chan_top macro coordinates differ from config_hierarchical.json).
#
# Stops at OpenROAD.STAPostPNR: that already produces every metric the grid
# baseline (runs/hierarchical_auto_20260924_142552) has - post-route wirelength,
# route DRC, worst-corner setup/hold, antenna, slew/cap - and skips the
# GDS/Magic DRC tail where the baseline run was cut off by the host.
#
# Own shim dir so it never races a live run using openlane-tools-daq-hier.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical_macrotetris.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
RUN_TAG="macrotetris_$(date +%Y%m%d_%H%M%S)"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-daq-mt/bin"
if [ ! -e "$SHIM/yosys" ]; then
  rm -rf "$SHIM"; mkdir -p "$SHIM"
  for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
    tool="${spec%%:*}"; pref="${spec#*:}"
    d="$(pick_bin "$tool" "${pref:-.}")" || true
    [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
  done
  ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
fi
export PATH="$SHIM:$PATH"

echo "config   : $CFG"
echo "run-tag  : $RUN_TAG"
echo "stop at  : OpenROAD.STAPostPNR"
echo

cd "$ROOT"
"$OL" --run-tag "$RUN_TAG" --to OpenROAD.STAPostPNR "$CFG"

echo
echo "=== run dir ==="
echo "$REPO/samples/sample_test_4/asic/daq_subsystem/runs/$RUN_TAG"
