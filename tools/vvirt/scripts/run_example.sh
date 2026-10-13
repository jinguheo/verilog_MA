#!/usr/bin/env bash
ROOT=/mnt/d/MyWork/Veriolg_MA/tools
cd "$ROOT/virtuoso-bridge-lite/examples/01_virtuoso/layout" || exit 1
exec bash "$ROOT/vvirt/scripts/pyrun.sh" "$@"
