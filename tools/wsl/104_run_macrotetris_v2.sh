#!/usr/bin/env bash
# Validates the Macro Tetris parallel-search v2 candidate (weighted-WL 54,337
# on the tab's own approximate model, vs v1's 55,600 and the grid baseline's
# 59,600 - see config_hierarchical_macrotetris_v2.json's own "//" block).
#
# Uses its own shim (openlane-tools-daq-mt2) - macrotetris_20260925_203844 is
# still live right now (ResizerTimingPostCTS, 45+ min) using its own shim from
# 103's pattern; reusing a shared shim while another run is live would race.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical_macrotetris_v2.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
RUN_TAG="macrotetris_v2_$(date +%Y%m%d_%H%M%S)"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-daq-mt2/bin"
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
echo "candidate: Macro Tetris parallel search #3 (random-restart lane), predicted WL 54,337"
echo

cd "$ROOT"
"$OL" --run-tag "$RUN_TAG" "$CFG"

echo
echo "=== run dir ==="
echo "$REPO/samples/sample_test_4/asic/daq_subsystem/runs/$RUN_TAG"
