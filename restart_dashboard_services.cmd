@echo off
setlocal
echo [Veriolg MA] Restarting Knowledge API and React Dashboard...
call "%~dp0restart_dashboard_services.bat"
endlocal
