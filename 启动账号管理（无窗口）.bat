@echo off
rem One-click launcher (no console window) for the OAS account list manager.
rem Pure ASCII on purpose: cmd.exe parses .bat by code page, so any Chinese
rem comment here would be mangled. Interpreter lookup lives in
rem _find_python.bat so this keeps working after the tool folder is moved.
setlocal
pushd "%~dp0"

set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

call "%~dp0_find_python.bat" pythonw PYW
if errorlevel 1 goto no_python

set "APP=%~dp0server.py"
if not exist "%APP%" goto no_app

start "" "%PYW%" -B "%APP%" %*
popd
exit /b 0

:no_python
echo [ERROR] Python interpreter not found.
echo         Looked for: toolkit\pythonw.exe / toolkit\python.exe in this
echo         folder and its parents, then python/py on PATH.
echo         Fix: set TOOLKIT_PYTHONW to a full pythonw.exe path.
pause
popd
exit /b 1

:no_app
echo [ERROR] server.py not found:
echo         %APP%
pause
popd
exit /b 1
