#!/usr/bin/env bash
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
export GDS=${1:-$ROOT/workspace/_out/layout_demo_20261013_215243.gds}
klayout -b -r $ROOT/scripts/kl_check.py 2>&1 | head -40
