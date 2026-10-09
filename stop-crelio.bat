@echo off
rem CrelioBot - stop every session.
cd /d "%~dp0"
node bin\crelio.mjs stop
timeout /t 3 >nul
