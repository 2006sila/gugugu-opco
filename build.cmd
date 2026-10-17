@echo off
setlocal
cd /d "%~dp0"

rem --- temp dir inside the project: the sandbox denies esbuild's temp cleanup in %TEMP% ---
set "TMP=%~dp0.tmp"
set "TEMP=%~dp0.tmp"
if not exist "%TMP%" mkdir "%TMP%"

echo [1/3] typecheck
call npm run typecheck || goto :fail

echo [2/3] build backend
call npm run build || goto :fail

echo [3/3] build web console
call npm run build:web || goto :fail

echo build ok
exit /b 0

:fail
echo build failed with %errorlevel%
exit /b %errorlevel%