@echo off
rem CrelioBot - start every session (Router + one per KB), each in its own window.
cd /d "%~dp0"
where node >nul 2>&1 || (
    echo Node.js 22 or later is required: https://nodejs.org
    pause
    exit /b 1
)
node bin\crelio.mjs start %*
if errorlevel 1 pause
