#!/usr/bin/env bash
# Resume the proven grid-baseline hierarchical daq_subsystem run
# (hierarchical_auto_20260924_142552) at Magic.DRC. That run completed
# placement, CTS, routing, RCX, STA, GDS streamout and XOR (clean) before the
# host killed it during 62-magic-drc, so only DRC/LVS/final checks remain.
# Uses config_hierarchical.json (the baseline's own config) and a dedicated
# shim so nothing else's shim can race it.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
RUN_TAG="hierarchical_auto_20260924_142552"

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}
SHIM="$HOME/.cache/openlane-tools-daq-base/bin"
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

echo "resuming $RUN_TAG at Magic.DRC (to end of flow)"
cd "$ROOT"
"$OL" --run-tag "$RUN_TAG" --from Magic.DRC "$CFG"
