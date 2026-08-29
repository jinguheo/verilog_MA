#!/usr/bin/env bash
# Survey the WSL environment before installing anything.
# Run as:  sed 's/\r$//' /mnt/d/MyWork/Veriolg_MA/tools/wsl/00_survey.sh | bash
set -u

echo "=== OS / CPU ==="
. /etc/os-release; echo "$PRETTY_NAME"
echo "cores: $(nproc)"

echo
echo "=== existing tools ==="
for t in yosys openroad sta klayout magic netgen python3 pip3 pip git cmake g++ curl wget tar xz unzip; do
  printf '%-10s ' "$t"
  if command -v "$t" >/dev/null 2>&1; then command -v "$t"; else echo '(none)'; fi
done

echo
echo "=== python ==="
python3 --version 2>&1 || true
python3 -c 'import venv; print("venv: ok")' 2>&1 || echo 'venv: missing'
python3 -m pip --version 2>&1 || echo 'pip module: missing'

echo
echo "=== privileges ==="
if sudo -n true 2>/dev/null; then echo 'passwordless sudo: YES'; else echo 'passwordless sudo: NO'; fi
echo "uid=$(id -u) user=$(whoami)"

echo
echo "=== storage ==="
echo "HOME=$HOME"
df -h "$HOME" | tail -1
df -h /mnt/d | tail -1

echo
echo "=== network ==="
for u in https://github.com https://objects.githubusercontent.com https://pypi.org; do
  printf '%-42s ' "$u"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "$u" 2>&1 || echo 'FAIL'
done
