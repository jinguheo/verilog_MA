#!/usr/bin/env bash
# Find a usable OpenROAD distribution before committing to a long source build.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/21_openroad_probe2.sh
set -uo pipefail

echo "=== does apt know opensta / openroad at all? ==="
for p in opensta openroad openroad-flow; do
  echo "--- $p ---"
  apt-cache policy "$p" 2>/dev/null || echo '(unknown package)'
done

echo
echo "=== Precision-Innovations release body (where did builds move to?) ==="
curl -sS --max-time 30 https://api.github.com/repos/Precision-Innovations/OpenROAD/releases/latest 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("tag:",d.get("tag_name")); print("name:",d.get("name")); print("body:"); print((d.get("body") or "")[:1200])' \
  2>/dev/null || echo '(parse failed)'

echo
echo "=== The-OpenROAD-Project/OpenROAD releases ==="
curl -sS --max-time 30 https://api.github.com/repos/The-OpenROAD-Project/OpenROAD/releases 2>/dev/null \
  | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print("parse failed:", e); raise SystemExit
if not d:
    print("(no releases)"); raise SystemExit
for r in d[:3]:
    print("tag:", r.get("tag_name"), "| assets:", len(r.get("assets") or []))
    for a in (r.get("assets") or [])[:10]:
        print("   ", a["name"], round(a["size"]/1e6,1), "MB")
' 2>/dev/null || echo '(query failed)'

echo
echo "=== ORFS repo reachable for clone? ==="
curl -sS -o /dev/null -w 'repo: %{http_code}\n' --max-time 25 \
  https://api.github.com/repos/The-OpenROAD-Project/OpenROAD-flow-scripts 2>&1 || echo FAIL

echo
echo "=== volare / ciel on PyPI (PDK manager) ==="
for p in volare ciel; do
  printf '%-7s ' "$p"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 "https://pypi.org/pypi/$p/json" 2>&1 || echo FAIL
done

echo
echo "probe complete"
