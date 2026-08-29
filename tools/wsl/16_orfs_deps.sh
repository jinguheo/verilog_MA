#!/usr/bin/env bash
# Install the apt packages ORFS asks for, taken from its own DependencyInstaller
# rather than guessed one failure at a time.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/16_orfs_deps.sh
#
# setup.sh aborts on Ubuntu 26.04 before finishing, which is how libabsl-dev
# ended up missing and stopped the OpenROAD cmake configure.
set -uo pipefail

ORFS="$HOME/eda/OpenROAD-flow-scripts"
DI="$ORFS/etc/DependencyInstaller.sh"
export DEBIAN_FRONTEND=noninteractive

echo "=== package lists found in DependencyInstaller.sh ==="
grep -nE 'packages=|apt-get install|PKGS' "$DI" 2>/dev/null | head -20

echo
echo "=== extracting ubuntu package names ==="
# Pull anything that looks like a package name out of the base/common lists.
PKGS="$(sed -n '/_installUbuntuPackages\|_installUbuntuCleanUp\|base-packages\|packages=(/,/)/p' "$DI" 2>/dev/null \
        | grep -oE '\b(lib[a-z0-9.+-]+|[a-z][a-z0-9.+-]{2,})\b' \
        | grep -vE '^(sudo|apt|get|install|y|no|install-recommends|export|DEBIAN|FRONTEND|noninteractive|if|then|fi|else|local|function|echo|version|packages|base|common|ubuntu|case|esac|in|do|done|for|while|return|true|false)$' \
        | sort -u | tr '\n' ' ')"
echo "$PKGS" | tr ' ' '\n' | head -40
echo "(count: $(echo "$PKGS" | wc -w))"

echo
echo "=== installing the ones apt actually has ==="
# Known OpenROAD build requirements on top of whatever the extraction found.
EXTRA="libabsl-dev libprotobuf-dev protobuf-compiler libgmp-dev libmpfr-dev
       liblemon-dev libcimg-dev libpcre2-dev tcl-tclreadline libcairo2-dev
       ninja-build libomp-dev"

OK=0; SKIP=0
for p in $PKGS $EXTRA; do
  if apt-cache show "$p" >/dev/null 2>&1; then
    if sudo -n apt-get install -y -qq "$p" >/dev/null 2>&1; then
      OK=$((OK+1))
    else
      echo "  install failed: $p"; SKIP=$((SKIP+1))
    fi
  else
    SKIP=$((SKIP+1))
  fi
done
echo "installed/already-present: $OK   unavailable-or-failed: $SKIP"

echo
echo "=== the one that blocked the build ==="
dpkg -s libabsl-dev 2>/dev/null | grep -E '^(Package|Version)' || echo 'libabsl-dev STILL MISSING'
ls -1 /usr/lib/x86_64-linux-gnu/cmake/absl/abslConfig.cmake 2>/dev/null \
  && echo 'abslConfig.cmake found' || echo 'abslConfig.cmake NOT found'
