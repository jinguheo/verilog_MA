@echo off
set "OSS_CAD_ROOT=%~dp0oss-cad-suite"
set "PYTHONPATH=%OSS_CAD_ROOT%\bin;%PYTHONPATH%"
"%OSS_CAD_ROOT%\lib\python3.exe" "%OSS_CAD_ROOT%\bin\sby-script.py" %*
