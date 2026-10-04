#!/usr/bin/env bash
# Run a generated candidate config through a staged OpenLane flow.
# Args: <config.json> <run-tag> <layout-output-dir> [screen|signoff|full] [shared-state]
set -euo pipefail

CFG="${1:?candidate config required}"
RUN_TAG="${2:?run tag required}"
OUT="${3:?layout output directory required}"
MODE="${4:-full}"
SHARED_STATE="${5:-}"
ROOT=/mnt/d/MyWork
REPO=/mnt/d/MyWork/Veriolg_MA
OL="$HOME/.venvs/openlane312/bin/openlane"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ] || { echo "openlane not found: $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | grep -- "$pref" | head -1 || true)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1 || true)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-layout-candidate/bin"
if [ ! -e "$SHIM/yosys" ]; then
  rm -rf "$SHIM"; mkdir -p "$SHIM"
  for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
    tool="${spec%%:*}"; pref="${spec#*:}"
    d="$(pick_bin "$tool" "${pref:-.}")" || true
    [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
  done
  ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
fi
export PATH="$SHIM:$PATH"

echo "candidate config: $CFG"
echo "run tag         : $RUN_TAG"
echo "mode            : $MODE"
cd "$ROOT"
case "$MODE" in
  screen)
    if [ -n "$SHARED_STATE" ] && [ -f "$SHARED_STATE" ]; then
      echo "shared synthesis: $SHARED_STATE"
      "$OL" --run-tag "$RUN_TAG" --with-initial-state "$SHARED_STATE" \
        --from OpenROAD.CheckMacroInstances --to OpenROAD.STAMidPNR-3 "$CFG"
    else
      "$OL" --run-tag "$RUN_TAG" --to OpenROAD.STAMidPNR-3 "$CFG"
    fi
    ;;
  signoff)
    "$OL" --run-tag "$RUN_TAG" --from OpenROAD.DetailedRouting "$CFG"
    ;;
  full)
    "$OL" --run-tag "$RUN_TAG" "$CFG"
    ;;
  *)
    echo "unknown mode: $MODE" >&2; exit 2
    ;;
esac

RUN_DIR="$(dirname "$CFG")/runs/$RUN_TAG"
GDS="$(find "$RUN_DIR/final/gds" -name '*.gds' 2>/dev/null | head -1 || true)"
if [ -n "$GDS" ]; then
  LYP="$(find -L "$HOME/.volare/volare/sky130/versions" "$HOME/eda/pdk" -name 'sky130A.lyp' 2>/dev/null | head -1 || true)"
  mkdir -p "$OUT"
  klayout -z -rd gds="$GDS" -rd lyp="${LYP:-}" -rd out="$OUT" -rd name="$(basename "$(dirname "$CFG")")_candidate" -r "$REPO/tools/wsl/render_all_gds.py" || true
fi

echo "run dir: $RUN_DIR"
