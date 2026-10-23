# Automated Post-Market Daily Paper Trading Scheduler for Indian NSE Equities
# Recommended schedule: Monday through Friday at 15:45 IST (3:45 PM IST)

$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectDir

$LogFile = Join-Path $ProjectDir "outputs\paper_trading\scheduler.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

function Write-Log {
    param([string]$Message)
    $Entry = "[$Timestamp] $Message"
    Write-Host $Entry
    Add-Content -Path $LogFile -Value $Entry
}

Write-Log "================================================================="
Write-Log "STARTING AUTOMATED NSE POST-MARKET ROUTINE"
Write-Log "Project Directory: $ProjectDir"

$PythonExe = Join-Path $ProjectDir "venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
}

# 1. Evaluate yesterday's signals against today's intraday candles
Write-Log "[STEP 1/4] Evaluating pending intraday trades from previous session..."
& $PythonExe src/intraday_evaluator.py *>> $LogFile
if ($LASTEXITCODE -eq 0) {
    Write-Log "  [OK] Intraday trade evaluation complete."
} else {
    Write-Log "  [WARN] Intraday evaluator finished with code $LASTEXITCODE"
}

# 2. Sync today's daily close data and generate tomorrow's forward paper signals
Write-Log "[STEP 2/4] Generating tomorrow's breakout paper signals..."
& $PythonExe src/daily_paper_signal.py *>> $LogFile
if ($LASTEXITCODE -eq 0) {
    Write-Log "  [OK] Daily paper signals generated and logged."
} else {
    Write-Log "  [WARN] Daily signal generator finished with code $LASTEXITCODE"
}

# 3. Compute portfolio allocation & position sizing (shares & Rupees)
Write-Log "[STEP 3/4] Updating portfolio position sizing and capital allocation..."
& $PythonExe src/portfolio_allocator.py *>> $LogFile
if ($LASTEXITCODE -eq 0) {
    Write-Log "  [OK] Portfolio sizing updated."
}

# 4. Generate updated forward performance summary
Write-Log "[STEP 4/4] Generating updated forward paper performance summary..."
& $PythonExe src/paper_performance.py *>> $LogFile

Write-Log "POST-MARKET ROUTINE COMPLETED SUCCESSFULLY"
Write-Log "================================================================="
