#!/bin/bash

echo ${PDK_ROOT:=/usr/share/pdk} > /dev/null
echo ${PDK:=sky130A} > /dev/null

netgen -batch source run_lvs_minimal.tcl | tee netgen_minimal.log
netgen -batch source run_lvs_simplest.tcl | tee netgen_simplest.log
netgen -batch source run_lvs_simple.tcl | tee netgen_simple.log
netgen -batch source run_lvs_isolated.tcl | tee netgen_isolated.log
netgen -batch source run_lvs_large.tcl | tee netgen_large.log
netgen -batch source run_lvs_xlarge.tcl | tee netgen_xlarge.log
netgen -batch source run_lvs_mux.tcl | tee netgen_mux.log
