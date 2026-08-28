<# Sample Test 4 build gate: lint + elaborate every phase-1 top across the
   parameter sweep.

   The sweep is the gate, not an afterthought. A module that only elaborates at
   NumCh=8 / AxiDw=64 is not parameterised, it just has defaults that happen to
   work, and that is exactly the failure this script exists to catch.

   Usage:
     powershell -File samples\sample_test_4\scripts\run_lint.ps1
     powershell -File samples\sample_test_4\scripts\run_lint.ps1 -Only skid_buffer
     powershell -File samples\sample_test_4\scripts\run_lint.ps1 -NumCh 8 -AxiDw 64
#>
[CmdletBinding()]
param(
    [string[]]$Only,
    [int[]]$NumCh = @(1, 2, 8),
    [int[]]$AxiDw = @(32, 64)
)
$ErrorActionPreference = 'Stop'

$daqRoot   = Split-Path -Parent $PSScriptRoot

$workspace = Split-Path -Parent (Split-Path -Parent $daqRoot)
$toolRoot  = Join-Path $workspace 'oss-cad-suite'

# The OpenTitan prim tree lives outside this repository. Sample Test 2 hardcodes
# the same path in its build scripts; here it is settable so a different corpus
# location does not require editing the file lists.
if (-not $env:OT_PRIM_ROOT)         { $env:OT_PRIM_ROOT         = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl' }
if (-not $env:OT_PRIM_GENERIC_ROOT) { $env:OT_PRIM_GENERIC_ROOT = 'D:\MyWork\verilog\dbs\opentitan\hw\ip\prim_generic\rtl' }
$env:DAQ_ROOT = $daqRoot -replace '\\', '/'

if (-not (Test-Path "$env:OT_PRIM_ROOT\prim_fifo_sync.sv")) {
    throw "OpenTitan prim RTL is missing: $env:OT_PRIM_ROOT (set OT_PRIM_ROOT to override)"
}
if (-not (Test-Path "$env:OT_PRIM_GENERIC_ROOT\prim_flop_2sync.sv")) {
    throw "OpenTitan prim_generic RTL is missing: $env:OT_PRIM_GENERIC_ROOT"
}

$env:PATH = "$toolRoot\bin;$toolRoot\lib;$env:PATH"
$env:VERILATOR_ROOT = "$toolRoot\share\verilator"
$verilator = "$toolRoot\bin\verilator_bin.exe"

# prim_reuse_smoke is listed last within phase 1 because it is the
# integration check: it fails if the prim mapping in filelist/prim.f has
# drifted. axil_slave/daq_csr only depend on AxilAw/AxilDw, which are fixed
# regardless of the AXI_DW sweep value, but they still elaborate under it
# every iteration - a no-op re-run rather than a gap in the gate.
$tops = @(
    @{ name = 'skid_buffer';      files = @("$daqRoot\filelist\rtl_phase1.f") }
    @{ name = 'cnt_sat';          files = @("$daqRoot\filelist\rtl_phase1.f") }
    @{ name = 'prim_reuse_smoke'; files = @("$daqRoot\filelist\rtl_phase1.f", "$daqRoot\tb\prim_reuse_smoke.sv") }
    @{ name = 'axil_slave';       files = @("$daqRoot\filelist\rtl_phase2.f") }
    @{ name = 'daq_csr';          files = @("$daqRoot\filelist\rtl_phase2.f") }
    @{ name = 'pkt_align';        files = @("$daqRoot\filelist\rtl_phase3.f") }
    @{ name = 'pkt_check';        files = @("$daqRoot\filelist\rtl_phase3.f") }
    @{ name = 'chan_ctrl';        files = @("$daqRoot\filelist\rtl_phase3.f") }
    @{ name = 'chan_top';         files = @("$daqRoot\filelist\rtl_phase3.f") }
    @{ name = 'dma_sched';        files = @("$daqRoot\filelist\rtl_phase4.f") }
    @{ name = 'desc_fetch';       files = @("$daqRoot\filelist\rtl_phase4.f") }
    @{ name = 'axi_rd_master';    files = @("$daqRoot\filelist\rtl_phase4.f") }
    @{ name = 'axi_wr_master';    files = @("$daqRoot\filelist\rtl_phase4.f") }
    @{ name = 'wr_track';         files = @("$daqRoot\filelist\rtl_phase4.f") }
    @{ name = 'irq_ctrl';         files = @("$daqRoot\filelist\rtl_phase5.f") }
    @{ name = 'perf_cnt';         files = @("$daqRoot\filelist\rtl_phase5.f") }
    @{ name = 'daq_subsystem';    files = @("$daqRoot\filelist\rtl_phase5.f") }
)
if ($Only) { $tops = $tops | Where-Object { $Only -contains $_.name } }

$fail = 0
$runs = 0
# Verilator writes its diagnostics to stderr. Under Windows PowerShell 5.1 a
# native command's stderr arrives as ErrorRecords, which would trip
# ErrorActionPreference='Stop' on a mere warning, so exit status is checked
# explicitly instead from here on.
$ErrorActionPreference = 'Continue'
foreach ($ch in $NumCh) {
    foreach ($dw in $AxiDw) {
        foreach ($t in $tops) {
            $runs++
            $label = "{0,-18} NumCh={1} AxiDw={2}" -f $t.name, $ch, $dw
            $args = @(
                '--lint-only', '-Wall',
                "+define+DAQ_NUM_CH=$ch", "+define+DAQ_AXI_DW=$dw",
                '--top-module', $t.name,
                "$daqRoot\filelist\waivers.vlt"
            )
            foreach ($f in $t.files) {
                if ($f -like '*.f') { $args += @('-f', $f) } else { $args += $f }
            }
            $out = & $verilator @args 2>&1 | ForEach-Object { $_.ToString() }
            if ($LASTEXITCODE -ne 0) {
                $fail++
                Write-Host "FAIL  $label" -ForegroundColor Red
                $out | ForEach-Object { "      $_" } | Write-Host
            } else {
                Write-Host "pass  $label" -ForegroundColor Green
                if ($out) { $out | ForEach-Object { "      $_" } | Write-Host -ForegroundColor Yellow }
            }
        }
    }
}

Write-Host ""
if ($fail -ne 0) {
    Write-Host "$fail of $runs configurations FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "all $runs configurations clean" -ForegroundColor Green
exit 0
