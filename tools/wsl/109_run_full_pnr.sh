#!/usr/bin/env bash
# Run the full default OpenLane 2 flow (not SynthesisExploration) on one
# Sample Test 4 design, to confirm a SYNTH_STRATEGY picked from
# 107_synth_explore.sh's pre-placement comparison actually survives real
# placement/routing (SynthesisExploration only runs synthesis + STAPrePNR -
# no real wire delay, so "smaller/faster on paper" is not proven until this
# runs).
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/109_run_full_pnr.sh chan_ctrl
#
# Same PATH/working-directory handling as 80_run_openlane.sh (see its header
# for the "why" on each shim entry) - the only difference here is the shim
# path: this uses the PER-DESIGN, idempotent-build pattern from
# 107_synth_explore.sh ($HOME/.cache/openlane-tools-<design>/bin, built once
# and reused) instead of 80_run_openlane.sh's single shared
# $HOME/.cache/openlane-tools/bin path that does `rm -rf` + rebuild every
# invocation. That shared path is known to race when another script/session
# touches it concurrently (already hit twice this project); using a
# per-design path here means this script never needs to coordinate over that
# specific resource, even if a peer session is using 80_run_openlane.sh's
# shared shim at the same time on a different design.
set -euo pipefail

DESIGN="${1:-chan_ctrl}"
REPO=/mnt/d/MyWork/Veriolg_MA
SAMPLE="$REPO/samples/sample_test_4"
CFG="$SAMPLE/asic/$DESIGN/config.json"
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

SHIM="$HOME/.cache/openlane-tools-$DESIGN/bin"
if [ -L "$SHIM/yosys" ]; then
  echo "shim already built at $SHIM, reusing (no rm -rf - safe to run concurrently with itself/others)"
else
  mkdir -p "$SHIM"
  for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
    tool="${spec%%:*}"; pref="${spec#*:}"
    d="$(pick_bin "$tool" "${pref:-.}")" || true
    if [ -n "${d:-}" ]; then
      ln -sf "$d/$tool" "$SHIM/$tool"
      printf '%-9s %s\n' "$tool" "$d/$tool"
    else
      printf '%-9s %s\n' "$tool" "(not found in /nix/store - will fall back to PATH)"
    fi
  done
  ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
fi
export PATH="$SHIM:$PATH"

echo
echo "design : $DESIGN"
echo "config : $CFG"
"$OL" --version
echo

cd "$SAMPLE"
"$OL" "asic/$DESIGN/config.json"

echo
echo "=== newest run ==="
RUN="$(find "$SAMPLE/asic/$DESIGN/runs" -maxdepth 1 -type d -name 'RUN_*' | sort | tail -1)"
echo "$RUN"
if [ -f "$RUN/final/metrics.json" ]; then
  echo 'final/metrics.json written'
  grep -E '"(design__instance__area|clock__skew|timing__setup__ws|timing__setup__tns)"' "$RUN/final/metrics.json" || true
else
  echo 'no final metrics'
fi
