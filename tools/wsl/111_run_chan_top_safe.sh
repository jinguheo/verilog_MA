#!/usr/bin/env bash
# Same as 87_run_chan_top.sh (design, working directory, why) but with a
# per-design, idempotent shim ($HOME/.cache/openlane-tools-chan_top/bin)
# instead of 87's shared $HOME/.cache/openlane-tools/bin path that does
# `rm -rf` + rebuild every invocation - see 107_synth_explore.sh's header for
# why that shared path is race-prone. Used here specifically so this run can
# be launched without needing to coordinate over that shared path with
# whatever else might be using it concurrently.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/111_run_chan_top_safe.sh
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/chan_top/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-chan_top/bin"
if [ -L "$SHIM/yosys" ]; then
  echo "shim already built at $SHIM, reusing"
else
  mkdir -p "$SHIM"
  for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
    tool="${spec%%:*}"; pref="${spec#*:}"
    d="$(pick_bin "$tool" "${pref:-.}")" || true
    [ -n "${d:-}" ] && ln -sf "$d/$tool" "$SHIM/$tool"
  done
  ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
fi
export PATH="$SHIM:$PATH"

echo "working dir : $ROOT"
echo "config      : $CFG"
echo "sdc         : samples/sample_test_4/asic/constraints/chan_top.sdc (src=12ns/axi=48ns)"
"$OL" --version
echo

cd "$ROOT"
"$OL" "$CFG"

echo
echo "=== newest run ==="
RUN="$(find "$REPO/samples/sample_test_4/asic/chan_top/runs" -maxdepth 1 -type d -name 'RUN_*' 2>/dev/null | sort | tail -1)"
echo "$RUN"
if [ -f "$RUN/final/metrics.json" ]; then
  echo 'final/metrics.json written'
  grep -e 'design__instance__area' -e 'timing__setup__ws' -e 'timing__setup__tns' "$RUN/final/metrics.json"
else
  echo 'no final metrics - checking signoff step for setup violations report'
  find "$RUN" -maxdepth 1 -iname '*setupviolations*'
fi
