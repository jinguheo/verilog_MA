<# Builds and runs the Sample Test 2 UVM regression with the bundled OSS CAD suite. #>
[CmdletBinding()]
param(
    [switch]$LintOnly,
    [int]$Jobs = 4
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent (Split-Path $PSScriptRoot))
$toolRoot = Join-Path $workspace 'oss-cad-suite'
$rtl = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl'
$uvm = Join-Path $workspace 'third_party\uvm-core\src'
$out = Join-Path (Split-Path $PSScriptRoot) 'obj_uvm'

if (-not (Test-Path "$toolRoot\bin\verilator_bin.exe")) { throw "Bundled Verilator is missing: $toolRoot" }
if (-not (Test-Path "$rtl\prim_fifo_sync.sv")) { throw "OpenTitan prim RTL source is missing: $rtl" }

$env:PATH = "$toolRoot\bin;$toolRoot\lib;$env:PATH"
$env:VERILATOR_ROOT = "$toolRoot\share\verilator"
$gitUnix = 'C:\Program Files\Git\usr\bin'
if (Test-Path "$gitUnix\sh.exe") {
    $env:PATH = "$gitUnix;$env:PATH"
    $env:SHELL = "$gitUnix\sh.exe"
}

$files = @(
    "$uvm\uvm_pkg.sv", "$PSScriptRoot\prim_fifo_sync_if.sv", "$PSScriptRoot\prim_fifo_sync_uvm_pkg.sv",
    "$rtl\prim_util_pkg.sv", "$rtl\prim_count_pkg.sv", "$rtl\prim_count.sv", "$rtl\prim_fifo_sync_cnt.sv",
    "$rtl\prim_fifo_sync.sv", "$PSScriptRoot\prim_fifo_sync_uvm_tb.sv"
)
$args = @('--timing', '-Wno-fatal', '-Wno-WIDTHTRUNC', '-Wno-WIDTHEXPAND', '+define+UVM_NO_DPI', '-LDFLAGS', '-lstdc++', '--top-module', 'prim_fifo_sync_uvm_tb', "-I$rtl", "-I$uvm") + $files

if ($LintOnly) {
    & "$toolRoot\bin\verilator_bin.exe" '--lint-only' @args
    Write-Host 'UVM source lint passed.'
    exit $LASTEXITCODE
}

& "$toolRoot\bin\verilator_bin.exe" '--binary' '-j' $Jobs @args '--Mdir' $out
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$out\Vprim_fifo_sync_uvm_tb.exe" '+UVM_NO_RELNOTES'
