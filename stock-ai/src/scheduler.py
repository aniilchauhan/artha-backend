"""
Automated Daily End-of-Day (EOD) Pipeline Scheduler for Indian NSE Equities.
Orchestrates:
  1. Daily EOD Market Scanner (daily_scan.py)
  2. Portfolio Sizing & Paper Rebalance (paper_trading.py)
  3. Broker Order Dispatching (broker_dispatcher.py)

Scheduled Run: Strictly at 15:45 IST (3:45 PM) on NSE Trading Days (Monday - Friday).
- Windows: integrates with Windows Task Scheduler (schtasks.exe)
- Linux/macOS: generates a crontab entry for use with system cron
"""

import sys
import os
import json
import logging
import argparse
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scheduler")

STATUS_FILE = config.OUTPUTS_DIR / "scheduler_status.json"
TASK_NAME = "AxionStockAIScanner"
IS_WINDOWS = sys.platform == "win32"


def is_nse_trading_day(dt: Optional[datetime] = None) -> bool:
    """Checks if date is a weekday (Monday=0 to Friday=4)."""
    if dt is None:
        dt = datetime.now()
    return dt.weekday() < 5


def get_next_scheduled_run() -> str:
    """Calculates the next upcoming 15:45 IST run date/time."""
    now = datetime.now()
    today_run = now.replace(hour=15, minute=45, second=0, microsecond=0)

    if now < today_run and is_nse_trading_day(now):
        target = today_run
    else:
        target = today_run + timedelta(days=1)
        while not is_nse_trading_day(target):
            target += timedelta(days=1)

    return target.strftime("%Y-%m-%d 15:45:00 IST")


# ---------------------------------------------------------------------------
# Windows Task Scheduler
# ---------------------------------------------------------------------------

