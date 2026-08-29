#!/usr/bin/env bash
# Build OpenROAD without the GUI. This is the one to use.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/35_build_nogui.sh
#
# The previous attempt spent its entire run compiling Qt 6.9.1 from source
# (qtbase, harfbuzz, the xcb platform plugins) and died at 10,335/11,882 with
# no compiler error - not an OOM either: 13 GB of 15 GB was free and the kernel
# logged no kill. Whatever ended it, almost all of that work was for OpenROAD's
# GUI, which this project does not need:
#
#   - the flow runs in batch (make DESIGN_CONFIG=...)
#   - layout viewing is already covered by KLayout 0.30.0
#
# -no-gui sets -DBUILD_GUI=OFF and removes Qt from the build graph entirely,
# which should cut the remaining work by roughly two thirds.
#
# Bazel's cache is preserved, so non-Qt work already done is not repeated.
set -euo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
cd "$ORFS/tools/OpenROAD"

echo "=== starting at $(date -u +%H:%M:%SZ), $(nproc) cores, GUI disabled ==="
./etc/Build.sh -no-gui -threads="$(nproc)"

echo
echo "=== result ==="
OR_BIN="$(find "$ORFS/tools/OpenROAD" -maxdepth 4 -type f -perm -u+x -name openroad 2>/dev/null | head -1)"
if [ -n "$OR_BIN" ]; then
  echo "binary: $OR_BIN"
  "$OR_BIN" -version 2>&1 | head -3
  echo 'OpenROAD: OK'
else
  echo 'OpenROAD binary still not produced' >&2
  exit 1
fi

echo
echo "=== does it carry OpenSTA? ==="
"$OR_BIN" -no_init -exit -python -c 'print("python binding ok")' 2>&1 | head -3 || true

echo
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
