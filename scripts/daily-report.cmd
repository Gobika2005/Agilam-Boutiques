@echo off
REM Fallback sender for the daily admin report, invoked by Windows Task Scheduler.
REM
REM The PRIMARY sender is the `daily-report` Supabase Edge Function on pg_cron at
REM 01:30 UTC (07:00 IST). This task exists for the morning that does not happen.
REM Schedule it for 07:45 local — after the cloud run, and after the 25-minute
REM staleness window a claimed-but-never-completed cloud run has to sit out.
REM
REM --ensure asks the database whether the report already went out and does
REM nothing if it did, so running this at any hour is harmless. It exits 0 in
REM that case on purpose: Task Scheduler reads a non-zero exit as a fault, and
REM "the cloud already sent it" is the normal, healthy outcome.
REM
REM Exists as a wrapper so a failure at 07:45 leaves evidence. Task Scheduler
REM records only an exit code, which cannot tell you whether Resend rejected the
REM sender or the token was rotated, so everything is appended to
REM daily-report.log next to it.
REM
REM Paths are resolved relative to this file (%~dp0 is the scripts directory), so
REM the repo can move without editing the scheduled task.
setlocal
cd /d "%~dp0.."

set "LOG=%~dp0..\daily-report.log"

echo. >> "%LOG%"
echo ===== %date% %time% ===== >> "%LOG%"

node scripts\daily-report.mjs --ensure >> "%LOG%" 2>&1
echo exit=%ERRORLEVEL% >> "%LOG%"

endlocal
