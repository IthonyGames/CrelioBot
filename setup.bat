@echo off
rem CrelioBot - guided setup. Opens Claude Code with the setup agent.
cd /d "%~dp0"
where node >nul 2>&1 || (
    echo Node.js 22 or later is required: https://nodejs.org
    pause
    exit /b 1
)
where claude >nul 2>&1 || (
    echo Claude Code is required: https://code.claude.com/docs/en/quickstart
    pause
    exit /b 1
)
node bin\crelio.mjs setup %*
if errorlevel 1 pause
