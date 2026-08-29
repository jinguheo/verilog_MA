#!/usr/bin/env bash
# Work around a host clock that is 9 hours behind real UTC.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/13_apt_date_workaround.sh
#
# The Windows host clock is behind actual time, and WSL inherits it, so every
# archive Release file looks like it is "not valid yet" and apt refuses it.
# That breaks any script that calls apt-get update itself - ORFS setup.sh does.
#
# This disables ONLY the timestamp validity window. The GPG signature on the
# Release file is still verified, so package authenticity is unaffected.
#
# The real fix is the host clock. To undo this once that is corrected:
#   wsl -d Ubuntu -- sudo rm /etc/apt/apt.conf.d/99-clock-skew
set -euo pipefail

CONF=/etc/apt/apt.conf.d/99-clock-skew

sudo -n tee "$CONF" >/dev/null <<'EOF'
// Host clock is behind real time; skip the Release file validity window only.
// Signature verification is untouched.
Acquire::Check-Date "false";
Acquire::Check-Valid-Until "false";
EOF

echo "wrote $CONF:"
cat "$CONF"

echo
echo "=== verifying apt-get update now works unaided ==="
sudo -n apt-get update -qq && echo 'apt-get update: OK' || { echo 'apt-get update: STILL FAILING' >&2; exit 1; }

echo
echo "clock skew (informational):"
r="$(curl -sSI --max-time 20 https://github.com 2>/dev/null | grep -i '^date:' | cut -d' ' -f2-)"
echo "  local : $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo "  remote: $r"
