@echo off
rem Stop the OAS account list manager if it is running.
rem Pure ASCII on purpose: cmd.exe parses .bat with the console code page.
setlocal
pushd "%~dp0"

chcp 65001 >nul 2>&1
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

call "%~dp0_find_python.bat" python
if errorlevel 1 goto no_python

set "APP=%~dp0server.py"
if not exist "%APP%" goto no_app

title OAS Account List Manager - Stop
"%PY%" -B "%APP%" --stop
set "CODE=%ERRORLEVEL%"
rem No pause here: this script is normally double-clicked and should just
rem close when done. A stray pause leaves a console window waiting for Enter,
rem which looks like the tool hung.
popd
exit /b %CODE%

:no_python
echo [ERROR] Python interpreter not found.
echo         Looked for: toolkit\python.exe in this folder and its parents,
echo         then python/py on PATH.
echo         Fix: set TOOLKIT_PYTHON to a full python.exe path.
pause
popd
exit /b 1

:no_app
echo [ERROR] server.py not found:
echo         %APP%
pause
popd
exit /b 1
