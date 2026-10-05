#!/usr/bin/env bash
# Fast PDN probe: run PPA3 up to the power-grid check with a config variant and print the unconnected macro pins.
#   bash 127_pdn_probe.sh <variant>      (config_<variant>.json, run tag ppa3_<variant>)
set -uo pipefail
variant="${1:?variant}"
REPO=/mnt/d/MyWork/Veriolg_MA; ROOT=/mnt/d/MyWork
OL="$HOME/.venvs/openlane312/bin/openlane"
export PATH="$HOME/.cache/openlane-tools-chan_top/bin:$PATH"
BASE="$REPO/samples/sample_test_4/asic/ppa3_adc_capture"
TAG="ppa3_${variant}"; LOGS="$REPO/tools/wsl/logs"; mkdir -p "$LOGS"
cd "$ROOT"
"$OL" --run-tag "$TAG" --overwrite --to Checker.PowerGridViolations "$BASE/config_${variant}.json" > "$LOGS/${TAG}.log" 2>&1
echo "exit $?" > "$LOGS/${TAG}.probe"
grep -E "PSM-0039|power grid violations|clear\." "$LOGS/${TAG}.log" | sed 's/^\[[0-9:]*\] //' | cut -c1-150 >> "$LOGS/${TAG}.probe"
