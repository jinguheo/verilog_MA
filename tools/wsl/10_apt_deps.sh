#!/usr/bin/env bash
# Step 1: system packages for an open-source RTL-to-GDS flow.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/10_apt_deps.sh
#
# Everything installs inside the WSL distro, which lives on D:\WSL\Ubuntu, so
# this does not consume C: space.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== apt update ==="
# The archive's Release file carries a timestamp ahead of this machine's clock,
# which makes apt reject it as "not valid yet". Check-Date=false skips only that
# validity window - the GPG signature on the Release file is still verified, so
# package authenticity is unaffected.
APT_OPTS="-o Acquire::Check-Date=false -o Acquire::Check-Valid-Until=false"
# shellcheck disable=SC2086
sudo -n apt-get $APT_OPTS update -qq

echo
echo "=== build toolchain and libraries ==="
# Split into groups so one unavailable package does not abort the whole run.
BUILD_PKGS="build-essential cmake ninja-build git pkg-config"
LANG_PKGS="python3 python3-pip python3-venv tcl-dev tk-dev swig"
LIB_PKGS="libreadline-dev zlib1g-dev libffi-dev libboost-all-dev libeigen3-dev
          libspdlog-dev libgtest-dev flex bison libfl-dev"
UTIL_PKGS="curl wget xz-utils unzip ca-certificates time"

for grp in "$BUILD_PKGS" "$LANG_PKGS" "$LIB_PKGS" "$UTIL_PKGS"; do
  # shellcheck disable=SC2086
  sudo -n apt-get $APT_OPTS install -y -qq $grp || {
    echo "WARN: group failed, retrying one by one:" >&2
    for p in $grp; do sudo -n apt-get $APT_OPTS install -y -qq "$p" || echo "  skipped: $p" >&2; done
  }
done

echo
echo "=== physical verification tools from the distro ==="
# klayout / magic / netgen give DRC, LVS and GDS viewing. Availability varies by
# release, so each is attempted separately and a miss is reported, not fatal.
for p in klayout magic netgen-lvs netgen; do
  if apt-cache show "$p" >/dev/null 2>&1; then
    sudo -n apt-get $APT_OPTS install -y -qq "$p" && echo "installed: $p" || echo "failed: $p"
  else
    echo "not in repo: $p"
  fi
done

echo
echo "=== versions ==="
for t in cmake g++ python3 tclsh klayout magic netgen; do
  printf '%-9s ' "$t"
  if command -v "$t" >/dev/null 2>&1; then
    "$t" --version 2>&1 | head -1
  else
    echo '(not installed)'
  fi
done

echo
echo "=== disk ==="
df -h "$HOME" | tail -1
echo "step 1 complete"
