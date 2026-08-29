#!/usr/bin/env bash
set -uo pipefail
F=/nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta/sdc/Sdc.tcl
sed -n '2430,2500p' "$F"
