param(
  [switch]$InstallPythonPackages,
  [switch]$InstallNodePackages,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$suite = Join-Path $root 'oss-cad-suite'
if (Test-Path -LiteralPath $suite) {
  $env:OSS_CAD_ROOT = $suite
  $env:PATH = "$suite\bin;$suite\lib;$env:PATH"
  Write-Host "[READY] OSS CAD Suite -> $suite" -ForegroundColor Green
}
$veribleRoot = Join-Path $root 'third_party\verible'
$veribleLint = Get-ChildItem -LiteralPath $veribleRoot -Recurse -File -Filter 'verible-verilog-lint.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($veribleLint) {
  $env:PATH = "$($veribleLint.Directory.FullName);$env:PATH"
  Write-Host "[READY] Verible -> $($veribleLint.Directory.FullName)" -ForegroundColor Green
}

function Check-Command($Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { Write-Host "[READY] $Name -> $($cmd.Source)" -ForegroundColor Green }
  else { Write-Host "[MISSING] $Name" -ForegroundColor Yellow }
}

Write-Host 'Veriolg_MA Windows-native environment' -ForegroundColor Cyan
Write-Host "Workspace: $root"
Write-Host ''

foreach ($name in @('python','node','git','verilator','iverilog','yosys','sby','slang','verible-verilog-lint','docker')) { Check-Command $name }

python -c "import cocotb, pyslang, tree_sitter_verilog; print('[READY] Python parser/verification packages')" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host '[MISSING] Python parser/verification packages' -ForegroundColor Yellow }

if ($CheckOnly) { exit 0 }

if ($InstallPythonPackages) {
  $env:COCOTB_IGNORE_PYTHON_REQUIRES = '1'
  python -m pip install --user pytest pyslang tree-sitter tree-sitter-verilog cocotb
}

if ($InstallNodePackages) {
  Push-Location (Join-Path $root 'my_dashboard')
  npm.cmd install
  npm.cmd install --save-dev @types/react @types/react-dom
  Pop-Location
}

Write-Host ''
Write-Host 'Windows-native setup complete. EDA tools may require an elevated installer.' -ForegroundColor Cyan
