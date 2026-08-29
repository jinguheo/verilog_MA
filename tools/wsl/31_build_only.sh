#!/usr/bin/env bash
# Build OpenROAD + OpenSTA + the ORFS yosys, skipping setup.sh.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/31_build_only.sh
#
# setup.sh refuses to run on Ubuntu 26.04 ("Supported versions: 20.04, 22.04,
# 24.04") and aborts at its KLayout step. It had already installed everything
# else by then, and KLayout 0.30.0 is present from the distro, so that step is
# not needed. Every compile dependency was verified present before writing this.
set -euo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
cd "$ORFS"

echo "=== build_openroad.sh options ==="
./build_openroad.sh --help 2>&1 | head -30 || true

echo
echo "=== starting build at $(date -u +%H:%M:%SZ), $(nproc) cores ==="
# --local builds into ./tools/install instead of expecting a Docker image.
./build_openroad.sh --local --threads "$(nproc)"

echo
echo "=== result ==="
OR_BIN="$ORFS/tools/install/OpenROAD/bin/openroad"
STA_BIN="$ORFS/tools/install/OpenROAD/bin/sta"
YS_BIN="$ORFS/tools/install/yosys/bin/yosys"

for b in "$OR_BIN" "$STA_BIN" "$YS_BIN"; do
  printf '%-58s ' "$b"
  if [ -x "$b" ]; then echo 'OK'; else echo 'MISSING'; fi
done

[ -x "$OR_BIN" ] && "$OR_BIN" -version 2>&1 | head -2 || true
[ -x "$YS_BIN" ] && "$YS_BIN" -V 2>&1 | head -1 || true

echo
du -sh "$ORFS" 2>/dev/null
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
