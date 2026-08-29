# Summarise the completed OpenLane run for sample_test_4/chan_ctrl.
#
#   powershell -File tools\wsl\60_asic_metrics.ps1
#
# The run directory holds one metrics JSON per step; the interesting numbers are
# spread across floorplan (area), the post-PnR STA step (timing), and the DRC /
# antenna checkers.
param(
  [string]$Run = 'D:\MyWork\Veriolg_MA\samples\sample_test_4\asic\chan_ctrl\runs\RUN_2026-08-26_13-14-47'
)

function Show-Metrics($file, $patterns, $label) {
  if (-not (Test-Path $file)) { return }
  $j = Get-Content $file -Raw | ConvertFrom-Json
  $hit = $false
  foreach ($p in $j.PSObject.Properties) {
    foreach ($pat in $patterns) {
      if ($p.Name -like $pat) {
        if (-not $hit) { Write-Output "`n--- $label ---"; $hit = $true }
        '{0,-52} {1}' -f $p.Name, $p.Value
        break
      }
    }
  }
}

# The last step's metrics file accumulates everything OpenLane recorded.
$last = Get-ChildItem $Run -Recurse -Filter 'or_metrics_out.json' -EA SilentlyContinue |
        Sort-Object FullName | Select-Object -Last 1
$state = Get-ChildItem $Run -Recurse -Filter 'state_out.json' -EA SilentlyContinue |
         Sort-Object FullName | Select-Object -Last 1

Write-Output "=== RUN: $(Split-Path $Run -Leaf) ==="

$final = Join-Path $Run 'final\metrics.json'
if (Test-Path $final) {
  $m = Get-Content $final -Raw | ConvertFrom-Json
  Show-Metrics $final @('*area*','*util*','*cell*count*','*instance*') 'AREA / CELLS'
  Show-Metrics $final @('*wns*','*tns*','*slack*','*hold*','*setup*') 'TIMING'
  Show-Metrics $final @('*power*','*ir_drop*') 'POWER / IR'
  Show-Metrics $final @('*drc*','*antenna*','*violation*','*xor*','*lvs*') 'PHYSICAL CHECKS'
  Show-Metrics $final @('*wirelength*','*route*') 'ROUTING'
} else {
  Write-Output "final\metrics.json not present; scanning step metrics instead"
  if ($last) { Write-Output "last step metrics: $($last.FullName)" }
}
