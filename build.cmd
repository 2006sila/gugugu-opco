@echo off
setlocal
cd /d "%~dp0"

rem --- temp dir inside the project: the sandbox denies esbuild's temp cleanup in %TEMP% ---
set "TMP=%~dp0.tmp"
set "TEMP=%~dp0.tmp"
if not exist "%TMP%" mkdir "%TMP%"

if not exist "node_modules\fastify" (
  echo [zen-hub] dependencies missing, running npm ci ...
  call npm ci || goto :fail
)
if not exist "web\node_modules\vite" (
  echo [zen-hub] console dependencies missing, running npm ci --prefix web ...
  call npm ci --prefix web || goto :fail
)

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