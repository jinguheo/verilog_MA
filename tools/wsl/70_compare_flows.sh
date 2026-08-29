#!/usr/bin/env bash
# Compare the two P&R installations before deciding which one to keep.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/70_compare_flows.sh
set -uo pipefail

echo "=============== OpenLane 2 (the one that produced GDS) ==============="
echo "--- venv / entry point ---"
for p in "$HOME/.venv-openlane/bin/openlane" "$HOME/openlane/bin/openlane" \
         "$HOME/eda/openlane/bin/openlane"; do
  [ -x "$p" ] && echo "found: $p"
done
command -v openlane 2>/dev/null || echo "openlane not on PATH"
# It was installed into a uv-managed python 3.11 venv per the dashboard notes.
find "$HOME" -maxdepth 4 -name 'openlane' -type f -perm -u+x 2>/dev/null | head -5

echo
echo "--- docker images it uses ---"
docker images 2>/dev/null | grep -iE 'openlane|efabless' | head -5 || echo '(docker not reachable from here)'

echo
echo "--- disk used ---"
for d in "$HOME/.volare" "$HOME/eda/pdk" "$HOME/.venv-openlane"; do
  [ -e "$d" ] && du -shL "$d" 2>/dev/null
done

echo
echo "=============== ORFS (the one still unbuilt) ==============="
ORFS="$HOME/eda/OpenROAD-flow-scripts"
if [ -d "$ORFS" ]; then
  du -sh "$ORFS" 2>/dev/null
  echo "--- did it ever produce a binary? ---"
  find "$ORFS" -maxdepth 5 -type f -perm -u+x -name openroad 2>/dev/null | head -3 \
    || echo 'no openroad binary'
  echo "--- bazel cache size ---"
  du -sh "$HOME/.cache/bazel" 2>/dev/null || echo '(no bazel cache)'
else
  echo 'ORFS not present'
fi

echo
echo "=============== what OpenLane already gives us ==============="
# If OpenLane bundles its own OpenROAD, building ORFS is duplicated effort.
docker run --rm efabless/openlane2:latest openroad -version 2>/dev/null | head -2 \
  || echo '(could not query the OpenLane image directly)'

echo
echo "=============== reclaimable if ORFS is dropped ==============="
R=0
for d in "$ORFS" "$HOME/.cache/bazel"; do
  if [ -e "$d" ]; then
    s=$(du -sm "$d" 2>/dev/null | cut -f1)
    echo "  $(printf '%6s MB' "$s")  $d"
    R=$((R + s))
  fi
done
echo "  total: ${R} MB"
df -h "$HOME" | tail -1
