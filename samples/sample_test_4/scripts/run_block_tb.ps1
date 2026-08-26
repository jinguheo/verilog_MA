<# Build and run the Sample Test 4 block-level testbenches.

   Block level and integration are separate levels in Sample Test 4 - that is
   the main structural change from Sample Test 3, which had only an integration
   testbench. These are the phase-1 block TBs; they need no UVM.

   The Windows toolchain workarounds below are the same three that Sample Test
   2 and 3 need, and they are still required:
     1. oss-cad-suite ships no GNU Make, and PATH otherwise resolves `make` to
        an unrelated C:\Windows\System32\make.exe, so mingw32-make is shimmed.
     2. The installed MinGW-w64 g++ mis-links std::string's move constructor
        under -Os, which is what Verilator's generated Makefile uses; -O2 is
        forced through MAKEFLAGS.
     3. oss-cad-suite\lib ships older libstdc++/libgcc/libwinpthread DLLs that
        make the built exe fail to load, so the compiler's own bin directory
        goes first on PATH.

   -Mutant <DEFINE> builds the matching file from mutants/ instead of rtl/ and
   inverts the exit status. A mutant that passes means the testbench is not
   actually checking the thing it claims to check, which is a worse result than
   a failure, so it is reported as a failure. Available defects:
     MUT_SKID_READY   ready_o ignores the skid register  -> data loss
     MUT_SKID_BYPASS  skid drain emits the live input    -> reordering
     MUT_SKID_DRAIN   skid clears without being consumed -> dropped beat
     MUT_CNT_WRAP     carry discarded                    -> wraps, never clamps
     MUT_CNT_CLEAR_LOSE   increment beats a same-cycle clear

   Usage:
     powershell -File samples\sample_test_4\scripts\run_block_tb.ps1
     powershell -File samples\sample_test_4\scripts\run_block_tb.ps1 -Only tb_cnt_sat
     powershell -File samples\sample_test_4\scripts\run_block_tb.ps1 -Mutant MUT_SKID_ORDER
#>
[CmdletBinding()]
param(
    [string[]]$Only,
    [int]$Jobs = 4,
    [int]$Seed = 0,
    [ValidateSet('MUT_SKID_READY','MUT_SKID_BYPASS','MUT_SKID_DRAIN','MUT_CNT_WRAP','MUT_CNT_CLEAR_LOSE',
                 'MUT_AXIL_WPRIO','MUT_AXIL_NODECERR','MUT_CSR_IRQNOHW','MUT_CSR_NODECERR','MUT_CSR_GOALL',
                 'MUT_ALIGN_NOEOP','MUT_ALIGN_SOPFROZEN','MUT_ALIGN_NOCRC',
                 'MUT_CHECK_WRONGIDX','MUT_CHECK_NOSOPRESET','MUT_CHECK_NOLENERR',
                 'MUT_CTRL_NODRAIN','MUT_CTRL_NOABORT','MUT_CTRL_BUSYWRONG')]
    [string]$Mutant
)
$ErrorActionPreference = 'Stop'

$daqRoot   = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent (Split-Path -Parent $daqRoot)
$toolRoot  = Join-Path $workspace 'oss-cad-suite'

