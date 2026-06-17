@echo off
REM Start the telc-a1 local server (Windows).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not on PATH. Install it from https://nodejs.org (18+).
  exit /b 1
)
node scripts\start.js
