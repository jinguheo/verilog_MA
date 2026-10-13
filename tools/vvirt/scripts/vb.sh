#!/usr/bin/env bash
# virtuoso-bridge CLI 실행 래퍼 (WSL). 의존성은 D:의 vendor 폴더, 소스는 tools/virtuoso-bridge-lite.
ROOT=/mnt/d/MyWork/Veriolg_MA/tools
export PYTHONPATH="$ROOT/vvirt/vendor:$ROOT/virtuoso-bridge-lite/src:$ROOT/vvirt/src${PYTHONPATH:+:$PYTHONPATH}"
export PIP_CACHE_DIR="$ROOT/vvirt/.pipcache"
exec python3 -c "import sys; from virtuoso_bridge.cli import main; sys.argv=['virtuoso-bridge']+sys.argv[1:]; raise SystemExit(main())" "$@"
