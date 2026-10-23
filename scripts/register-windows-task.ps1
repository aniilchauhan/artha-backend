# Axion Pre-Market Daily Scan Task Scheduler
# Registers a Windows Scheduled Task to run every Monday-Friday at 8:45 AM IST

$TaskName = "AxionPreMarketDailyScan"
$Action = New-ScheduledTaskAction -Execute "node.exe" -Argument "scripts/scheduled-daily-scan.mjs" -WorkingDirectory "c:\Anil\axion"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 8:45AM
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs Axion Daily Stock ML Predictions and syncs to MongoDB at 08:45 AM IST"
    Write-Host "✅ Scheduled Task '$TaskName' successfully registered for 8:45 AM Mon-Fri!" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Notice: To register in Windows Task Scheduler, run PowerShell as Administrator, or execute manually via: npm run scan:daily" -ForegroundColor Yellow
}
