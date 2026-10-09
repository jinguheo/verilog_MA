#! /bin/bash

echo ${PDK_ROOT:=/usr/share/pdk} > /dev/null
echo ${PDK:=sky130A} > /dev/null

magic -dnull -noconsole -rcfile \$PDK_ROOT/\$PDK/libs.tech/magic/sky130A.magicrc << EOF
#load sky130_ef_ip__analog_switches
load minimal_n_switch_ena1v8
select top cell
extract path extfiles
extract all
ext2spice lvs
ext2spice -p extfiles -o ../netlist/layout/minimal_n_switch_ena1v8.spice
quit -noprompt
EOF
rm -r extfiles
exit 0

