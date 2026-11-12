@echo off
rem Locate a Python interpreter and store it in the variable named by %1
rem (default PY). Pure ASCII on purpose - cmd.exe parses .bat by code page.
rem
rem Lookup order:
rem   1. ACCOUNT_MANAGER_PYTHON / ACCOUNT_MANAGER_PYTHONW env var (explicit)
rem   2. <this folder>\python\<python|pythonw>.exe   (portable: ship your own)
rem   3. <this folder>\toolkit\<name>.exe           (legacy OAS layout)
rem   4. toolkit\<name>.exe in any ancestor        (OAS repo: tool under .agents/)
rem   5. python / py on PATH                       (system install)
rem
rem Exits with code 1 when nothing usable was found.
setlocal EnableDelayedExpansion

set "WANT=%~1"
if "%WANT%"=="" set "WANT=python"
set "VARN=%~2"
if "%VARN%"=="" set "VARN=PY"

rem --- 1) explicit override -------------------------------------------------
if /i "%WANT%"=="pythonw" (
    set "CAND=%ACCOUNT_MANAGER_PYTHONW%"
    if not defined CAND set "CAND=%ACCOUNT_MANAGER_PYTHON%"
) else (
    set "CAND=%ACCOUNT_MANAGER_PYTHON%"
)
if defined CAND if exist "%CAND%" (
    rem NOTE: no space before '&' - it would be appended to the value
    endlocal&set "%VARN%=%CAND%"&exit /b 0
)

rem --- 2) portable: python\ next to this tool -------------------------------
if exist "%~dp0python\%WANT%.exe" (
    endlocal&set "%VARN%=%~dp0python\%WANT%.exe"&exit /b 0
)
if /i "%WANT%"=="pythonw" (
    if exist "%~dp0python\python.exe" (
        endlocal&set "%VARN%=%~dp0python\python.exe"&exit /b 0
    )
)

rem --- 3) legacy: toolkit\ next to this tool --------------------------------
if exist "%~dp0toolkit\%WANT%.exe" (
    endlocal&set "%VARN%=%~dp0toolkit\%WANT%.exe"&exit /b 0
)
if /i "%WANT%"=="pythonw" (
    if exist "%~dp0toolkit\python.exe" (
        endlocal&set "%VARN%=%~dp0toolkit\python.exe"&exit /b 0
    )
)

rem --- 4) walk up looking for toolkit\<name>.exe ----------------------------
set "DIR=%~dp0"
set /a WALK=0
:walk
set /a WALK+=1
if %WALK% GTR 32 goto walk_done
if exist "%DIR%toolkit\%WANT%.exe" (
    endlocal&set "%VARN%=%DIR%toolkit\%WANT%.exe"&exit /b 0
)
rem pythonw fallback: plain python.exe is still better than nothing
if /i "%WANT%"=="pythonw" (
    if exist "%DIR%toolkit\python.exe" (
        endlocal&set "%VARN%=%DIR%toolkit\python.exe"&exit /b 0
    )
)
for %%I in ("%DIR%..") do set "PARENT=%%~fI"
rem Stop when we cannot go any higher.
rem "%%~fI" keeps a trailing backslash for a drive root ("X:\"), so the
rem naive "PARENT == DIR" test never fires: DIR "X:\a\" -> PARENT "X:\"
rem -> next DIR becomes "X:\\" and the loop spins forever. That is exactly
rem what happened once this tool lived outside the OAS tree (no toolkit\
rem ancestor to hit early). Strip the trailing slash and compare "X:".
if /i "%PARENT%"=="%DIR%" goto walk_done
set "P2=%PARENT%"
if "%P2:~-1%"=="\" set "P2=%P2:~0,-1%"
if "%P2:~1%"==":" goto walk_done
set "DIR=%PARENT%\"
goto walk
:walk_done

rem --- 5) PATH --------------------------------------------------------------
rem pythonw: prefer pythonw.exe (no console window). If the system only has
rem python.exe, fall back to it -- the launcher still works, a console may
rem flash briefly. Without this fallback, a machine that installed Python
rem with the default options (python.exe only) could never start the tool.
if /i "%WANT%"=="pythonw" (
    for %%I in (pythonw.exe) do if not "%%~$PATH:I"=="" (
        endlocal&set "%VARN%=%%~$PATH:I"&exit /b 0
    )
    for %%I in (python.exe) do if not "%%~$PATH:I"=="" (
        endlocal&set "%VARN%=%%~$PATH:I"&exit /b 0
    )
    for %%I in (pyw.exe) do if not "%%~$PATH:I"=="" (
        endlocal&set "%VARN%=%%~$PATH:I"&exit /b 0
    )
) else (
    for %%I in (python.exe) do if not "%%~$PATH:I"=="" (
        endlocal&set "%VARN%=%%~$PATH:I"&exit /b 0
    )
    for %%I in (py.exe) do if not "%%~$PATH:I"=="" (
        endlocal&set "%VARN%=%%~$PATH:I"&exit /b 0
    )
)

endlocal
exit /b 1
