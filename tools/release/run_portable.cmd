@echo off
cd /d "%~dp0"
echo Veriolg MA portable viewer starting on http://127.0.0.1:8788/
echo Close this window to stop the server.
"%~dp0VeriolgMA.exe" --portable --port 8788 --open-browser
if errorlevel 1 (
  echo.
  echo The server could not start. Check that port 8788 is free.
  pause
)
