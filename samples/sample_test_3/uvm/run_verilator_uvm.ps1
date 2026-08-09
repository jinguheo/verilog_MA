<# Build and execute the Sample Test 3 integration UVM regression.

   -AssertionFailDemo enables the deliberate IRQ-without-cause mutant so
   p_irq_has_cause fails (checker sanity).
   -ClockSweep N re-runs the same binary N extra times with randomized,
   mutually asynchronous clock half-periods (+RANDOM_CLOCKS). Every wait in
   the testbench is a bounded poll on a condition rather than a fixed cycle
   count, so the regression must pass at any ratio; a failure here means a
   real CDC assumption was baked into the design or the tests.
#>
[CmdletBinding()] param([int]$Jobs=4,[string]$OutDirName='obj_uvm',[switch]$AssertionFailDemo,[int]$ClockSweep=0)
$ErrorActionPreference='Stop'
$workspace=Split-Path -Parent (Split-Path -Parent (Split-Path $PSScriptRoot))
$toolRoot=Join-Path $workspace 'oss-cad-suite'; $uvm=Join-Path $workspace 'third_party\uvm-core\src'; $out=Join-Path (Split-Path $PSScriptRoot) $OutDirName
$env:MAKEFLAGS='OPT_GLOBAL=-O2 OPT_FAST=-O2 OPT_SLOW=-O2'
$gcc=(Get-Command g++.exe -ErrorAction Stop).Source; $gccBin=Split-Path $gcc -Parent
$shim=Join-Path $env:TEMP 'veriolg-make-shim'; $shimExe=Join-Path $shim 'make.exe'; if(!(Test-Path $shimExe)){New-Item -ItemType Directory -Force $shim|Out-Null; Copy-Item (Get-Command mingw32-make.exe -ErrorAction Stop).Source $shimExe}
$env:PATH="$shim;$gccBin;$toolRoot\bin;$toolRoot\lib;$env:PATH"; $env:VERILATOR_ROOT="$toolRoot\share\verilator"
$gitUnix='C:\Program Files\Git\usr\bin'; if(Test-Path "$gitUnix\sh.exe"){$env:PATH="$gitUnix;$env:PATH";$env:SHELL="$gitUnix\sh.exe"}
$files=@("$uvm\uvm_pkg.sv","$PSScriptRoot\..\rtl\daq_if.sv","$PSScriptRoot\daq_uvm_pkg.sv","$PSScriptRoot\..\rtl\daq_top.sv","$PSScriptRoot\daq_uvm_tb.sv")
& "$toolRoot\bin\verilator_bin.exe" --binary --timing -Wno-fatal -Wno-WIDTH +define+UVM_NO_DPI -LDFLAGS -lstdc++ --top-module daq_uvm_tb "-I$uvm" @files --Mdir $out -j $Jobs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}

$exe="$out\Vdaq_uvm_tb.exe"
$runArgs=@('+UVM_NO_RELNOTES'); if($AssertionFailDemo){$runArgs+='+ASSERT_FAIL_DEMO'}
& $exe @runArgs
$failed = if($LASTEXITCODE -ne 0){1}else{0}

if($ClockSweep -gt 0 -and -not $AssertionFailDemo){
    Write-Host "`n=== Clock-ratio sweep: $ClockSweep randomized runs ===" -ForegroundColor Cyan
    for($i=1;$i -le $ClockSweep;$i++){
        # +verilator+seed+N re-seeds $urandom, so each run picks a different
        # ctrl/src/dma half-period triple.
        Write-Host "--- sweep run $i ---"
        & $exe '+UVM_NO_RELNOTES' '+RANDOM_CLOCKS' "+verilator+seed+$($i*7919)"
        if($LASTEXITCODE -ne 0){$failed++; Write-Host "sweep run $i FAILED" -ForegroundColor Red}
    }
    if($failed -eq 0){Write-Host "clock-ratio sweep: all $ClockSweep runs passed" -ForegroundColor Green}
}
if($failed -ne 0){exit 1}
exit 0
