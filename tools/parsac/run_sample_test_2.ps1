[CmdletBinding()]
param(
  [ValidateRange(10, 1000000)][int]$Steps = 2000,
  [ValidateRange(1, 64)][int]$Runs = 8,
  [ValidateRange(1, 8)][int]$Workers = 2,
  [string]$InputFile,
  [string]$OutputFile
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$VsDevCmd = 'C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\Tools\VsDevCmd.bat'
$Python = Join-Path $ProjectRoot '.local-cache\tools\parsac-env\python.exe'
$ParsacRepo = Join-Path $ProjectRoot '.local-cache\tools\parsac'
$Runner = Join-Path $PSScriptRoot 'run_floorplan.py'
if (-not $InputFile) { $InputFile = Join-Path $ProjectRoot 'physical_design\parsac\sample_test_2\input.json' }
if (-not $OutputFile) { $OutputFile = Join-Path $ProjectRoot 'physical_design\parsac\sample_test_2\result.json' }

foreach ($RequiredPath in @($VsDevCmd, $Python, $ParsacRepo, $Runner, $InputFile)) {
  if (-not (Test-Path -LiteralPath $RequiredPath)) {
    throw "Required PARSAC item is missing: $RequiredPath"
  }
}

Push-Location $ParsacRepo
try {
  $Arguments = @(
    $Runner, '--input', $InputFile, '--output', $OutputFile,
    '--steps', $Steps, '--runs', $Runs, '--workers', $Workers
  ) | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }
  $Command = "call `"$VsDevCmd`" -arch=x64 -host_arch=x64 >nul && `"$Python`" $($Arguments -join ' ')"
  cmd.exe /d /s /c $Command
  if ($LASTEXITCODE -ne 0) { throw "PARSAC failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host "PARSAC result: $OutputFile"
