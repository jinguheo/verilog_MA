#! /bin/bash

echo ${PDK_ROOT:=/usr/share/pdk} > /dev/null
echo ${PDK:=sky130A} > /dev/null

magic -dnull -noconsole -rcfile \$PDK_ROOT/\$PDK/libs.tech/magic/\$PDK.magicrc << EOF
load isolated_switch_xlarge
select top cell
extract path extfiles
extract all
ext2spice lvs
ext2spice -p extfiles -o ../netlist/layout/isolated_switch_xlarge.spice
quit -noprompt
EOF
rm -r extfiles
exit 0

