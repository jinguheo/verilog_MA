#!/usr/bin/env bash
# Build OpenROAD-flow-scripts (OpenROAD + OpenSTA + yosys) from source.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/30_build_openroad.sh
#
# Why source and not a prebuilt binary: as of this run, Precision-Innovations
# has moved its prebuilt releases to vaultlink.precisioninno.com, and the
# official The-OpenROAD-Project/OpenROAD v0.9.0-beta release carries no assets.
# Building from the official GitHub repository avoids pulling executables from
# an unfamiliar host.
#
# Location: $HOME, i.e. inside the WSL ext4 disk at D:\WSL\Ubuntu. That keeps it
# off C: and is far faster than building on /mnt/d, where every small file goes
# through the 9p filesystem bridge.
set -euo pipefail

EDA_ROOT="$HOME/eda"
ORFS_DIR="$EDA_ROOT/OpenROAD-flow-scripts"
LOG_DIR="/mnt/d/MyWork/Veriolg_MA/tools/wsl/logs"
mkdir -p "$EDA_ROOT" "$LOG_DIR"

echo "=== 1/3 clone ==="
if [ -d "$ORFS_DIR/.git" ]; then
  echo "already cloned at $ORFS_DIR"
  git -C "$ORFS_DIR" fetch --depth 1 origin || true
else
  # --depth 1 keeps the clone small; submodules carry OpenROAD itself.
  git clone --depth 1 --recursive \
    https://github.com/The-OpenROAD-Project/OpenROAD-flow-scripts.git "$ORFS_DIR"
fi
echo "clone size: $(du -sh "$ORFS_DIR" 2>/dev/null | cut -f1)"

echo
echo "=== 2/3 dependencies (setup.sh) ==="
cd "$ORFS_DIR"
# setup.sh needs root for apt; passwordless sudo is already configured.
sudo -n ./setup.sh 2>&1 | tail -30

echo
echo "=== 3/3 build ==="
echo "starting at $(date -u +%H:%M:%SZ) with $(nproc) cores; this takes a while"
# --local builds into ./tools rather than expecting a Docker image.
./build_openroad.sh --local --threads "$(nproc)" 2>&1 | tail -40

echo
echo "=== result ==="
if [ -x "$ORFS_DIR/tools/install/OpenROAD/bin/openroad" ]; then
  "$ORFS_DIR/tools/install/OpenROAD/bin/openroad" -version || true
  echo "OpenROAD build: OK"
else
  echo "OpenROAD binary not found at the expected path" >&2
  find "$ORFS_DIR/tools/install" -maxdepth 3 -name openroad -o -maxdepth 3 -name sta 2>/dev/null | head
fi
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
