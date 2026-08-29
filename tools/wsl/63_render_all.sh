#!/usr/bin/env bash
# Render every finished GDS to PNG and publish the images to the dashboard.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/63_render_all.sh
#
# Output goes to my_dashboard/public/layout/, which Vite serves at /layout/...,
# so the dashboard can display the layouts with no extra server.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ASIC="$REPO/samples/sample_test_4/asic"
OUT="$REPO/my_dashboard/public/layout"

# Use the same PDK the flow itself used. resolved.json in a finished run records
# it as PDK_ROOT=~/.volare/volare/sky130/versions/<hash>. A second copy exists at
# ~/eda/pdk from a later volare install; preferring .volare keeps the rendering
# consistent with what actually produced the GDS.
find_lyp() {
  for root in "$HOME/.volare/volare/sky130/versions"/* "$HOME/eda/pdk"; do
    [ -d "$root" ] || continue
    f="$(find -L "$root" -name 'sky130A.lyp' 2>/dev/null | head -1)"
    [ -n "$f" ] && { echo "$f"; return; }
  done
}
LYP="$(find_lyp)"

mkdir -p "$OUT"
echo "layer properties: ${LYP:-<none>}"
echo "output: $OUT"
echo

for d in "$ASIC"/*/; do
  name="$(basename "$d")"
  # Newest completed run for this design.
  gds="$(find "$d" -path '*/final/gds/*.gds' 2>/dev/null | sort | tail -1)"
  if [ -z "$gds" ]; then
    echo "$name: no GDS, skipping"
    continue
  fi
  # klayout -z can exit non-zero even after writing every image, so its status is
  # not allowed to abort the loop under `set -e` - otherwise one design failing
  # (or merely exiting oddly) silently leaves the rest un-rendered.
  if klayout -z -rd gds="$gds" -rd lyp="${LYP:-}" -rd out="$OUT" -rd name="$name" \
       -r "$REPO/tools/wsl/render_all_gds.py"; then
    :
  else
    echo "  ($name: klayout exited $? - checking whether images were still written)"
  fi
done

echo
echo "=== published images ==="
ls -lh "$OUT" | tail -12
