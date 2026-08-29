#!/usr/bin/env bash
# Repair every corrupted path in the nix store, not one failure at a time.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/85_repair_all.sh
#
# `nix-store --verify --check-contents` reported a long list of paths whose
# contents no longer match their recorded hash — libomp.so was 0 bytes, and
# rich/table.py inside the openroad python env is truncated as well. Fixing them
# individually just moves the failure to the next step, so this runs the repair
# across the whole store. Paths are re-fetched from cache.nixos.org.
#
# This can take a while and re-downloads a fair amount.
set -uo pipefail

NIXSTORE=/nix/var/nix/profiles/default/bin/nix-store
[ -x "$NIXSTORE" ] || NIXSTORE="$(command -v nix-store)"
[ -x "$NIXSTORE" ] || { echo 'nix-store not found' >&2; exit 1; }

echo "=== repairing (this re-downloads corrupted paths) ==="
sudo -n "$NIXSTORE" --verify --check-contents --repair 2>&1 | tail -25

echo
echo "=== re-verify ==="
sudo -n "$NIXSTORE" --verify --check-contents 2>&1 | tail -12

echo
echo "=== spot-check the tools OpenLane needs ==="
for b in /nix/store/*openroad-python3*/bin/openroad /nix/store/*opensta*/bin/sta; do
  [ -x "$b" ] || continue
  printf '%-70s ' "$(basename "$(dirname "$(dirname "$b")")")"
  "$b" -version 2>&1 | head -1
done

echo
echo "=== can the odb python stack import? ==="
OR="$(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null | grep 'python3.*env' | head -1)"
if [ -n "$OR" ]; then
  "$OR" -python -c 'from rich.table import Table; print("rich.table: ok")' 2>&1 | tail -3
fi
