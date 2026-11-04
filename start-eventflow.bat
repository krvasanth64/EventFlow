@echo off
setlocal
cd /d "%~dp0"
if not defined EVENTFLOW_DATA set "EVENTFLOW_DATA=%~dp0runtime"
if not defined EVENTFLOW_ADMIN_PASSWORD if not exist "%EVENTFLOW_DATA%\data.json" (
  echo First startup: initial administrator password is required.
  set /p EVENTFLOW_ADMIN_PASSWORD=Enter initial admin password: 
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting EventFlow on http://localhost:8765
echo Keep this window open while EventFlow is in use.
node server.js
pause
