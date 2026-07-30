param([switch]$CheckOnly)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$suite = 'D:\MyWork\Veriolg_MA\oss-cad-suite'
if (-not (Test-Path -LiteralPath $suite)) { throw "OSS CAD Suite not found: $suite" }
$env:OSS_CAD_ROOT = $suite
$env:PATH = "$root;$suite\bin;$suite\lib;$env:PATH"
$env:SSL_CERT_FILE = "$suite\etc\cacert.pem"

Write-Host "OSS CAD Suite: $suite" -ForegroundColor Cyan
foreach ($cmd in @('iverilog','vvp','yosys','sby','verilator_bin.exe')) {
  $resolved = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($resolved) { Write-Host "[READY] $cmd -> $($resolved.Source)" -ForegroundColor Green }
  else { Write-Host "[MISSING] $cmd" -ForegroundColor Yellow }
}

if (-not $CheckOnly) {
  Write-Host 'EDA environment is active in this PowerShell session.' -ForegroundColor Cyan
  Write-Host 'Run: yosys --version; iverilog -V; sby --version' -ForegroundColor DarkCyan
}
