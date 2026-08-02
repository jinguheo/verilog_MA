$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$rtl = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl'
if (-not (Get-Command vlog -ErrorAction SilentlyContinue)) { throw 'Questa/ModelSim vlog command is required for full UVM execution.' }
vlib work
vlog +incdir+$root\third_party\uvm-core\src $root\third_party\uvm-core\src\uvm_pkg.sv
vlog +incdir+$root\third_party\uvm-core\src $PSScriptRoot\prim_fifo_sync_if.sv $PSScriptRoot\prim_fifo_sync_uvm_pkg.sv
vlog $rtl\prim_count_pkg.sv $rtl\prim_util_pkg.sv $rtl\prim_fifo_sync_cnt.sv $rtl\prim_fifo_sync.sv $PSScriptRoot\prim_fifo_sync_uvm_tb.sv
vsim -c prim_fifo_sync_uvm_tb -do 'run -all; quit -f'