if (-not $env:OT_PRIM_ROOT)         { $env:OT_PRIM_ROOT         = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl' }
if (-not $env:OT_PRIM_GENERIC_ROOT) { $env:OT_PRIM_GENERIC_ROOT = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim_generic\rtl' }
$env:DAQ_ROOT = $daqRoot -replace '\\', '/'

$env:MAKEFLAGS = 'OPT_GLOBAL=-O2 OPT_FAST=-O2 OPT_SLOW=-O2'
$gcc    = (Get-Command g++.exe -ErrorAction Stop).Source
$gccBin = Split-Path $gcc -Parent
$shim    = Join-Path $env:TEMP 'veriolg-make-shim'
$shimExe = Join-Path $shim 'make.exe'
if (-not (Test-Path $shimExe)) {
    New-Item -ItemType Directory -Force $shim | Out-Null
    Copy-Item (Get-Command mingw32-make.exe -ErrorAction Stop).Source $shimExe
}
$env:PATH = "$shim;$gccBin;$toolRoot\bin;$toolRoot\lib;$env:PATH"
$gitUnix = 'C:\Program Files\Git\usr\bin'
if (Test-Path "$gitUnix\sh.exe") { $env:PATH = "$gitUnix;$env:PATH"; $env:SHELL = "$gitUnix\sh.exe" }

# Fourth Windows toolchain bug, on top of the three Sample Test 2 documented.
# VERILATOR_ROOT is pasted verbatim into the generated Makefile, and one recipe
# there (verilator_includer) runs through sh.exe, which eats the backslashes:
# "D:\MyWork\Veriolg_MA\..." arrives as "MyWorkVeriolg_MA...", and the build
# dies with a confusing "can't open file" from python3. Forward slashes survive
# both make and sh, and Verilator accepts them on Windows.
$toolRootFwd = $toolRoot -replace '\\', '/'
$env:VERILATOR_ROOT = "$toolRootFwd/share/verilator"

# Which module each defect mutates, and therefore which testbench is the one
# expected to kill it.
$mutantOwner = @{
    'MUT_SKID_READY'     = 'skid_buffer'
    'MUT_SKID_BYPASS'    = 'skid_buffer'
    'MUT_SKID_DRAIN'     = 'skid_buffer'
    'MUT_CNT_WRAP'       = 'cnt_sat'
    'MUT_CNT_CLEAR_LOSE' = 'cnt_sat'
    'MUT_AXIL_WPRIO'     = 'axil_slave'
    'MUT_AXIL_NODECERR'  = 'axil_slave'
    'MUT_CSR_IRQNOHW'    = 'daq_csr'
    'MUT_CSR_NODECERR'   = 'daq_csr'
    'MUT_CSR_GOALL'      = 'daq_csr'
    'MUT_ALIGN_NOEOP'     = 'pkt_align'
    'MUT_ALIGN_SOPFROZEN' = 'pkt_align'
    'MUT_ALIGN_NOCRC'     = 'pkt_align'
    'MUT_CHECK_WRONGIDX'    = 'pkt_check'
    'MUT_CHECK_NOSOPRESET'  = 'pkt_check'
    'MUT_CHECK_NOLENERR'    = 'pkt_check'
    'MUT_CTRL_NODRAIN'      = 'chan_ctrl'
    'MUT_CTRL_NOABORT'      = 'chan_ctrl'
    'MUT_CTRL_BUSYWRONG'    = 'chan_ctrl'
}

# Each TB's RTL dependencies beyond pkg.f, as paths relative to rtl/. Mutant
# substitution below matches against the leaf name, so this is also the
# lookup mutation uses to find which file to swap out.
$tbModules = @{
    'tb_skid_buffer' = @('common/skid_buffer')
    'tb_cnt_sat'     = @('common/cnt_sat')
    'tb_axil_slave'  = @('csr/axil_slave')
    'tb_daq_csr'     = @('csr/axil_slave', 'csr/daq_csr')
    'tb_pkt_align'   = @('stream/pkt_align', 'common/skid_buffer')
    'tb_pkt_check'   = @('stream/pkt_check')
    'tb_chan_ctrl'   = @('stream/chan_ctrl')
    'tb_chan_top'    = @('stream/pkt_align', 'stream/pkt_check', 'stream/chan_ctrl', 'stream/chan_top', 'common/skid_buffer')
}
# Extra +define+ args a TB needs beyond the sweep default. tb_daq_csr is built
# at NumCh=4 - a value the phase-2 lint sweep already proved elaborates but no
# block TB had exercised at runtime before this.
$tbDefines = @{
    'tb_daq_csr' = @('+define+DAQ_NUM_CH=4')
}

$tbs = @('tb_skid_buffer', 'tb_cnt_sat', 'tb_axil_slave', 'tb_daq_csr', 'tb_pkt_align', 'tb_pkt_check', 'tb_chan_ctrl', 'tb_chan_top')
if ($Mutant) { $tbs = @("tb_$($mutantOwner[$Mutant])") }
if ($Only)   { $tbs = $tbs | Where-Object { $Only -contains $_ } }

$ErrorActionPreference = 'Continue'
$fail = 0
foreach ($tb in $tbs) {
    Write-Host "=== $tb$(if ($Mutant) { " [$Mutant]" }) ===" -ForegroundColor Cyan

    # Golden builds take every module the TB depends on. Mutant builds take
    # the same set with exactly one module swapped for its mutants/ copy, so
    # exactly one thing differs from the golden build.
    $srcArgs = @('-f', "$env:DAQ_ROOT/filelist/pkg.f")
    if ($Mutant) {
        $mutated = $mutantOwner[$Mutant]
        foreach ($m in $tbModules[$tb]) {
            $leaf = Split-Path $m -Leaf
            $srcArgs += if ($leaf -eq $mutated) { "$env:DAQ_ROOT/mutants/${leaf}_MUTANT.sv" }
                        else                    { "$env:DAQ_ROOT/rtl/$m.sv" }
        }
        $srcArgs += "+define+$Mutant"
    } else {
        foreach ($m in $tbModules[$tb]) { $srcArgs += "$env:DAQ_ROOT/rtl/$m.sv" }
    }
    if ($tbDefines.ContainsKey($tb)) { $srcArgs += $tbDefines[$tb] }

    $out = if ($Mutant) { "$env:DAQ_ROOT/obj_${tb}_$Mutant" } else { "$env:DAQ_ROOT/obj_$tb" }
    & "$toolRoot\bin\verilator_bin.exe" --binary --timing -Wall `
        "$env:DAQ_ROOT/filelist/waivers.vlt" `
        @srcArgs `
        "$env:DAQ_ROOT/tb/$tb.sv" `
        --top-module $tb --Mdir $out -j $Jobs
    if ($LASTEXITCODE -ne 0) { $fail++; Write-Host "$tb BUILD FAILED" -ForegroundColor Red; continue }

    $runArgs = @()
    if ($Seed -ne 0) { $runArgs += "+verilator+seed+$Seed" }
    & "$out\V$tb.exe" @runArgs
    $rc = $LASTEXITCODE

    if ($Mutant) {
        if ($rc -eq 0) {
            $fail++
            Write-Host "$tb PASSED on mutant RTL ($Mutant) - the testbench does not check this" -ForegroundColor Red
        } else {
            Write-Host "$tb killed the mutant $Mutant as expected (rc=$rc)" -ForegroundColor Green
        }
    } else {
        if ($rc -ne 0) { $fail++; Write-Host "$tb FAILED" -ForegroundColor Red }
        else { Write-Host "$tb passed" -ForegroundColor Green }
    }
}

Write-Host ""
if ($fail -ne 0) {
    Write-Host "$fail block testbench run(s) did not give the expected result" -ForegroundColor Red
    exit 1
}
if ($Mutant) { Write-Host "mutant $Mutant was killed" -ForegroundColor Green }
else         { Write-Host "all block testbenches passed" -ForegroundColor Green }
exit 0
