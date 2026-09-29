#!/usr/bin/env bash
# Resume the Macro Tetris candidate run (104_run_daq_hier_macrotetris.sh) from its
# last completed checkpoint instead of redoing stages 1-35 (~33min saved per the
# grid baseline's own timing) - the previous attempt (run-tag
# macrotetris_20260925_203844) died mid-stage-36 when the host slept overnight,
# but stage 35 (OpenROAD.STAMidPNR-1) completed cleanly and has a valid
# state_out.json, so OpenLane's own --run-tag/--from checkpoint mechanism
# (Flow.start, overwrite=False) can pick up from there.
set -euo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
RUN_TAG="macrotetris_20260925_203844"
OL="$HOME/.venvs/openlane312/bin/openlane"
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical_macrotetris.json"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

SHIM="$HOME/.cache/openlane-tools-daq-mt/bin"
export PATH="$SHIM:$PATH"

echo "config   : $CFG"
echo "run-tag  : $RUN_TAG (resume)"
echo "from     : OpenROAD.ResizerTimingPostCTS"
echo "stop at  : OpenROAD.STAPostPNR"
echo

cd "$ROOT"
"$OL" --run-tag "$RUN_TAG" --from OpenROAD.ResizerTimingPostCTS --to OpenROAD.STAPostPNR "$CFG"

echo
echo "=== run dir ==="
echo "$REPO/samples/sample_test_4/asic/daq_subsystem/runs/$RUN_TAG"
