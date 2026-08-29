#!/usr/bin/env bash
# Confirm OpenLane 2 works before removing anything else.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/71_verify_openlane.sh
#
# Two venvs exist (openlane312 and openlane_venv_311) and two PDK copies
# (~/.volare from OpenLane, ~/eda/pdk installed later by volare in this session).
# Work out which combination actually ran the three finished designs.
set -uo pipefail

echo "=== openlane entry points ==="
for p in "$HOME/.venvs/openlane312/bin/openlane" "$HOME/openlane_venv_311/bin/openlane"; do
  printf '%-46s ' "$p"
  if [ -x "$p" ]; then
    "$p" --version 2>&1 | head -1
  else
    echo '(missing)'
  fi
done

echo
echo "=== python behind each ==="
for v in "$HOME/.venvs/openlane312" "$HOME/openlane_venv_311"; do
  printf '%-32s ' "$(basename "$v")"
  [ -x "$v/bin/python" ] && "$v/bin/python" --version 2>&1 || echo '(missing)'
done

echo
echo "=== docker reachable from WSL? ==="
if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 && echo 'docker: OK' || echo 'docker: installed but daemon unreachable'
else
  echo 'docker: not installed inside this distro'
  echo '  (the finished runs used --dockerized, so Docker Desktop WSL integration'
  echo '   must have been enabled at the time, or the runs went through the other venv)'
fi

echo
echo "=== which PDK did the finished run actually use? ==="
RESOLVED=/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_ctrl/runs/RUN_2026-08-26_13-14-47/resolved.json
if [ -f "$RESOLVED" ]; then
  grep -oE '"(PDK_ROOT|PDK|STD_CELL_LIBRARY)"[^,]*' "$RESOLVED" | head -5
else
  echo '(resolved.json not found)'
fi

echo
echo "=== PDK copies on disk ==="
for d in "$HOME/.volare" "$HOME/eda/pdk"; do
  [ -e "$d" ] && printf '%-22s %s\n' "$d" "$(du -shL "$d" 2>/dev/null | cut -f1)"
done
