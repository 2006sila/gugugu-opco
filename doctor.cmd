@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\main.js" (
  echo [zen-hub] build first: build.cmd
  exit /b 1
)
node scripts\doctor.mjs