@echo off
title MacOptics - Local Server
cd /d "%~dp0"

echo.
echo  [ MacOptics v2.0 ]  Starting local server...
echo.

REM Start browser after 2 seconds (gives server time to start)
start /b cmd /c "timeout /t 2 /nobreak > nul && start http://localhost:8080"

REM Serve the app (Python built-in - no extra install)
python -m http.server 8080
if errorlevel 1 (
  python3 -m http.server 8080
  if errorlevel 1 (
    echo.
    echo Python not found. Please install from https://python.org
    pause
    exit /b 1
  )
)
