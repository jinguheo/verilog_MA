#!/usr/bin/env bash
# Placement-feasibility probe for reshaping chan_top from 800x800 to
# 590x1085 (see config_reshape_590x1085.json for why). Same isolated-shim
# pattern as 111_run_chan_top_safe.sh, but against the reshape config and
# stopped with --to right after OpenROAD.DetailedPlacement - floorplan +
# global placement + detailed placement only, no CTS/route/DRC/LVS. That
# answers "can chan_top's 46,009 cells even be placed in this shape"
# without paying for the full multi-hour signoff flow.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/112_run_chan_top_reshape_590x1085.sh
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/chan_top/config_reshape_590x1085.json"
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

SHIM="$HOME/.cache/openlane-tools-chan_top/bin"
if [ -L "$SHIM/yosys" ]; then
  echo "shim already built at $SHIM, reusing"
else
  mkdir -p "$SHIM"
  for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
    tool="${spec%%:*}"; pref="${spec#*:}"
    d="$(pick_bin "$tool" "${pref:-.}")" || true
    [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
  done
  ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
fi
export PATH="$SHIM:$PATH"

echo "working dir : $ROOT"
echo "config      : $CFG"
echo "die area    : 590 x 1085 (reshape probe, NOT the signed-off 800x800)"
echo "stop at     : OpenROAD.DetailedPlacement (placement legality only, no CTS/route/DRC/LVS)"
"$OL" --version
echo

cd "$ROOT"
"$OL" --to OpenROAD.DetailedPlacement "$CFG"

echo
echo "=== newest reshape run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/chan_top/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
DP="$RUN/33-openroad-detailedplacement"
if [ -f "$DP/chan_top.def" ]; then
  echo 'detailed placement completed - chan_top.def written'
  grep -e 'total displacement' -e 'max displacement' -e 'delta HPWL' -e 'DPL-' "$DP/openroad-detailedplacement.log" || true
else
  echo 'no chan_top.def under 33-openroad-detailedplacement - placement did not complete, see log above'
fi