def check_windows_task_status() -> Dict:
    """Queries Windows Task Scheduler via schtasks.exe."""
    if not IS_WINDOWS:
        return {"registered": False, "task_name": TASK_NAME, "status": "NOT_SUPPORTED", "message": "Windows Task Scheduler is not available on this platform."}
    try:
        cmd = ["schtasks.exe", "/query", "/tn", TASK_NAME, "/fo", "LIST"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            lines = res.stdout.splitlines()
            status_dict = {}
            for line in lines:
                if ":" in line:
                    k, v = line.split(":", 1)
                    status_dict[k.strip()] = v.strip()
            return {
                "registered": True,
                "task_name": TASK_NAME,
                "status": status_dict.get("Status", "Ready"),
                "next_run_time": status_dict.get("Next Run Time", "N/A"),
                "last_run_time": status_dict.get("Last Run Time", "N/A"),
            }
        else:
            return {
                "registered": False,
                "task_name": TASK_NAME,
                "status": "NOT_REGISTERED",
                "message": "Windows Task not currently scheduled",
            }
    except Exception as e:
        return {
            "registered": False,
            "task_name": TASK_NAME,
            "status": "QUERY_ERROR",
            "error": str(e),
        }


def install_windows_task(python_exe: Optional[str] = None) -> Dict:
    """Registers AxionStockAIScanner in Windows Task Scheduler to run every Mon-Fri at 15:45."""
    if not IS_WINDOWS:
        return {"success": False, "error": "Windows Task Scheduler is not available on this platform. Use install_cron_job() instead."}

    if not python_exe:
        python_exe = str(BASE_DIR / "venv" / "Scripts" / "python.exe")
        if not Path(python_exe).exists():
            python_exe = sys.executable

    scheduler_script = str(BASE_DIR / "src" / "scheduler.py")
    command_str = f'"{python_exe}" "{scheduler_script}" --run-now'

    cmd = [
        "schtasks.exe", "/create", "/tn", TASK_NAME, "/tr", command_str,
        "/sc", "WEEKLY", "/d", "MON,TUE,WED,THU,FRI", "/st", "15:45", "/f",
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode == 0:
            logger.info(f"Successfully registered Windows Scheduled Task: {TASK_NAME}")
            status = check_windows_task_status()
            save_scheduler_status(extra={"windows_task": status})
            return {"success": True, "message": "Windows Scheduled Task installed successfully", "status": status}
        else:
            logger.error(f"Failed to create task: {res.stderr}")
            return {"success": False, "error": res.stderr}
    except Exception as e:
        logger.error(f"Error executing schtasks.exe: {e}")
        return {"success": False, "error": str(e)}


def uninstall_windows_task() -> Dict:
    """Deletes AxionStockAIScanner from Windows Task Scheduler."""
    if not IS_WINDOWS:
        return {"success": False, "error": "Windows Task Scheduler is not available on this platform."}
    cmd = ["schtasks.exe", "/delete", "/tn", TASK_NAME, "/f"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode == 0:
            logger.info(f"Successfully removed Windows Scheduled Task: {TASK_NAME}")
            return {"success": True, "message": "Windows Scheduled Task uninstalled successfully"}
        else:
            return {"success": False, "error": res.stderr}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Linux/macOS cron support
# ---------------------------------------------------------------------------

def get_cron_entry(python_exe: Optional[str] = None) -> str:
    """Returns a crontab line that runs the pipeline at 15:45 IST (10:15 UTC) Mon-Fri."""
    if not python_exe:
        venv_posix = BASE_DIR / "venv" / "bin" / "python"
        python_exe = str(venv_posix) if venv_posix.exists() else sys.executable
    scheduler_script = str(BASE_DIR / "src" / "scheduler.py")
    log_path = str(config.OUTPUTS_DIR / "scheduler_cron.log")
    # 15:45 IST = 10:15 UTC
    return f"15 10 * * 1-5 {python_exe} {scheduler_script} --run-now >> {log_path} 2>&1"


def install_cron_job(python_exe: Optional[str] = None) -> Dict:
    """Installs an Axion crontab entry. Appends to current user's crontab."""
    if IS_WINDOWS:
        return {"success": False, "error": "cron is not available on Windows. Use install_windows_task() instead."}
    entry = get_cron_entry(python_exe)
    marker = f"# Axion EOD Scanner — {TASK_NAME}"
    try:
        # Read current crontab (may be empty / non-existent)
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        current = result.stdout if result.returncode == 0 else ""

        # Idempotent: remove any existing Axion lines before re-adding
        lines = [l for l in current.splitlines() if TASK_NAME not in l and "axion" not in l.lower()]
        lines += [marker, entry, ""]
        new_crontab = "\n".join(lines)

        proc = subprocess.run(["crontab", "-"], input=new_crontab, capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            logger.info(f"Installed cron job: {entry}")
            return {"success": True, "message": "Cron job installed (Mon-Fri 10:15 UTC / 15:45 IST)", "entry": entry}
        else:
            return {"success": False, "error": proc.stderr or "crontab write failed"}
    except FileNotFoundError:
        return {"success": False, "error": "crontab command not found. Ensure cron is installed (e.g. apt install cron)."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def uninstall_cron_job() -> Dict:
    """Removes the Axion crontab entry."""
    if IS_WINDOWS:
        return {"success": False, "error": "cron is not available on Windows."}
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if result.returncode != 0:
            return {"success": True, "message": "No existing crontab found — nothing to remove."}
        lines = [l for l in result.stdout.splitlines() if TASK_NAME not in l and "axion" not in l.lower()]
        proc = subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", capture_output=True, text=True, timeout=10)
        if proc.returncode == 0:
            return {"success": True, "message": "Axion cron job removed."}
        return {"success": False, "error": proc.stderr or "crontab write failed"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def check_cron_status() -> Dict:
    """Checks if an Axion cron entry currently exists."""
    if IS_WINDOWS:
        return {"registered": False, "status": "NOT_SUPPORTED", "message": "cron not available on Windows."}
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
        if result.returncode != 0:
            return {"registered": False, "status": "NO_CRONTAB"}
        entry = next((l for l in result.stdout.splitlines() if TASK_NAME in l or ("axion" in l.lower() and "scheduler" in l.lower())), None)
        if entry:
            return {"registered": True, "status": "ACTIVE", "entry": entry}
        return {"registered": False, "status": "NOT_REGISTERED"}
    except Exception as e:
        return {"registered": False, "status": "QUERY_ERROR", "error": str(e)}


# ---------------------------------------------------------------------------
# Cross-platform helpers
# ---------------------------------------------------------------------------

def get_platform_task_status() -> Dict:
    """Returns scheduler status for the current platform."""
    if IS_WINDOWS:
        return check_windows_task_status()
    return check_cron_status()


def install_platform_task(python_exe: Optional[str] = None) -> Dict:
    """Installs the scheduled task for the current platform."""
    if IS_WINDOWS:
        return install_windows_task(python_exe)
    return install_cron_job(python_exe)


def uninstall_platform_task() -> Dict:
    """Uninstalls the scheduled task for the current platform."""
    if IS_WINDOWS:
        return uninstall_windows_task()
    return uninstall_cron_job()


def run_pipeline(universe: str = "core50", capital: float = 1000000.0, risk_pct: float = 1.0) -> Dict:
    """Executes the full automated EOD pipeline."""
    start_time = datetime.now()
    logger.info("=" * 80)
    logger.info(f"EXECUTING AUTOMATED EOD PIPELINE ({start_time.strftime('%Y-%m-%d %H:%M:%S')})")
    logger.info("=" * 80)

    # 1. Daily Scan
    logger.info("Step 1/3: Running Daily EOD Market Scanner...")
    from src import daily_scan
    predictions = daily_scan.run_daily_scan(universe=universe, min_score=0.0)

    # 2. Portfolio Sizing
    logger.info("Step 2/3: Sizing Portfolio & Paper Trade Allocation...")
    from src import paper_trading
    portfolio_data = paper_trading.run_simulator(
        capital=capital,
        risk_pct=risk_pct,
        mode="VOLATILITY_PARITY",
        max_positions=5,
    )

    # 3. Broker Dispatch
    logger.info("Step 3/3: Dispatching Orders to Indian Broker Sandbox...")
    from src import broker_dispatcher
    receipt = broker_dispatcher.run_broker_dispatch(broker="zerodha", mode="sandbox")

    end_time = datetime.now()
    duration_s = round((end_time - start_time).total_seconds(), 2)

    summary = {
        "pipeline_status": "SUCCESS",
        "last_run_timestamp": end_time.strftime("%Y-%m-%d %H:%M:%S"),
        "duration_seconds": duration_s,
        "universe_scanned": universe,
        "stocks_evaluated": len(predictions),
        "active_orders": len(portfolio_data.get("orders", [])),
        "capital_deployed_inr": portfolio_data.get("total_capital_deployed_inr", 0.0),
        "cash_reserve_inr": portfolio_data.get("cash_reserve_inr", 0.0),
        "broker_receipt_id": receipt.get("dispatch_id"),
        "next_scheduled_run": get_next_scheduled_run(),
    }

    save_scheduler_status(summary)
    logger.info("=" * 80)
    logger.info(f"EOD PIPELINE COMPLETED SUCCESSFULLY IN {duration_s}s")
    logger.info(f"Next Scheduled Run: {summary['next_scheduled_run']}")
    logger.info("=" * 80)

    return summary


def save_scheduler_status(data: Optional[Dict] = None, extra: Optional[Dict] = None) -> None:
    """Saves scheduler state to JSON."""
    current = {}
    if STATUS_FILE.exists():
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                current = json.load(f)
        except Exception:
            pass

    if data:
        current.update(data)
    if extra:
        current.update(extra)

    current["last_updated"] = datetime.now().isoformat()
    current["next_scheduled_run"] = get_next_scheduled_run()
    current["windows_task"] = get_platform_task_status()

    config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=4)


def get_status() -> Dict:
    """Returns current scheduler configuration and execution status."""
    if STATUS_FILE.exists():
        try:
            with open(STATUS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["windows_task"] = get_platform_task_status()
                data["next_scheduled_run"] = get_next_scheduled_run()
                return data
        except Exception:
            pass

    return {
        "pipeline_status": "READY",
        "last_run_timestamp": None,
        "next_scheduled_run": get_next_scheduled_run(),
        "windows_task": get_platform_task_status(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Axion Stock AI Automated EOD Scheduler")
    parser.add_argument("--run-now", action="store_true", help="Execute full EOD pipeline immediately")
    parser.add_argument("--universe", type=str, default="core50", help="Universe to scan (core50, nifty100, nifty500)")
    parser.add_argument("--install-task", action="store_true", help="Register scheduled task (Windows Task Scheduler or cron depending on platform)")
    parser.add_argument("--uninstall-task", action="store_true", help="Remove scheduled task for the current platform")
    # Legacy aliases kept for backwards compatibility
    parser.add_argument("--install-windows-task", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--uninstall-windows-task", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--status", action="store_true", help="Check scheduler and task status")

    args = parser.parse_args()

    if args.install_task or args.install_windows_task:
        res = install_platform_task()
        print(json.dumps(res, indent=2))
    elif args.uninstall_task or args.uninstall_windows_task:
        res = uninstall_platform_task()
        print(json.dumps(res, indent=2))
    elif args.run_now:
        res = run_pipeline(universe=args.universe)
        print(json.dumps(res, indent=2))
    else:
        status = get_status()
        print(json.dumps(status, indent=2))
