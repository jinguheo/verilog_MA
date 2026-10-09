#!/usr/bin/env bash
# usage: gen_gds.sh <dir with mag/ and ip/> <out.gds>
set -uo pipefail
export PDK_ROOT=/home/oem/eda/pdk PDK=sky130A
MAGIC=/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin/magic
D="$1"; OUT="$2"
cd "$D/mag"
cat > /tmp/gen_$$.tcl <<TCL
drc off
load sky130_ef_ip__adc3v_12bit -quiet
gds write $OUT
quit -noprompt
TCL
"$MAGIC" -dnull -noconsole -rcfile "$PDK_ROOT/sky130A/libs.tech/magic/sky130A.magicrc" /tmp/gen_$$.tcl < /dev/null 2>&1 | tail -3
