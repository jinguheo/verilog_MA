#!/usr/bin/env bash
# Work out which OpenTitan prim files chan_top actually needs, so the OpenLane
# config can list them explicitly.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/86_chan_top_deps.sh
set -uo pipefail

PRIM=/mnt/d/MyWork/verilog/dbs/opentitan/hw/ip/prim/rtl
GEN=/mnt/d/MyWork/verilog/dbs/opentitan/hw/ip/prim_generic/rtl
SRC=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/rtl

echo "=== modules chan_top instantiates ==="
grep -oE '\b(prim_[a-z0-9_]+|pkt_[a-z0-9_]+|chan_[a-z0-9_]+)\b' "$SRC/stream/chan_top.sv" \
  | sort -u

echo
echo "=== resolving prim dependencies transitively ==="
# Start from what chan_top names, then follow instantiations inside each prim
# file until the set stops growing.
declare -A seen
queue=()
for m in $(grep -oE '\bprim_[a-z0-9_]+\b' "$SRC/stream/chan_top.sv" | sort -u); do
  queue+=("$m")
done

while [ ${#queue[@]} -gt 0 ]; do
  m="${queue[0]}"; queue=("${queue[@]:1}")
  [ -n "${seen[$m]:-}" ] && continue
  seen[$m]=1
  f=""
  for d in "$PRIM" "$GEN"; do
    [ -f "$d/$m.sv" ] && { f="$d/$m.sv"; break; }
  done
  [ -z "$f" ] && continue
  # Anything this file instantiates or imports.
  for dep in $(grep -oE '\bprim_[a-z0-9_]+\b' "$f" | sort -u); do
    [ -n "${seen[$dep]:-}" ] || queue+=("$dep")
  done
done

echo "--- files found ---"
for m in $(printf '%s\n' "${!seen[@]}" | sort); do
  for d in "$PRIM" "$GEN"; do
    if [ -f "$d/$m.sv" ]; then
      printf '%s\n' "$d/$m.sv"
      break
    fi
  done
done

echo
echo "--- named but not found as a file (package or generic-wrapped) ---"
for m in $(printf '%s\n' "${!seen[@]}" | sort); do
  found=0
  for d in "$PRIM" "$GEN"; do [ -f "$d/$m.sv" ] && found=1; done
  [ $found -eq 0 ] && printf '  %s\n' "$m"
done

echo
echo "=== include dirs needed (prim_assert.sv etc.) ==="
ls "$PRIM"/prim_assert*.sv "$PRIM"/*.svh 2>/dev/null | head -5
