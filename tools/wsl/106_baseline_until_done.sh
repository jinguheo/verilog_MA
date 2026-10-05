#!/usr/bin/env bash
# Watchdog: keep resuming the grid-baseline hierarchical daq_subsystem run
# until final/metrics.json exists. WSL/host regularly kills long OpenLane runs
# silently (no OpenLane error, no "OpenLane will now quit"), so a vanished
# process with no clean error is relaunched from the step it died in. A CLEAN
# OpenLane failure (flow.log has "OpenLane will now quit" after the latest
# launch) is a real result and is NOT retried - the watchdog stops and says so.
#
#   bash tools/wsl/121_launch_ppa3_detached.sh 106_baseline_until_done.sh
set -uo pipefail

REPO=/mnt/d/MyWork/Veriolg_MA
ROOT=/mnt/d/MyWork
CFG="$REPO/samples/sample_test_4/asic/daq_subsystem/config_hierarchical.json"
OL="$HOME/.venvs/openlane312/bin/openlane"
RUN_TAG="hierarchical_auto_20260924_142552"
RUN="$REPO/samples/sample_test_4/asic/daq_subsystem/runs/$RUN_TAG"
LOG="$REPO/tools/wsl/logs/106_baseline_watchdog.log"
MAX_RELAUNCH=20
mkdir -p "$(dirname "$LOG")"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

export PATH="$HOME/.cache/openlane-tools-daq-base/bin:$PATH"
alive() { pgrep -f "openlane .*--run-tag $RUN_TAG" > /dev/null; }
last_step_id() { grep -o "Running '[A-Za-z0-9_.-]*' at" "$RUN/flow.log" | tail -1 | sed "s/Running '\(.*\)' at/\1/"; }

relaunches=0
log "watchdog start (run $RUN_TAG)"
sleep 20
while true; do
  if [ -f "$RUN/final/metrics.json" ]; then log "SUCCESS: final/metrics.json exists"; exit 0; fi

  if alive; then sleep 60; continue; fi

  # process is gone and no final result: real failure or silent death?
  sleep 5
  if [ -f "$RUN/final/metrics.json" ]; then log "SUCCESS: final/metrics.json exists"; exit 0; fi
  if tail -n 40 "$RUN/flow.log" | grep -q "OpenLane will now quit"; then
    log "CLEAN FAILURE (not retrying):"; tail -n 12 "$RUN/flow.log" | cut -c1-200 | tee -a "$LOG"
    exit 2
  fi
  if [ "$relaunches" -ge "$MAX_RELAUNCH" ]; then log "gave up after $relaunches relaunches"; exit 3; fi

  step="$(last_step_id)"
  [ -n "$step" ] || step="Magic.DRC"
  relaunches=$((relaunches + 1))
  log "process vanished without a clean error - relaunch #$relaunches from $step"
  ( cd "$ROOT" && "$OL" --run-tag "$RUN_TAG" --from "$step" "$CFG" >> "$LOG" 2>&1 ) &
  sleep 30
done
