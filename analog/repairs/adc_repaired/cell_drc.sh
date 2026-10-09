#!/usr/bin/env bash
# usage: cell_drc.sh <mag dir> <cell>
set -uo pipefail
export PDK_ROOT=/home/oem/eda/pdk PDK=sky130A
MAGIC=/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin/magic
cd "$1"
cat > /tmp/celldrc_$$.tcl <<TCL
drc on
catch {drc style drc(full)}
load $2 -quiet
select top cell
drc check
drc catchup
puts "ERRCOUNT [drc list count total]"
foreach {msg rects} [drc listall why] {
  puts "WHY: \$msg"
  foreach r \$rects { puts "RECT: \$r" }
}
quit -noprompt
TCL
"$MAGIC" -dnull -noconsole -rcfile "$PDK_ROOT/sky130A/libs.tech/magic/sky130A.magicrc" /tmp/celldrc_$$.tcl < /dev/null 2>&1 | grep -E "ERRCOUNT|WHY|RECT"
