<# Run the Sample Test 3 formal proofs.

   All runs happen from samples\sample_test_3, because the [files] paths inside
   the .sby files are relative to it.

   Three proofs on the real RTL, expected to pass:
     daq_status_sync  unbounded k-induction, single-clock abstraction (~1 s)
     daq_fifo         bounded, multiclock / clk2fflogic, depth 40 (~40 s)
     daq_status       bounded, multiclock / clk2fflogic, depth 40 (~8 min)

   Two proofs on the mutant RTL, expected to FAIL. A pass there means the
   corresponding properties are vacuous, which is a worse result than a
   failure - so -Mutant inverts the exit status accordingly.
#>
[CmdletBinding()] param([string[]]$Only, [switch]$Mutant)
$ErrorActionPreference = 'Stop'
$sample = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent (Split-Path -Parent $sample)
$toolRoot = Join-Path $workspace 'oss-cad-suite'
$env:PATH = "$toolRoot\bin;$toolRoot\lib;$env:PATH"

$proofs = if ($Mutant) { @('daq_status_sync_MUTANT', 'daq_fifo_MUTANT') }
          else         { @('daq_status_sync', 'daq_fifo', 'daq_status') }
if ($Only) { $proofs = $proofs | Where-Object { $Only -contains $_ } }

Push-Location $sample
$bad = 0
try {
    foreach ($p in $proofs) {
        Write-Host "=== $p ===" -ForegroundColor Cyan
        & "$toolRoot\bin\sby.exe" -f "formal\$p.sby"
        $rc = $LASTEXITCODE
        if ($Mutant) {
            # rc 0 means the mutant slipped through every property.
            if ($rc -eq 0) { $bad++; Write-Host "$p PASSED on mutant RTL - properties are vacuous" -ForegroundColor Red }
            else { Write-Host "$p failed on mutant RTL as expected (rc=$rc)" -ForegroundColor Green }
        } else {
            if ($rc -ne 0) { $bad++; Write-Host "$p FAILED (rc=$rc)" -ForegroundColor Red }
            else { Write-Host "$p passed" -ForegroundColor Green }
        }
    }
} finally { Pop-Location }
if ($bad -ne 0) { exit 1 }
exit 0
