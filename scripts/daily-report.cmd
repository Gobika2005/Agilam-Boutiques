@echo off
REM Wrapper for the daily owner report, invoked by Windows Task Scheduler.
REM
REM Exists so a failure at 07:00 leaves evidence. Task Scheduler records only an
REM exit code, which cannot tell you whether Resend rejected the recipient or the
REM token was rotated, so everything is appended to daily-report.log next to it.
REM
REM Paths are resolved relative to this file (%~dp0 is the scripts directory), so
REM the repo can move without editing the scheduled task.
setlocal
cd /d "%~dp0.."

set "LOG=%~dp0..\daily-report.log"

echo. >> "%LOG%"
echo ===== %date% %time% ===== >> "%LOG%"

node scripts\daily-report.mjs --send >> "%LOG%" 2>&1
echo exit=%ERRORLEVEL% >> "%LOG%"

endlocal
