@echo off
rem One-click launcher for the OAS account list manager.
rem This file is intentionally pure ASCII: cmd.exe parses .bat using the
rem console code page, and UTF-8 Chinese here would be mangled.
rem All Chinese output comes from server.py instead.
rem
rem Python interpreter lookup order:
rem   1. TOOLKIT_PYTHON / TOOLKIT_PYTHONW environment variable
rem   2. toolkit\ inside this folder or any ancestor (normal OAS layout)
rem   3. python / py on PATH
rem This way the tool still starts after being moved to another folder.
setlocal
pushd "%~dp0"

chcp 65001 >nul 2>&1
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

call "%~dp0_find_python.bat" python
if errorlevel 1 goto no_python

set "APP=%~dp0server.py"
if not exist "%APP%" goto no_app

title OAS Account List Manager
"%PY%" -B "%APP%" %*
set "CODE=%ERRORLEVEL%"

popd
if not "%CODE%"=="0" goto failed
exit /b 0

:failed
echo.
echo Exited with code %CODE%
pause
exit /b %CODE%

:no_python
echo [ERROR] Python interpreter not found.
echo         Looked for: toolkit\python.exe in this folder and its parents,
echo         then python/py on PATH.
echo         Fix: set TOOLKIT_PYTHON to a full python.exe path, e.g.
echo             set TOOLKIT_PYTHON=D:\OAS\toolkit\python.exe
pause
popd
exit /b 1

:no_app
echo [ERROR] server.py not found:
echo         %APP%
pause
popd
exit /b 1
