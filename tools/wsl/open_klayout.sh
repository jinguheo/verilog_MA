#!/usr/bin/env bash
# Open a finished GDS in the KLayout GUI on the Windows desktop, via WSLg.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/open_klayout.sh [design]
#
# Called by tools\open_layout.bat. Defaults to chan_ctrl.
set -euo pipefail

DESIGN="${1:-chan_ctrl}"
REPO=/mnt/d/MyWork/Veriolg_MA
ASIC="$REPO/samples/sample_test_4/asic/$DESIGN"
PDK="$HOME/eda/pdk/sky130A"

[ -d "$ASIC" ] || {
  echo "No such design: $DESIGN" >&2
  echo "Available:" >&2
  ls -1 "$REPO/samples/sample_test_4/asic" 2>/dev/null | sed 's/^/  /' >&2
  exit 1
}

# Newest completed run.
GDS="$(find "$ASIC" -path '*/final/gds/*.gds' 2>/dev/null | sort | tail -1)"
[ -n "$GDS" ] || { echo "No finished GDS under $ASIC" >&2; exit 1; }

# Prefer the PDK the flow actually used (~/.volare, per resolved.json) over the
# duplicate copy at ~/eda/pdk.
LYP=""
for root in "$HOME/.volare/volare/sky130/versions"/* "$PDK"; do
  [ -d "$root" ] || continue
  LYP="$(find -L "$root" -name 'sky130A.lyp' 2>/dev/null | head -1)"
  [ -n "$LYP" ] && break
done

if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo "No display available - WSLg is not providing one." >&2
  echo "Use the rendered PNGs instead: my_dashboard/public/layout/" >&2
  exit 1
fi

echo "design : $DESIGN"
echo "gds    : $GDS"
echo "layers : ${LYP:-<default colours>}"
echo

# -l loads the layer properties so sky130 layers render in their proper colours.
if [ -n "$LYP" ]; then
  exec klayout -l "$LYP" "$GDS"
else
  exec klayout "$GDS"
fi
