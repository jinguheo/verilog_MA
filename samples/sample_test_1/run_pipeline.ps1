[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$sample = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $repo 'start_windows_eda.ps1') -CheckOnly
$env:VERILATOR_ROOT = Join-Path $repo 'oss-cad-suite\share\verilator'
$verible = Get-ChildItem -LiteralPath (Join-Path $repo 'third_party\verible') -Recurse -Filter 'verible-verilog-lint.exe' | Select-Object -First 1 -ExpandProperty FullName
Push-Location $sample
try {
  & verilator_bin.exe --lint-only --Wall --top-module prim_filter rtl\prim_filter.sv; Write-Host "VERILATOR_EXIT=$LASTEXITCODE"
  & $verible rtl\prim_filter.sv; Write-Host "VERIBLE_EXIT=$LASTEXITCODE"
  & slang.exe --top prim_filter rtl\prim_filter.sv; Write-Host "SLANG_EXIT=$LASTEXITCODE"
  & iverilog -g2012 -s prim_filter_tb -o prim_filter_sim.out rtl\prim_filter.sv tb\prim_filter_tb.sv; Write-Host "IVERILOG_EXIT=$LASTEXITCODE"
  if ($LASTEXITCODE -eq 0) { & vvp prim_filter_sim.out; Write-Host "VVP_EXIT=$LASTEXITCODE" }
  & yosys.exe -p 'read_verilog -sv rtl/prim_filter.sv; chparam -set Cycles 4 -set AsyncOn 0 prim_filter; hierarchy -top prim_filter; proc; opt; stat'; Write-Host "YOSYS_EXIT=$LASTEXITCODE"
  & (Join-Path $repo 'sby_windows.cmd') -f formal\prim_filter.sby; Write-Host "SBY_EXIT=$LASTEXITCODE"
} finally { Pop-Location }
