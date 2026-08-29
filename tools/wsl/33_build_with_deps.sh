#!/usr/bin/env bash
# Build OpenROAD (+ OpenSTA) and the ORFS yosys, feeding in the dependency
# prefixes recorded by the DependencyInstaller.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/33_build_with_deps.sh
#
# The deps live in non-default prefixes (/usr/local and /opt/or-tools), so the
# cmake args saved by -save-deps-prefixes have to be passed through, otherwise
# the configure step fails to find ortools exactly as it did before.
set -euo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
DEPS_FILE="$HOME/eda/openroad_deps_prefixes.txt"
CMAKE_ARGS="$(cat "$DEPS_FILE")"

echo "=== how build_openroad.sh forwards cmake args ==="
grep -nE 'cmake|CMAKE_ARGS|deps-prefixes|Build\.sh' "$ORFS/build_openroad.sh" | head -20

echo
echo "=== dependency prefixes being passed ==="
echo "$CMAKE_ARGS"

echo
echo "=== building OpenROAD directly at $(date -u +%H:%M:%SZ), $(nproc) cores ==="
cd "$ORFS/tools/OpenROAD"
# OpenROAD's own build script accepts the cmake args verbatim.
./etc/Build.sh -threads="$(nproc)" -cmake="$CMAKE_ARGS"

echo
echo "=== OpenROAD result ==="
for b in "$ORFS/tools/OpenROAD/build/src/openroad" \
         "$ORFS/tools/OpenROAD/build/sta" ; do
  printf '%-62s ' "$b"; [ -x "$b" ] && echo OK || echo MISSING
done
find "$ORFS/tools/OpenROAD" -maxdepth 4 -type f -name openroad -perm -u+x 2>/dev/null | head -3

echo
echo "=== building ORFS yosys at $(date -u +%H:%M:%SZ) ==="
cd "$ORFS"
if [ -d tools/yosys ]; then
  make -C tools/yosys -j "$(nproc)" PREFIX="$ORFS/tools/install/yosys" install 2>&1 | tail -15 \
    || echo 'yosys build reported an error; the distro yosys 0.52 remains available as a fallback'
fi

echo
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
