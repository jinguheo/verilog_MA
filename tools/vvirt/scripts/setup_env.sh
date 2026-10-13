#!/usr/bin/env bash
# virtuoso-bridge-lite 의존성을 D: 드라이브 안의 vendor 폴더에만 설치한다 (C:에 쓰지 않음).
set -euo pipefail
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
export PIP_CACHE_DIR="$ROOT/.pipcache"
mkdir -p "$ROOT/vendor"
python3 -m pip install --quiet --target "$ROOT/vendor" --break-system-packages \
  "python-dotenv>=1.0" "pydantic>=2.0" "pyyaml>=6.0" "markdownify>=0.14" 2>&1 | tail -5
echo "--- installed"
ls "$ROOT/vendor" | head -30
echo "--- import test"
cd /mnt/d/MyWork/Veriolg_MA/tools/virtuoso-bridge-lite
PYTHONPATH="$ROOT/vendor:src" python3 -c "
import virtuoso_bridge, pydantic
from virtuoso_bridge import VirtuosoClient
print('virtuoso_bridge import OK, pydantic', pydantic.VERSION)
"
du -sh "$ROOT/vendor" "$ROOT/.pipcache" 2>/dev/null
