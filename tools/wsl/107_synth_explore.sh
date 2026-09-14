#!/usr/bin/env bash
# Run OpenLane's built-in SynthesisExploration flow on one Sample Test 4
# design - tries all 9 yosys/ABC strategies (AREA 0-3, DELAY 0-4) in
# parallel and prints a comparison table (gates, area, worst setup slack,
# TNS per strategy), so SYNTH_STRATEGY can be picked with evidence instead
# of left at the flow's own default.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/107_synth_explore.sh chan_ctrl
#
# Same working-directory/PATH handling as 80_run_openlane.sh (see its own
# header for why) - this script only adds `-f SynthesisExploration` to the
# invocation and writes output to a separate summary file per design, since
# SynthesisExploration's own run directory naming does not include the
# design name.
#
# Scope: this flow only runs Yosys.Synthesis + OpenROAD.CheckSDCFiles +
# OpenROAD.STAPrePNR per strategy - pre-placement, no real wire delay. It
# tells you which strategy synthesizes smaller/faster on paper, not what
# the routed result will look like; still worth doing before committing to
# a full P&R with the default strategy no one has actually compared here.
#
# Parallel-safe by construction: the shim lives at a PER-DESIGN path
# ($HOME/.cache/openlane-tools-<design>/bin), not the single shared
# $HOME/.cache/openlane-tools/bin path 80_run_openlane.sh/87_run_chan_top.sh
# use - and it is built once and left alone on repeat runs (checked for the
# `openlane` symlink rather than unconditionally `rm -rf`'d), not rebuilt
# from scratch every invocation. Two earlier races already happened from
# scripts fighting over one shared shim path (a live peer session's chan_top
# re-estimate, and this project's own daq_subsystem run needing its own
# "openlane-tools-daq" name to avoid the same thing) - this script runs
# multiple designs concurrently by design (see 108_synth_explore_compare.sh),
# so it cannot reuse that shared-path pattern at all.
set -euo pipefail

DESIGN="${1:-chan_ctrl}"
REPO=/mnt/d/MyWork/Veriolg_MA
SAMPLE="$REPO/samples/sample_test_4"
CFG="$SAMPLE/asic/$DESIGN/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
OUT="$SAMPLE/asic/$DESIGN/synth_explore_summary.txt"

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
echo "flow   : SynthesisExploration"
echo "config : $CFG"
"$OL" --version
echo

cd "$SAMPLE"
"$OL" --flow SynthesisExploration "asic/$DESIGN/config.json" 2>&1 | tee "$OUT"

echo
echo "=== summary written to $OUT ==="
RUN="$(find "$SAMPLE/asic/$DESIGN/runs" -maxdepth 1 -type d -name 'RUN_*' | sort | tail -1)"
echo "run dir: $RUN"
[ -f "$RUN/summary.rpt" ] && cat "$RUN/summary.rpt"
