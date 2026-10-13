#!/usr/bin/env bash
# WSL 환경 점검 (읽기 전용)
python3 --version
python3 -m pip --version 2>&1 | head -1
python3 -m venv --help >/dev/null 2>&1 && echo "venv module: ok" || echo "venv module: missing"
echo "HOME=$HOME  (WSL home은 C: 드라이브의 vhdx 안에 있음)"
df -h /mnt/c /mnt/d 2>/dev/null | head -3
echo "--- vhdx 위치/크기"
for f in /mnt/c/Users/oem/AppData/Local/Packages/*/LocalState/ext4.vhdx /mnt/c/Users/oem/AppData/Local/wsl/*/ext4.vhdx; do [ -f "$f" ] && ls -l --block-size=G "$f"; done
echo "--- WSL 안에서 큰 폴더 (홈)"
du -sh "$HOME"/* 2>/dev/null | sort -rh | head -8
