#!/usr/bin/env bash
# Confirm the clock is now correct by comparing against independent servers.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/14_clock_verify.sh
set -uo pipefail

l="$(date -u +%s)"
echo "WSL  local UTC : $(date -u +'%Y-%m-%d %H:%M:%S')"

worst=0
for h in https://www.google.com https://github.com; do
  d="$(curl -sSI --max-time 20 "$h" 2>/dev/null | grep -i '^date:' | head -1 | cut -d' ' -f2-)"
  [ -z "$d" ] && continue
  r="$(date -u -d "$d" +%s 2>/dev/null)" || continue
  skew=$(( r - l ))
  printf '%-26s %s  skew %+ds\n' "$(echo "$h" | sed 's|https://||')" "$d" "$skew"
  a=${skew#-}
  [ "$a" -gt "$worst" ] && worst=$a
done

echo
if [ "$worst" -le 120 ]; then
  echo "VERDICT: clock is correct (worst skew ${worst}s)"
  exit 0
else
  echo "VERDICT: still skewed by ${worst}s"
  echo "Note: WSL takes its time from the Windows host at VM start. If Windows is"
  echo "now right but this still reports skew, the WSL VM needs 'wsl --shutdown'"
  echo "to pick it up - which would kill anything running inside it."
  exit 1
fi
