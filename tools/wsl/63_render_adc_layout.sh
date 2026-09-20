#!/usr/bin/env bash
# Render the real selected analog IP's GDS (Efabless SKY130 12-bit SAR ADC)
# to PNG, same technique as 62_render_layout.sh used for the digital
# chan_ctrl block - so the "Analog vs Digital" dashboard tab can show an
# actual rendered image, not just an illustrative diagram.
set -euo pipefail

GDS=/mnt/d/MyWork/Veriolg_MA/analog/third_party/sky130_ef_ip__adc3v_12bit/gds/sky130_ef_ip__adc3v_12bit.gds
OUT=/mnt/d/MyWork/Veriolg_MA/analog/layout_render
PDK="$HOME/eda/pdk/sky130A"

[ -f "$GDS" ] || { echo "GDS not found: $GDS" >&2; exit 1; }

LYP="$(find -L "$PDK/libs.tech/klayout" -name '*.lyp' 2>/dev/null | head -1 || true)"
if [ -z "$LYP" ]; then
  LYP="$(find -L /home/oem/.volare -name '*.lyp' 2>/dev/null | head -1 || true)"
fi

echo "gds: $GDS"
echo "lyp: ${LYP:-<none found>}"
echo "out: $OUT"
echo

klayout -z \
  -rd gds="$GDS" \
  -rd lyp="${LYP:-}" \
  -rd out="$OUT" \
  -r /mnt/d/MyWork/Veriolg_MA/tools/wsl/render_gds.py

echo
echo "=== images ==="
ls -lh "$OUT" 2>/dev/null | tail -10
