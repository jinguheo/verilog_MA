#!/usr/bin/env bash
# Install the SkyWater sky130 PDK (open_pdks build) with volare.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/40_sky130_pdk.sh
#
# volare fetches a prebuilt open_pdks release, which is what gives us the
# standard-cell liberty/LEF files, tech LEF, magic tech files and the DRC decks
# that KLayout/Magic/netgen need. It installs under $HOME (WSL disk on D:), so
# C: is untouched, and it needs no root.
set -euo pipefail

EDA_ROOT="$HOME/eda"
VENV="$EDA_ROOT/venv"
export PDK_ROOT="$EDA_ROOT/pdk"
mkdir -p "$EDA_ROOT" "$PDK_ROOT"

echo "=== python venv ==="
# Ubuntu marks the system python as externally managed, so pip installs go into
# a venv rather than fighting PEP 668.
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet volare
echo "volare: $("$VENV/bin/volare" --version 2>&1 | head -1)"

echo
echo "=== available sky130 builds (most recent first) ==="
"$VENV/bin/volare" ls-remote --pdk sky130 2>&1 | head -8

echo
echo "=== enabling the latest sky130 build ==="
# Take the newest listed version rather than pinning a stale hash.
VER="$("$VENV/bin/volare" ls-remote --pdk sky130 2>/dev/null | grep -oE '[0-9a-f]{40}' | head -1)"
if [ -z "$VER" ]; then
  echo "ERROR: could not determine a sky130 version from ls-remote" >&2
  exit 1
fi
echo "version: $VER"
"$VENV/bin/volare" enable --pdk sky130 "$VER"

echo
echo "=== result ==="
echo "PDK_ROOT=$PDK_ROOT"
ls -1 "$PDK_ROOT" 2>/dev/null
echo
echo "--- sky130A contents ---"
ls -1 "$PDK_ROOT/sky130A" 2>/dev/null | head -20
echo
echo "--- standard cell libs present? ---"
find "$PDK_ROOT/sky130A" -maxdepth 3 -name '*.lib' 2>/dev/null | head -5
find "$PDK_ROOT/sky130A" -maxdepth 3 -name '*.lef' 2>/dev/null | head -5
echo
du -sh "$PDK_ROOT" 2>/dev/null
df -h "$HOME" | tail -1
echo "pdk step complete"
