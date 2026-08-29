#!/usr/bin/env bash
# Inspect the finished GDS and work out how it can be displayed.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/61_gds_inspect.sh
set -uo pipefail

RUN=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_ctrl/runs/RUN_2026-08-26_13-14-47
GDS="$RUN/final/gds/chan_ctrl.gds"

echo "=== GDS files produced ==="
find "$RUN/final" -name '*.gds' -o -name '*.gds.gz' 2>/dev/null | while read -r f; do
  printf '%8.1f KB  %s\n' "$(du -k "$f" | cut -f1)" "$f"
done

echo
echo "=== can a GUI open on the Windows desktop? (WSLg) ==="
echo "DISPLAY=${DISPLAY:-<unset>}"
echo "WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-<unset>}"
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo 'GUI should work - klayout can be opened interactively.'
else
  echo 'No display - only batch rendering to an image file will work.'
fi

echo
echo "=== layout contents (batch, no GUI needed) ==="
[ -f "$GDS" ] || { echo "GDS not found at $GDS" >&2; exit 1; }
klayout -b -rd gds="$GDS" -r /dev/stdin <<'PY' 2>&1 | head -40
import pya, os
gds = os.environ.get("KLAYOUT_GDS") or None
# -rd passes variables into the script namespace as globals
ly = pya.Layout()
ly.read(gds)
top = ly.top_cell()
bbox = top.bbox()
dbu = ly.dbu
print("top cell      :", top.name)
print("dbu           :", dbu)
print("size (um)     : %.2f x %.2f" % (bbox.width()*dbu, bbox.height()*dbu))
print("area (um^2)   : %.1f" % (bbox.width()*dbu * bbox.height()*dbu))
print("cell count    :", ly.cells())
print("layers used   :", ly.layer_indexes().__len__() if hasattr(ly,'layer_indexes') else len(list(ly.layer_indices())))
print("--- layers ---")
n = 0
for li in ly.layer_indices():
    info = ly.get_info(li)
    if not top.bbox_per_layer(li).empty():
        print("  ", info.to_s())
        n += 1
    if n > 25:
        print("   ...")
        break
PY
