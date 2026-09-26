#!/usr/bin/env bash
# Hierarchical daq_subsystem run - chan_top treated as a pre-hardened MACRO
# (RUN_2026-09-23_12-48-47, fully signoff-clean) instead of being
# re-synthesized 8x. See asic/daq_subsystem/config_hierarchical.json's own
# "//" block for the full rationale and what was verified before writing it
# (OpenLane's get_macro_views_by_priority auto-blackboxes MACROS entries at
# synthesis - confirmed by reading openlane/steps/yosys.py directly).
#
# First pass: instance locations left unset ("automatic placement") so
# OpenLane's own placer positions the 8 macros - this validates the
# blackbox+macro mechanism end-to-end before layering ParSAC's
# constraint-based placement on top in a follow-up run.
#
# Uses its OWN shim (openlane-tools-daq-hier) - NOT openlane-tools-daq,
# which 100/102's flat-track scripts use and may have a live run using
# right now. Reusing that shim while it's live would race (rm -rf vs. a
# live process resolving symlinks through it) - already a documented bug
# in this project, see 107_synth_explore.sh's own history.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
RUN_TAG="hierarchical_auto_$(date +%Y%m%d_%H%M%S)"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

SHIM="$HOME/.cache/openlane-tools-daq-hier/bin"
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

echo "config   : $CFG"
echo "run-tag  : $RUN_TAG"
echo "macro    : chan_top (RUN_2026-09-23_12-48-47) x8, auto-placed"
echo

cd "$ROOT"
"$OL" --run-tag "$RUN_TAG" "$CFG"

echo
echo "=== run dir ==="
echo "$REPO/samples/sample_test_4/asic/daq_subsystem/runs/$RUN_TAG"
