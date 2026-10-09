#!/bin/bash

export NETGEN_COLUMNS=50

project=sky130_ef_ip__adc3v_12bit

echo ${PDK_ROOT:=/usr/share/pdk} > /dev/null
echo ${PDK:=sky130A} > /dev/null

netgen -batch source $project.tcl | tee netgen_$project.log
