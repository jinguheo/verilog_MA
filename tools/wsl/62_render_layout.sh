#!/usr/bin/env bash
# Render the finished chan_ctrl GDS to PNG so the layout can be looked at
# without opening any tool.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/62_render_layout.sh
#
# Images land in samples/sample_test_4/asic/chan_ctrl/layout/ on D:, so they are
# directly viewable from Windows and can be embedded in the dashboard.
set -euo pipefail

BASE=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_ctrl
RUN="$BASE/runs/RUN_2026-08-26_13-14-47"
GDS="$RUN/final/gds/chan_ctrl.gds"
OUT="$BASE/layout"
PDK="$HOME/eda/pdk/sky130A"

[ -f "$GDS" ] || { echo "GDS not found: $GDS" >&2; exit 1; }

# sky130 ships KLayout layer properties; without them every layer renders in a
# default colour and the image is much harder to read.
LYP="$(find -L "$PDK/libs.tech/klayout" -name '*.lyp' 2>/dev/null | head -1 || true)"
echo "gds: $GDS"
echo "lyp: ${LYP:-<none found>}"
echo "out: $OUT"
echo

# -z is hidden-window mode: Qt renders offscreen, no window appears.
klayout -z \
  -rd gds="$GDS" \
  -rd lyp="${LYP:-}" \
  -rd out="$OUT" \
  -r /mnt/d/MyWork/Veriolg_MA/tools/wsl/render_gds.py

echo
echo "=== images ==="
ls -lh "$OUT" 2>/dev/null | tail -5
