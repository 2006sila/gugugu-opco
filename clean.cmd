@echo off
setlocal
cd /d "%~dp0"
echo This removes build output and caches; data and config.env are kept.
if exist .tmp\ rmdir /s /q .tmp
if exist .npm-cache\ rmdir /s /q .npm-cache
if exist dist\ rmdir /s /q dist
if exist web\dist\ rmdir /s /q web\dist
echo done.
