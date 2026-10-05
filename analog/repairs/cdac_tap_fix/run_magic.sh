#!/usr/bin/env bash
# usage: bash run_magic.sh <script.tcl> [out]   (runs Magic on project/mag with sky130A rc; never touches the vendor copy)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PDK_ROOT=/home/oem/eda/pdk PDK=sky130A
MAGIC=/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin/magic
cd "$HERE/project/mag"
export CELL="${CELL:-}"
"$MAGIC" -dnull -noconsole -rcfile "$PDK_ROOT/sky130A/libs.tech/magic/sky130A.magicrc" "$HERE/$1" < /dev/null 2>&1
