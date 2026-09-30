#!/usr/bin/env bash
# Runs the chan_top placement-feasibility probe (see config_reshape_*.json,
# same idea as 112_run_chan_top_reshape_590x1085.sh) for every reshape
# candidate passed as an argument, then renders a placement-only screenshot
# of each straight from its post-detailed-placement ODB via OpenROAD's GUI
# (render_placement_image.tcl, gui::save_image) - no CTS/route/GDS needed
# for a placement picture, so this is minutes per shape, not hours.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/114_render_chan_top_reshapes.sh 650x985 500x1280 450x1422
#
# Each shape's PNG lands at tools/wsl/chan_top_<shape>.png.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
OR="$HOME/.cache/openlane-tools-chan_top/bin/openroad"

[ -x "$OL" ] || { echo "openlane not found at $OL" >&2; exit 1; }

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

if [ "$#" -eq 0 ]; then
  echo "usage: $0 WxH [WxH...]  (e.g. 650x985 500x1280 450x1422)" >&2
  exit 1
fi

for shape in "$@"; do
  w="${shape%x*}"; h="${shape#*x}"
  CFG="$REPO/samples/sample_test_4/asic/chan_top/config_reshape_${w}x${h}.json"
  [ -f "$CFG" ] || { echo "no config for $shape: $CFG" >&2; exit 1; }

  echo "=== $shape : placement probe ==="
  cd "$ROOT"
  "$OL" --to OpenROAD.DetailedPlacement "$CFG"

  RUN="$(find "$REPO/samples/sample_test_4/asic/chan_top/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
  DP="$RUN/33-openroad-detailedplacement"
  ODB="$DP/chan_top.odb"
  if [ ! -f "$ODB" ]; then
    echo "  placement did not complete for $shape - see $DP" >&2
    continue
  fi
  echo "  placement OK - $RUN"
  grep -e 'total displacement' -e 'max displacement' -e 'DPL-' "$DP/openroad-detailedplacement.log" || true

  echo "=== $shape : render ==="
  ODB_PATH="$ODB" OUT_PNG="$REPO/tools/wsl/chan_top_${w}x${h}.png" DIE_W="$w" DIE_H="$h" \
    "$OR" -gui -exit "$REPO/tools/wsl/render_placement_image.tcl"
  echo "  wrote $REPO/tools/wsl/chan_top_${w}x${h}.png"
done
