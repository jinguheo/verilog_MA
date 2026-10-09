#!/usr/bin/env bash
# usage: run_tcl.sh <mag dir> <tcl file>
export PDK_ROOT=/home/oem/eda/pdk PDK=sky130A
cd "$1"
/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin/magic -dnull -noconsole -rcfile $PDK_ROOT/sky130A/libs.tech/magic/sky130A.magicrc "$2" < /dev/null 2>&1 | tail -3
