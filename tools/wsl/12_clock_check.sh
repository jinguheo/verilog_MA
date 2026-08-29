#!/usr/bin/env bash
# Is this machine's clock actually wrong, or is the archive publishing files
# dated ahead of real time? Compare against an HTTP Date header from a server
# that has nothing to do with the Ubuntu mirrors.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/12_clock_check.sh
set -uo pipefail

echo "=== local ==="
date -u +'%Y-%m-%d %H:%M:%S UTC   (epoch %s)'

echo
echo "=== remote HTTP Date headers ==="
for h in https://www.google.com https://github.com http://archive.ubuntu.com; do
  d="$(curl -sSI --max-time 20 "$h" 2>/dev/null | grep -i '^date:' | head -1 | cut -d' ' -f2-)"
  if [ -n "$d" ]; then
    printf '%-32s %s\n' "$h" "$d"
    r="$(date -u -d "$d" +%s 2>/dev/null)"
    l="$(date -u +%s)"
    if [ -n "$r" ]; then
      printf '%-32s skew = %s seconds (remote - local)\n' '' "$((r - l))"
    fi
  else
    printf '%-32s (no Date header)\n' "$h"
  fi
done

echo
echo "=== chrony status ==="
if command -v chronyc >/dev/null 2>&1; then
  chronyc tracking 2>&1 | head -8
else
  echo '(chronyc not installed)'
fi

echo
echo "=== the Release file the archive is serving ==="
curl -sS --max-time 25 http://archive.ubuntu.com/ubuntu/dists/resolute-updates/Release 2>/dev/null \
  | grep -E '^(Date|Valid-Until):' | head -4 || echo '(fetch failed)'
