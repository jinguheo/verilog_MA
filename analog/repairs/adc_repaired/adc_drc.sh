#!/usr/bin/env bash
# usage: adc_drc.sh <dir with mag/>
set -uo pipefail
export PDK_ROOT=/home/oem/eda/pdk PDK=sky130A
MAGIC=/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin/magic
cd "$1/mag"
cat > /tmp/adcdrc_$$.tcl <<TCL
drc on
catch {drc style drc(full)}
load sky130_ef_ip__adc3v_12bit -quiet
select top cell
drc check
drc catchup
puts "ERRCOUNT [drc list count total]"
foreach {msg rects} [drc listall why] { puts "WHY: \$msg  (\[llength \$rects\] rects)" }
quit -noprompt
TCL
"$MAGIC" -dnull -noconsole -rcfile "$PDK_ROOT/sky130A/libs.tech/magic/sky130A.magicrc" /tmp/adcdrc_$$.tcl < /dev/null 2>&1 | grep -E "ERRCOUNT|WHY"
