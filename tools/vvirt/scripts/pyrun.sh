#!/usr/bin/env bash
# run a python script with the real virtuoso-bridge client importable (usage: pyrun.sh script.py args...)
ROOT=/mnt/d/MyWork/Veriolg_MA/tools
export PYTHONPATH="$ROOT/vvirt/vendor:$ROOT/virtuoso-bridge-lite/src:$ROOT/vvirt/src${PYTHONPATH:+:$PYTHONPATH}"
exec python3 "$@"
