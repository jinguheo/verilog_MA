#!/usr/bin/env bash
# Install OpenROAD's "common" dependencies (or-tools, Abseil, etc.) by driving
# OpenROAD's own DependencyInstaller directly.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/19_openroad_common_deps.sh
#
# ORFS's top-level setup.sh aborts on Ubuntu 26.04 at its KLayout step, so the
# OpenROAD dependency stage never ran and or-tools is missing. OpenROAD's own
# installer, by contrast, explicitly understands >= 26.04 (it normalises the
# version when picking a prebuilt or-tools tarball), so it is the right thing to
# call here. Downloads come from github.com/google/or-tools releases.
set -euo pipefail

OR_DIR="$HOME/eda/OpenROAD-flow-scripts/tools/OpenROAD"
DEPS_FILE="$HOME/eda/openroad_deps_prefixes.txt"

cd "$OR_DIR"

echo "=== ubuntu version as the installer sees it ==="
awk -F= '/^VERSION_ID/{print "VERSION_ID="$2}' /etc/os-release

echo
echo "=== installing common dependencies at $(date -u +%H:%M:%SZ) ==="
# -common installs or-tools and friends. Default prefix is /usr/local, hence
# sudo. -save-deps-prefixes records the CMake args the build needs afterwards.
sudo -n ./etc/DependencyInstaller.sh -common \
  -threads="$(nproc)" \
  -save-deps-prefixes="$DEPS_FILE"

echo
echo "=== recorded build prefixes ==="
if [ -f "$DEPS_FILE" ]; then cat "$DEPS_FILE"; else echo '(file not written)'; fi

echo
echo "=== is or-tools now discoverable? ==="
find /usr/local /opt "$HOME/.local" -maxdepth 5 -name 'ortoolsConfig.cmake' 2>/dev/null | head -5 \
  || echo 'ortoolsConfig.cmake not found'

echo
df -h "$HOME" | tail -1
echo "done at $(date -u +%H:%M:%SZ)"
