"""
Daily Swing Reconciliation Script.
Reconciles active and watching swing setups against new market sessions.
Transitions:
  WATCHING -> TRIGGERED / ACTIVE (if price crossed trigger)
  WATCHING -> EXPIRED (if 3 sessions elapsed without trigger)
  ACTIVE -> TARGET_HIT / STOP_HIT / TIME_EXIT (if target/stop reached or 20 sessions elapsed)
Updates the immutable ledger and writes reconciliation logs.
"""

import json
import logging
from datetime import datetime
from pathlib import Path
import pandas as pd

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.swing_ledger import (
    SWING_PREDICTIONS_FILE,
    SWING_RECONCILED_FILE,
    scan_latest_swing_opportunities,
)
from src.swing_execution import net_return, resolve_entry, resolve_exit, stop_for_next_bar

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def reconcile_setup(setup: dict, bars: pd.DataFrame) -> dict:
    """Pure, idempotent lifecycle update with conservative daily-bar fills."""
    opp = dict(setup)
    if opp.get("status", "watching") not in ("watching", "active"):
        return opp
    df = bars.copy()
    df["Date"] = pd.to_datetime(df["Date"], utc=True)
    df = df.sort_values("Date").drop_duplicates("Date")
    future = df[df["Date"] > pd.to_datetime(opp["signalDate"], utc=True)]
    if opp.get("status", "watching") == "watching":
        trigger = float(opp["triggerPrice"])
        for _, bar in future.head(3).iterrows():
            entry_decision = resolve_entry(bar, trigger)
            if entry_decision["status"] == "skipped_gap_too_large":
                opp["status"] = entry_decision["status"]
                return opp
            if entry_decision["status"] == "active":
                entry = float(entry_decision["entry_price"])
                opp.update(status="active", entryPrice=entry,
                           entryDate=bar["Date"].strftime("%Y-%m-%d"),
                           targetPrice=entry * 1.10,
                           stopPrice=max(entry * 0.95, float(opp["stopPrice"])))
                break
        else:
            if len(future) >= 3:
                opp["status"] = "expired"
            return opp
    if not opp.get("entryDate"):
        raise ValueError("Active setup requires entryDate")
    entry_date = pd.to_datetime(opp["entryDate"], utc=True)
    active_bars = future[future["Date"] >= entry_date]
    entry, target, stop = (float(opp[k]) for k in ("entryPrice", "targetPrice", "stopPrice"))
    for _, bar in active_bars.iterrows():
        days_held = len(active_bars[(active_bars["Date"] > entry_date) & (active_bars["Date"] <= bar["Date"])])
        status, exit_price = None, None
        # The open precedes an intraday entry, so cannot be used as its gap-stop fill.
        intraday_entry = bar["Date"] == entry_date and bar["Open"] < opp["triggerPrice"]
        decision = resolve_exit(bar, entry, target, stop, entry_bar=intraday_entry)
        if decision:
            status, exit_price = decision["status"], decision["exit_price"]
        elif days_held >= 20:
            status, exit_price = "time_exit", float(bar["Close"])
        if status:
            opp.update(status=status, exitPrice=exit_price,
                       exitDate=bar["Date"].strftime("%Y-%m-%d"), daysHeld=days_held,
                       netReturnPct=net_return(exit_price, entry))
            break
        stop = stop_for_next_bar(stop, entry, float(bar["High"]))
    return opp


def atomic_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    temporary.replace(path)


def reconcile_daily_swings(raw_dir: Path = config.RAW_DIR) -> dict:
    if not SWING_PREDICTIONS_FILE.exists():
        raise FileNotFoundError("No swing ledger exists. Run the scanner first.")
    setups = json.loads(SWING_PREDICTIONS_FILE.read_text(encoding="utf-8"))
    updated = []
    for opp in setups:
        symbol = opp["symbol"]
        ticker = symbol if symbol.endswith(".NS") else symbol + ".NS"
        filename = ticker.replace("^", "").replace(".", "_") + ".csv"
        file_path = (raw_dir / filename).resolve()
        if file_path.parent != raw_dir.resolve():
            raise ValueError("Invalid ledger symbol")
        if opp.get("status", "watching") in ("watching", "active"):
            if not file_path.exists():
                raise FileNotFoundError(f"Missing market data for {symbol}")
            updated.append(reconcile_setup(opp, pd.read_csv(file_path)))
        else:
            updated.append(opp)
    count = sum(a != b for a, b in zip(setups, updated))
    atomic_json(SWING_PREDICTIONS_FILE, updated)
    summary = {"reconciliation_time": datetime.now().isoformat(),
               "total_setups": len(updated), "updated_count": count}
    atomic_json(SWING_RECONCILED_FILE, summary)
    return summary


if __name__ == "__main__":
    res = reconcile_daily_swings()
    print(f"Reconciliation result: {res}")
