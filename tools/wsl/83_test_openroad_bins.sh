#!/usr/bin/env bash
# One of the nix openroad builds has a broken libomp ("file too short", a
# partially garbage-collected store path). Find one that actually runs.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/83_test_openroad_bins.sh
set -uo pipefail

echo "=== every openroad in the store ==="
mapfile -t BINS < <(find /nix/store -maxdepth 3 -type f -name openroad -perm -u+x 2>/dev/null)
for b in "${BINS[@]}"; do
  printf '%s\n' "$b"
  if out="$("$b" -version 2>&1 | head -2)"; then
    printf '   OK   %s\n' "$(echo "$out" | tr '\n' ' ')"
  else
    printf '   FAIL %s\n' "$(echo "$out" | tr '\n' ' ' | cut -c1-140)"
  fi
done

echo
echo "=== same for sta ==="
for b in $(find /nix/store -maxdepth 3 -type f -name sta -perm -u+x 2>/dev/null); do
  printf '%s\n' "$b"
  "$b" -version 2>&1 | head -1 | sed 's/^/   /'
done

echo
echo "=== the broken library ==="
ls -l /nix/store/6ia2skn5r0sryd3pn5398d0zm8xsyk69-openmp-17.0.6/lib/libomp.so 2>&1 | head -2
echo '--- other libomp copies ---'
find /nix/store -maxdepth 4 -name 'libomp.so*' 2>/dev/null | head -5 | while read -r f; do
  printf '%10s  %s\n' "$(stat -c %s "$f" 2>/dev/null)" "$f"
done
