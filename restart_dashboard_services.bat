@echo off
setlocal
echo [Veriolg MA] Restarting Knowledge API and React Dashboard...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=8788,5173; foreach($port in $ports){Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction Stop }}"
call "%~dp0start_dashboard_services.cmd"
echo [Veriolg MA] Waiting for services (up to 30 seconds)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$until=(Get-Date).AddSeconds(30); do { try { $api=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8788/api/overview' -TimeoutSec 10).StatusCode; $web=(Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 10).StatusCode; if($api -eq 200 -and $web -eq 200) { Write-Host ('API=' + $api + '  Dashboard=' + $web); exit 0 } } catch {} ; Start-Sleep -Seconds 2 } while((Get-Date) -lt $until); throw 'Service health check timed out.'"
if errorlevel 1 (
  echo [FAILED] Service restart or health check failed.
  if "%CI%"=="" pause
  exit /b 1
)
echo [OK] Services are ready.
if "%CI%"=="" pause
endlocal
