#!/usr/bin/env bash
# virtuoso-bridge-lite 의존성을 D: 드라이브 안의 vendor 폴더에만 설치한다 (C:에 쓰지 않음).
#
#   setup_env.sh          계획만 출력한다 (아무것도 쓰지 않음)
#   setup_env.sh --yes    계획대로 설치한다 (이미 충족되어 있으면 아무것도 하지 않음 = 멱등)
set -euo pipefail
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
CLONE=/mnt/d/MyWork/Veriolg_MA/tools/virtuoso-bridge-lite
PKGS=("python-dotenv>=1.0" "pydantic>=2.0" "pyyaml>=6.0" "markdownify>=0.14")
APPLY=0
[ "${1:-}" = "--yes" ] && APPLY=1

missing=$(PYTHONPATH="$ROOT/vendor" python3 - <<'PY'
import importlib.util
miss = [m for m in ("pydantic", "dotenv", "yaml", "markdownify") if importlib.util.find_spec(m) is None]
print(" ".join(miss))
PY
)

echo "== vvirt setup plan"
echo "   install target : $ROOT/vendor   (pip --target; nothing is written outside D:)"
echo "   pip cache      : $ROOT/.pipcache"
echo "   packages       : ${PKGS[*]}"
echo "   does NOT touch : system Python, ~/.virtuoso-bridge, the bridge clone, any C: path"
if [ ! -d "$CLONE/src" ]; then
  echo "   NOTE: $CLONE is missing — clone it first (see tools/vvirt/README.md); this script only installs its dependencies"
fi
if [ -z "$missing" ]; then
  echo "   state          : all dependencies already importable from vendor/ -> nothing to do"
  [ "$APPLY" = 1 ] || exit 0
else
  echo "   state          : missing in vendor/: $missing"
  if [ "$APPLY" != 1 ]; then
    echo "== dry run only. Re-run with --yes to apply:  bash tools/vvirt/scripts/setup_env.sh --yes"
    exit 0
  fi
fi

if [ -n "$missing" ]; then
  export PIP_CACHE_DIR="$ROOT/.pipcache"
  mkdir -p "$ROOT/vendor"
  python3 -m pip install --quiet --target "$ROOT/vendor" --break-system-packages "${PKGS[@]}" 2>&1 | tail -5
  echo "--- installed"
  ls "$ROOT/vendor" | head -30
fi
echo "--- import test"
cd "$CLONE"
PYTHONPATH="$ROOT/vendor:src" python3 -c "
import virtuoso_bridge, pydantic
from virtuoso_bridge import VirtuosoClient
print('virtuoso_bridge import OK, pydantic', pydantic.VERSION)
"
du -sh "$ROOT/vendor" "$ROOT/.pipcache" 2>/dev/null || true
