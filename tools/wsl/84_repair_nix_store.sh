#!/usr/bin/env bash
# /nix/store/...-openmp-17.0.6/lib/libomp.so is 0 bytes, so every openroad build
# in the store fails to load. Try the supported repair first.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/84_repair_nix_store.sh
set -uo pipefail

BAD=/nix/store/6ia2skn5r0sryd3pn5398d0zm8xsyk69-openmp-17.0.6

echo "=== is nix available anywhere? ==="
for c in nix nix-store nix-env; do
  printf '%-10s ' "$c"
  command -v "$c" 2>/dev/null || echo '(not on PATH)'
done
for p in /nix/var/nix/profiles/default/bin /root/.nix-profile/bin "$HOME/.nix-profile/bin"; do
  [ -d "$p" ] && { echo "profile bin: $p"; ls "$p" 2>/dev/null | head -8; }
done

NIX="$(command -v nix 2>/dev/null || echo /nix/var/nix/profiles/default/bin/nix)"
NIXSTORE="$(command -v nix-store 2>/dev/null || echo /nix/var/nix/profiles/default/bin/nix-store)"

echo
echo "=== verify what the store thinks ==="
if [ -x "$NIXSTORE" ]; then
  echo "using: $NIXSTORE"
  sudo -n "$NIXSTORE" --verify --check-contents 2>&1 | tail -15
else
  echo 'nix-store not found - cannot use the supported repair path'
fi

echo
echo "=== attempt repair ==="
if [ -x "$NIXSTORE" ]; then
  sudo -n "$NIXSTORE" --repair-path "$BAD" 2>&1 | tail -10 \
    && echo 'repair command completed' || echo 'repair failed'
else
  echo 'skipped'
fi

echo
echo "=== result ==="
ls -l "$BAD/lib/" 2>/dev/null | head -5
OR=/nix/store/zzypcxbrgw1qink1l7fwgwpbk7fvdwpg-openroad/bin/openroad
"$OR" -version 2>&1 | head -2
