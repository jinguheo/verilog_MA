param(
  [string]$Python = 'python',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\release')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dashboardRoot = Join-Path $repoRoot 'my_dashboard'
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js/npm is required on the build PC.' }
& $Python -m PyInstaller --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller is required on the build PC.' }

Push-Location $dashboardRoot
try {
  if (-not (Test-Path 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$bundleName = 'VeriolgMA-portable-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$bundleDir = Join-Path $outputRoot $bundleName
$pyWorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ($bundleName + '-pyinstaller')
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null
New-Item -ItemType Directory -Path $pyWorkDir -Force | Out-Null

$dataArgs = @('--add-data', "$(Join-Path $dashboardRoot 'dist');my_dashboard/dist")
function Add-ReleaseData([string]$relativePath, [string]$destination) {
  $source = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $source)) { throw "Required release data is missing: $relativePath" }
  $script:dataArgs += @('--add-data', "$source;$destination")
}

Add-ReleaseData 'analog\catalog.json' 'analog'
Add-ReleaseData 'analog\install_status.json' 'analog'
Add-ReleaseData 'physical_design\install_status.json' 'physical_design'
Add-ReleaseData 'physical_design\layout_candidates\optimization_history.json' 'physical_design/layout_candidates'
Add-ReleaseData 'physical_design\parsac\sample_test_2\result.json' 'physical_design/parsac/sample_test_2'
Add-ReleaseData 'physical_design\parsac\sample_test_4\result.json' 'physical_design/parsac/sample_test_4'
Add-ReleaseData 'samples\sample_test_4\asic\ppa3_adc_capture\config.json' 'samples/sample_test_4/asic/ppa3_adc_capture'
Add-ReleaseData 'samples\sample_test_4\asic\ppa3_adc_capture\layout_images' 'samples/sample_test_4/asic/ppa3_adc_capture/layout_images'
Add-ReleaseData 'analog\build\sky130_ef_ip__adc3v_12bit\sky130_ef_ip__adc3v_12bit.lef' 'analog/build/sky130_ef_ip__adc3v_12bit'
Add-ReleaseData 'analog\third_party\sram22_sky130_macros\sram22_1024x32m8w8\sram22_1024x32m8w8.lef' 'analog/third_party/sram22_sky130_macros/sram22_1024x32m8w8'

& $Python -m PyInstaller --noconfirm --clean --onefile --name VeriolgMA --distpath $bundleDir --workpath (Join-Path $pyWorkDir 'build') --specpath $pyWorkDir @dataArgs (Join-Path $repoRoot 'dashboard_server.py')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed.' }

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run_portable.cmd') -Destination $bundleDir
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-PORTABLE.md') -Destination $bundleDir
$archive = Join-Path $outputRoot ($bundleName + '.zip')
Compress-Archive -LiteralPath $bundleDir -DestinationPath $archive -CompressionLevel Optimal
Write-Host "Portable release: $archive"
