<# Builds and runs the Sample Test 2 UVM regression with the bundled OSS CAD suite. #>
[CmdletBinding()]
param(
    [switch]$LintOnly,
    [int]$Jobs = 4,
    [string]$OutDirName = 'obj_uvm',
    # Checker-sanity demo: swap in mutants/prim_fifo_sync_cnt_MUTANT_full_stuck_low.sv
    # (full_o stuck at 0, so the FIFO silently overflows) in place of the real
    # prim_fifo_sync_cnt.sv, everything else unchanged. Expected outcome is
    # UVM_ERROR > 0 (REQ-FIFO-002 / REQ-FIFO-005), proving the checks actually
    # catch a broken DUT rather than always passing vacuously.
    [switch]$Mutant
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent (Split-Path -Parent (Split-Path $PSScriptRoot))
$toolRoot = Join-Path $workspace 'oss-cad-suite'
$rtl = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl'
$uvm = Join-Path $workspace 'third_party\uvm-core\src'
if ($Mutant -and $OutDirName -eq 'obj_uvm') { $OutDirName = 'obj_uvm_mutant' }
$out = Join-Path (Split-Path $PSScriptRoot) $OutDirName
$cntFile = if ($Mutant) { Join-Path (Split-Path $PSScriptRoot) 'mutants\prim_fifo_sync_cnt_MUTANT_full_stuck_low.sv' } else { "$rtl\prim_fifo_sync_cnt.sv" }
if ($Mutant) { Write-Host "MUTANT MODE: using $cntFile in place of the real prim_fifo_sync_cnt.sv - expect UVM_ERROR > 0." -ForegroundColor Yellow }

# This machine's installed MinGW-w64 g++ 16.1.0 mis-links std::string's move
# constructor (undefined reference) specifically under -Os. Verilator's generated
# Makefile compiles its runtime + generated classes with -Os by default via the
# OPT_GLOBAL/OPT_FAST/OPT_SLOW make variables. Force -O2 instead through MAKEFLAGS
# so the override reaches every object make compiles, including nested invocations.
$env:MAKEFLAGS = 'OPT_GLOBAL=-O2 OPT_FAST=-O2 OPT_SLOW=-O2'

if (-not (Test-Path "$toolRoot\bin\verilator_bin.exe")) { throw "Bundled Verilator is missing: $toolRoot" }
if (-not (Test-Path "$rtl\prim_fifo_sync.sv")) { throw "OpenTitan prim RTL source is missing: $rtl" }

# oss-cad-suite does not bundle GNU Make. Without this, PATH resolves "make" to an
# unrelated legacy C:\Windows\System32\make.exe, which cannot parse Verilator's
# generated Makefiles ("0 was unexpected at this time."). Shim a real GNU Make
# (mingw32-make, already on this machine) in ahead of it via a %TEMP% copy so
# nothing in the repo or in oss-cad-suite needs to change.
$makeShimDir = Join-Path $env:TEMP 'veriolg-make-shim'
$makeShimExe = Join-Path $makeShimDir 'make.exe'
if (-not (Test-Path $makeShimExe)) {
    $gnuMake = Get-Command mingw32-make.exe -ErrorAction SilentlyContinue
    if (-not $gnuMake) { throw "GNU Make (mingw32-make.exe) not found on PATH; required to drive Verilator's generated Makefile." }
    New-Item -ItemType Directory -Force -Path $makeShimDir | Out-Null
    Copy-Item $gnuMake.Source $makeShimExe -Force
}

# oss-cad-suite\lib ships its own (older) libstdc++-6.dll / libgcc_s_seh-1.dll /
# libwinpthread-1.dll. If those shadow the mingw64 runtime that actually compiled
# Vprim_fifo_sync_uvm_tb.exe, the binary fails at load time with
# STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139). Put the compiler's own bin dir first
# so its matching runtime DLLs win DLL search order for both build and run.
$gccCmd = Get-Command g++.exe -ErrorAction SilentlyContinue
if (-not $gccCmd) { throw "g++.exe not found on PATH; required to link Verilator's generated C++." }
$gccBin = Split-Path $gccCmd.Source -Parent

$env:PATH = "$makeShimDir;$gccBin;$toolRoot\bin;$toolRoot\lib;$env:PATH"
$env:VERILATOR_ROOT = "$toolRoot\share\verilator"
$gitUnix = 'C:\Program Files\Git\usr\bin'
if (Test-Path "$gitUnix\sh.exe") {
    $env:PATH = "$gitUnix;$env:PATH"
    $env:SHELL = "$gitUnix\sh.exe"
}

$files = @(
    "$uvm\uvm_pkg.sv", "$PSScriptRoot\prim_fifo_sync_if.sv", "$PSScriptRoot\prim_fifo_sync_uvm_pkg.sv",
    "$rtl\prim_util_pkg.sv", "$rtl\prim_count_pkg.sv", "$rtl\prim_count.sv", $cntFile,
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
