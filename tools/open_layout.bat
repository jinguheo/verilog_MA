@echo off
REM Open a finished sky130 GDS in the KLayout GUI.
REM
REM   tools\open_layout.bat                  -> chan_ctrl
REM   tools\open_layout.bat cnt_sat
REM   tools\open_layout.bat skid_buffer
REM
REM KLayout runs inside WSL and draws on the Windows desktop through WSLg, so
REM nothing needs to be installed on the Windows side. The sky130 layer
REM properties file is loaded so layers get their proper colours instead of
REM KLayout defaults.

setlocal
set DESIGN=%~1
if "%DESIGN%"=="" set DESIGN=chan_ctrl

echo Opening %DESIGN% in KLayout (via WSL/WSLg)...
echo Close the KLayout window to return.
echo.

wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/open_klayout.sh %DESIGN%

endlocal
