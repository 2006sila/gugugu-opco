@echo off
setlocal
cd /d "%~dp0"

rem ---- build on demand -------------------------------------------------
if not exist "dist\main.js" (
  echo [zen-hub] no build found, building first...
  call build.cmd
  if errorlevel 1 exit /b 1
)
if not exist "web\dist\index.html" (
  echo [zen-hub] console not built, building it...
  call build.cmd
  if errorlevel 1 exit /b 1
)

rem ---- start the server in its own window ------------------------------
rem This script opens the browser, so tell the server not to.
set "ZEN_HUB_SUPPRESS_OPEN=1"
if exist "data\runtime.txt" del /q "data\runtime.txt"
start "zen-hub" cmd /k "node dist\main.js"

rem ---- wait for the server to report its real address ------------------
set /a tries=0
:wait_server
if exist "data\runtime.txt" goto have_runtime
set /a tries+=1
if %tries% geq 20 goto no_runtime
ping -n 2 127.0.0.1 >nul
goto wait_server

:have_runtime
set "ZEN_URL="
set "ZEN_OPEN=0"
for /f "usebackq tokens=1,* delims==" %%a in ("data\runtime.txt") do (
  if /i "%%a"=="url" set "ZEN_URL=%%b"
  if /i "%%a"=="open" set "ZEN_OPEN=%%b"
)
if "%ZEN_URL%"=="" goto no_runtime
if "%ZEN_OPEN%"=="1" (
  echo [zen-hub] opening %ZEN_URL%
  start "" "%ZEN_URL%"
) else (
  echo [zen-hub] auto-open is off - open %ZEN_URL% yourself
)
exit /b 0

:no_runtime
echo [zen-hub] the server did not report an address in time.
echo [zen-hub] check the "zen-hub" console window for the real URL.
exit /b 1