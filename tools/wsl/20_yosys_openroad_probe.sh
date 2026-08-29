#!/usr/bin/env bash
# Install yosys from the distro and probe what is available for OpenROAD before
# committing to a download or a source build.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/20_yosys_openroad_probe.sh
set -uo pipefail

APT_OPTS="-o Acquire::Check-Date=false -o Acquire::Check-Valid-Until=false"
export DEBIAN_FRONTEND=noninteractive

echo "=== yosys candidate in the distro ==="
apt-cache policy yosys 2>/dev/null | head -3

echo
echo "=== installing yosys + tcl/tk runtime ==="
# shellcheck disable=SC2086
sudo -n apt-get $APT_OPTS install -y -qq yosys && echo 'yosys installed' || echo 'yosys install FAILED'

echo
echo "=== netgen-lvs binary name ==="
dpkg -L netgen-lvs 2>/dev/null | grep -E '^/usr/(bin|local/bin)/' || echo '(no binaries listed)'

echo
echo "=== is OpenROAD packaged anywhere apt can see? ==="
for p in openroad opensta; do
  printf '%-9s ' "$p"
  apt-cache policy "$p" 2>/dev/null | sed -n '2p' | sed 's/^ *//' || echo 'n/a'
done

echo
echo "=== versions now ==="
if command -v yosys >/dev/null 2>&1; then yosys -V 2>&1 | head -1; fi

echo
echo "=== reachability of OpenROAD prebuilt sources ==="
for u in \
  https://api.github.com/repos/Precision-Innovations/OpenROAD/releases/latest \
  https://api.github.com/repos/The-OpenROAD-Project/OpenROAD-flow-scripts/releases/latest ; do
  printf '%-72s ' "$(basename "$(dirname "$(dirname "$u")")")"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 25 "$u" 2>&1 || echo FAIL
done

echo
echo "=== latest OpenROAD prebuilt asset names ==="
curl -sS --max-time 30 https://api.github.com/repos/Precision-Innovations/OpenROAD/releases/latest 2>/dev/null \
  | grep -E '"(tag_name|name)":' | head -12 || echo '(query failed)'

echo
echo "probe complete"
