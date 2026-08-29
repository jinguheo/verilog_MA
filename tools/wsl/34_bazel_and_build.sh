#!/usr/bin/env bash
# Install bazelisk, then build OpenROAD.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/34_bazel_and_build.sh
#
# Two corrections from the previous attempt:
#  1. Build.sh already reads etc/openroad_deps_prefixes.txt on its own
#     ("[INFO] Using additional CMake parameters from ..."), so passing
#     -cmake= is unnecessary and in fact mangled the argument list.
#  2. Current OpenROAD requires Bazel; its pre-compilation check stops the
#     build when bazelisk is absent. Installed here from the official
#     github.com/bazelbuild/bazelisk release the installer points at.
set -euo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
OR_DIR="$ORFS/tools/OpenROAD"
cd "$OR_DIR"

echo "=== installing bazelisk at $(date -u +%H:%M:%SZ) ==="
sudo -n ./etc/DependencyInstaller.sh -bazel

echo
echo "=== bazel available? ==="
for b in bazelisk bazel; do
  printf '%-9s ' "$b"; command -v "$b" 2>/dev/null || echo '(none)'
done

echo
echo "=== building OpenROAD at $(date -u +%H:%M:%SZ), $(nproc) cores ==="
./etc/Build.sh -threads="$(nproc)"

echo
echo "=== result ==="
find "$OR_DIR/build" -maxdepth 3 -type f -perm -u+x \( -name openroad -o -name sta \) 2>/dev/null | head -5
OR_BIN="$(find "$OR_DIR/build" -maxdepth 3 -type f -perm -u+x -name openroad 2>/dev/null | head -1)"
if [ -n "$OR_BIN" ]; then
  "$OR_BIN" -version 2>&1 | head -3
  echo "OpenROAD: OK"
else
  echo "OpenROAD binary not found" >&2
fi

echo
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
