@echo off
setlocal
set "ROOT=%~dp0"
set "LOGS=%ROOT%logs"
if not exist "%LOGS%" mkdir "%LOGS%"

netstat -ano | findstr /R /C:":8788 .*LISTENING" >nul
if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'C:\Python314\python.exe' -WorkingDirectory '%ROOT%' -ArgumentList @('%ROOT%dashboard_server.py','--port','8788','--knowledge-root','D:\MyWork\verilog')"

netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'C:\Program Files\nodejs\npm.cmd' -WorkingDirectory '%ROOT%my_dashboard' -ArgumentList @('run','dev','--','--host','127.0.0.1')"
