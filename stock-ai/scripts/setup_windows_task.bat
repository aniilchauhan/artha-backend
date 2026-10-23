@echo off
REM ==============================================================================
REM Registers the NSE Stock AI Daily Paper Trader in Windows Task Scheduler
REM Runs Monday through Friday at 15:45 IST (3:45 PM IST)
REM ==============================================================================

set TASK_NAME=NSE_Stock_AI_PaperTrader
set SCRIPT_PATH=%~dp0run_daily_scheduler.ps1

echo ==============================================================================
echo REGISTERING WINDOWS TASK SCHEDULER: %TASK_NAME%
echo Schedule    : Monday through Friday at 15:45 IST
echo Script Path : %SCRIPT_PATH%
echo ==============================================================================

schtasks /create /tn "%TASK_NAME%" /tr "powershell.exe -ExecutionPolicy Bypass -File \"%SCRIPT_PATH%\"" /sc weekly /d MON,TUE,WED,THU,FRI /st 15:45 /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [OK] Task "%TASK_NAME%" successfully registered in Windows Task Scheduler!
    echo To view it in Windows Task Scheduler GUI: Win+R -> taskschd.msc
    echo To run it manually right now: schtasks /run /tn "%TASK_NAME%"
    echo To delete the scheduled task later: schtasks /delete /tn "%TASK_NAME%" /f
) else (
    echo.
    echo [ERROR] Failed to register task. Please run this script as Administrator.
)

echo ==============================================================================
pause
