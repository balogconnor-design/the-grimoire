@echo off
title The Grimoire
cd /d "%~dp0"

rem Find Node (it is not on PATH on this machine)
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" (
  where node >nul 2>nul && (set "NODE=node") || (
    echo Node.js was not found. Install it from https://nodejs.org and try again.
    pause
    exit /b 1
  )
)

rem Install dependencies if they are missing
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing dependencies...
  if exist "C:\Program Files\nodejs\npm.cmd" (
    call "C:\Program Files\nodejs\npm.cmd" install
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Starting The Grimoire...
echo The app will open in your browser. Close this window to stop it.
echo.
"%NODE%" node_modules\vite\bin\vite.js --open

echo.
echo The app has stopped.
pause
