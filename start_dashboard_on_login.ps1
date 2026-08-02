<# Starts the Veriolg_MA dashboard services after a Windows sign-in. #>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDirectory = Join-Path $workspace 'logs'
$logPath = Join-Path $logDirectory 'dashboard-startup.log'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Write-StartupLog([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message" | Add-Content -LiteralPath $logPath -Encoding utf8
}

Write-StartupLog 'Dashboard startup invoked.'
& cmd.exe /d /c (Join-Path $workspace 'start_dashboard_services.cmd')
if ($LASTEXITCODE -ne 0) {
    Write-StartupLog "Dashboard start command failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

$deadline = (Get-Date).AddSeconds(30)
do {
    try {
        $api = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/health' -TimeoutSec 3).StatusCode
        $web = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 3).StatusCode
        if ($api -eq 200 -and $web -eq 200) {
            Write-StartupLog 'Dashboard services are healthy.'
            exit 0
        }
    } catch {}
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

Write-StartupLog 'Dashboard service health check timed out.'
exit 1
