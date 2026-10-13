#!/usr/bin/env bash
D=/home/oem/.local/state/virtuoso_bridge/local
echo "=== virtuoso_setup.il"; cat "$D/virtuoso_setup.il"; echo
echo "=== ~/.virtuoso-bridge"; ls -la ~/.virtuoso-bridge
echo "=== .local/state tree"; find ~/.local/state/virtuoso_bridge -maxdepth 3 | head -30
echo "=== ramic_bridge.il 앞부분 (설정 변수)"; grep -n -E 'RB_(PORT|PYTHON_PATH|DAEMON_PATH|LISTEN_ALL|IDENTITY_PATH|LOG_PATH|TOKEN)|^RB[A-Za-z]*\s*=|ramic_bridge_daemon' "$D/ramic_bridge.il" | head -30
echo "=== env 파일들"; find ~/.virtuoso-bridge ~/.local/state -type f \( -name '*.json' -o -name '*.env' -o -name 'bridge_token' \) 2>/dev/null | head
