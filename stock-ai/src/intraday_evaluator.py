"""
Intraday Paper-Trading Result Evaluator for Frozen breakout_v1 Strategy.
Reads immutable signals from outputs/paper_trading/signals/, fetches fine-grained
1-minute (or 5-minute fallback) intraday candles, and walks chronologically to determine
the exact sequence of execution:
  - NOT_TRIGGERED : Session High never reaches breakout trigger
  - TARGET_HIT    : Profit target touched before stop loss
  - STOP_HIT      : Stop loss touched before profit target
  - AMBIGUOUS     : Both target and stop touched inside the same intraday candle
  - TIME_EXIT     : Neither target nor stop touched before 15:25 IST market close
  - DATA_MISSING  : Intraday data unavailable for the target date

Strict anti-hindsight rules:
  - Signals from outputs/paper_trading/signals/ are treated as read-only and immutable.
  - Applies frozen transaction costs (0.10%) and slippage (0.05%) = 0.15% roundtrip.
  - Saves outputs to outputs/paper_trading/results/ and outputs/paper_trading/all_results.csv.
"""

import sys
import os
import json
import logging
import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
import yfinance as yf

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

SIGNALS_DIR = config.OUTPUTS_DIR / "paper_trading" / "signals"
RESULTS_DIR = config.OUTPUTS_DIR / "paper_trading" / "results"
ALL_RESULTS_FILE = config.OUTPUTS_DIR / "paper_trading" / "all_results.csv"
INTRADAY_CACHE_DIR = config.BASE_DIR / "data" / "intraday"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)
INTRADAY_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def fetch_intraday_candles(
    ticker: str,
    target_date: str,
    preferred_interval: str = "1m",
    force_download: bool = False,
) -> Tuple[Optional[pd.DataFrame], str]:
    """
    Fetches intraday bars for a specific ticker and target trade date.
    Primary: 1m interval (available for last ~7 days).
    Fallback: 5m interval (available for last ~60 days).
    Returns (df, interval_used).
    """
    safe_sym = ticker.replace("^", "").replace(".", "_")
    cache_file_1m = INTRADAY_CACHE_DIR / f"{safe_sym}_1m.parquet"
    cache_file_5m = INTRADAY_CACHE_DIR / f"{safe_sym}_5m.parquet"

    target_dt = pd.to_datetime(target_date).date()

    # 1. Try 1-minute data
    df_1m = None
    if not force_download and cache_file_1m.exists():
        try:
            df_1m = pd.read_parquet(cache_file_1m)
        except Exception:
            df_1m = None

    if df_1m is None or force_download or (not df_1m.empty and df_1m.index.date.max() < target_dt):
        try:
            logger.info(f"Downloading 1m intraday data for {ticker}...")
            df_1m = yf.download(ticker, period="7d", interval="1m", progress=False)
            if isinstance(df_1m.columns, pd.MultiIndex):
                df_1m.columns = df_1m.columns.get_level_values(0)
            if not df_1m.empty:
                # Ensure Asia/Kolkata timezone
                if df_1m.index.tz is None:
                    df_1m.index = df_1m.index.tz_localize("Asia/Kolkata")
                else:
                    df_1m.index = df_1m.index.tz_convert("Asia/Kolkata")
                df_1m.to_parquet(cache_file_1m)
        except Exception as e:
            logger.warning(f"Failed to fetch 1m data for {ticker}: {e}")
            df_1m = None

    if df_1m is not None and not df_1m.empty:
        session_1m = df_1m[df_1m.index.date == target_dt]
        if not session_1m.empty and len(session_1m) >= 10:
            return session_1m.copy(), "1m"

    # 2. Fallback to 5-minute data if 1-minute is unavailable/expired
    df_5m = None
    if not force_download and cache_file_5m.exists():
        try:
            df_5m = pd.read_parquet(cache_file_5m)
        except Exception:
            df_5m = None

    if df_5m is None or force_download or (not df_5m.empty and df_5m.index.date.max() < target_dt):
        try:
            logger.info(f"Downloading 5m fallback data for {ticker}...")
            df_5m = yf.download(ticker, period="60d", interval="5m", progress=False)
            if isinstance(df_5m.columns, pd.MultiIndex):
                df_5m.columns = df_5m.columns.get_level_values(0)
            if not df_5m.empty:
                if df_5m.index.tz is None:
                    df_5m.index = df_5m.index.tz_localize("Asia/Kolkata")
                else:
                    df_5m.index = df_5m.index.tz_convert("Asia/Kolkata")
                df_5m.to_parquet(cache_file_5m)
        except Exception as e:
            logger.warning(f"Failed to fetch 5m fallback data for {ticker}: {e}")
            df_5m = None

    if df_5m is not None and not df_5m.empty:
        session_5m = df_5m[df_5m.index.date == target_dt]
        if not session_5m.empty and len(session_5m) >= 5:
            return session_5m.copy(), "5m"

    return None, "NONE"


def get_next_trading_date(ticker: str, signal_date: str) -> Optional[str]:
    """Finds the chronological next trading session date from daily raw historical files."""
    safe_sym = ticker.replace("^", "").replace(".", "_")
    daily_file = config.RAW_DIR / f"{safe_sym}.csv"
    if not daily_file.exists():
        return None

    df_daily = pd.read_csv(daily_file)
    df_daily["Date"] = pd.to_datetime(df_daily["Date"])
    sig_dt = pd.to_datetime(signal_date)

    future_dates = df_daily[df_daily["Date"] > sig_dt].sort_values("Date")
    if future_dates.empty:
        return None

    return future_dates.iloc[0]["Date"].strftime("%Y-%m-%d")


def evaluate_signal_intraday(
    signal_row: pd.Series,
    preferred_interval: str = "1m",
    force_download: bool = False,
) -> Dict:
    """
    Evaluates a single immutable signal by walking intraday candles chronologically.
    """
    ticker = signal_row["ticker"]
    signal_date = str(signal_row["signal_date"])
    model_score = float(signal_row["model_score"])
    trigger = float(signal_row["breakout_trigger"])
    target = float(signal_row["profit_target"])
    stop = float(signal_row["stop_loss"])
    model_v = str(signal_row.get("model_version", "v1"))
    strat_v = str(signal_row.get("strategy_version", "breakout_v1"))

    # Determine trade date
    trade_date = get_next_trading_date(ticker, signal_date)
    if trade_date is None:
        return {
            "signal_date": signal_date,
            "trade_date": "PENDING",
            "ticker": ticker,
            "model_score": model_score,
            "trigger": trigger,
            "entry_time": "N/A",
            "entry_price": 0.0,
            "stop": stop,
            "target": target,
            "exit_time": "N/A",
            "exit_price": 0.0,
            "status": "PENDING",
            "interval_used": "NONE",
            "gross_return_pct": 0.0,
            "cost_pct": 0.0,
            "net_return_pct": 0.0,
            "model_version": model_v,
            "strategy_version": strat_v,
        }

    # Fetch intraday candles
    intraday_df, interval_used = fetch_intraday_candles(
        ticker, trade_date, preferred_interval=preferred_interval, force_download=force_download
    )

    if intraday_df is None or intraday_df.empty:
        return {
            "signal_date": signal_date,
            "trade_date": trade_date,
            "ticker": ticker,
            "model_score": model_score,
            "trigger": trigger,
            "entry_time": "N/A",
            "entry_price": 0.0,
            "stop": stop,
            "target": target,
            "exit_time": "N/A",
            "exit_price": 0.0,
            "status": "DATA_MISSING",
            "interval_used": interval_used,
            "gross_return_pct": 0.0,
            "cost_pct": 0.0,
            "net_return_pct": 0.0,
            "model_version": model_v,
            "strategy_version": strat_v,
        }

    # Sort candles chronologically
    intraday_df = intraday_df.sort_index()

    # Step 1: Walk to find trigger candle
    is_triggered = False
    entry_idx = -1
    entry_time = None
    entry_price = 0.0

    for idx, (ts, candle) in enumerate(intraday_df.iterrows()):
        c_open = float(candle["Open"])
        c_high = float(candle["High"])

        # Check trigger
        if c_open > trigger:
            # Gapped up above trigger at candle open
            is_triggered = True
            entry_idx = idx
            entry_time = ts.strftime("%H:%M:%S IST")
            entry_price = c_open
            break
        elif c_high >= trigger:
            # Trigger crossed intraday
            is_triggered = True
            entry_idx = idx
            entry_time = ts.strftime("%H:%M:%S IST")
            entry_price = trigger
            break

    if not is_triggered:
        return {
            "signal_date": signal_date,
            "trade_date": trade_date,
            "ticker": ticker,
            "model_score": model_score,
            "trigger": trigger,
            "entry_time": "N/A",
            "entry_price": 0.0,
            "stop": stop,
            "target": target,
            "exit_time": "N/A",
            "exit_price": 0.0,
            "status": "NOT_TRIGGERED",
            "interval_used": interval_used,
            "gross_return_pct": 0.0,
            "cost_pct": 0.0,
            "net_return_pct": 0.0,
            "model_version": model_v,
            "strategy_version": strat_v,
        }

    # Step 2: Walk candles chronologically starting from entry candle
    # If entry gapped, recalculate target and stop relative to executed entry_price
    effective_target = round(entry_price * 1.02, 2)
    # Stop distance from original calculation
    atr_dist = round(trigger - stop, 2)
    effective_stop = round(entry_price - atr_dist, 2)

    status = None
    exit_time = None
    exit_price = 0.0

    total_candles = len(intraday_df)
    candles_list = list(intraday_df.iloc[entry_idx:].iterrows())

    for k, (ts, candle) in enumerate(candles_list):
        c_open = float(candle["Open"])
        c_high = float(candle["High"])
        c_low = float(candle["Low"])
        c_close = float(candle["Close"])

        # For subsequent candles (k > 0), check opening gaps
        if k > 0:
            if c_open >= effective_target:
                status = "TARGET_HIT"
                exit_time = ts.strftime("%H:%M:%S IST")
                exit_price = c_open
                break
            elif c_open <= effective_stop:
                status = "STOP_HIT"
                exit_time = ts.strftime("%H:%M:%S IST")
                exit_price = c_open
                break

        # Check candle extreme reaches
        hit_tp = (c_high >= effective_target)
        hit_sl = (c_low <= effective_stop)

        if hit_tp and hit_sl:
            # Same-candle ambiguity: Both target and stop touched inside same candle!
            status = "AMBIGUOUS"
            exit_time = ts.strftime("%H:%M:%S IST")
            exit_price = effective_stop  # Conservative assumption
            break
        elif hit_tp:
            status = "TARGET_HIT"
            exit_time = ts.strftime("%H:%M:%S IST")
            exit_price = effective_target
            break
        elif hit_sl:
            status = "STOP_HIT"
            exit_time = ts.strftime("%H:%M:%S IST")
            exit_price = effective_stop
            break

        # Check time exit (15:25 IST or final candle of session)
        is_last_candle = (k == len(candles_list) - 1)
        is_market_close = (ts.hour == 15 and ts.minute >= 25)

        if is_last_candle or is_market_close:
            status = "TIME_EXIT"
            exit_time = ts.strftime("%H:%M:%S IST")
            exit_price = c_close
            break

    # Step 3: Compute exact return after transaction cost (0.10%) and slippage (0.05%)
    friction_pct = (config.TRANSACTION_COST_PCT + config.SLIPPAGE_PCT) * 100.0  # 0.15%
    gross_return_pct = ((exit_price / entry_price) - 1.0) * 100.0
    net_return_pct = gross_return_pct - friction_pct

    return {
        "signal_date": signal_date,
        "trade_date": trade_date,
        "ticker": ticker,
        "model_score": model_score,
        "trigger": trigger,
        "entry_time": entry_time,
        "entry_price": round(entry_price, 2),
        "stop": effective_stop,
        "target": effective_target,
        "exit_time": exit_time,
        "exit_price": round(exit_price, 2),
        "status": status,
        "interval_used": interval_used,
        "gross_return_pct": round(gross_return_pct, 2),
        "cost_pct": round(friction_pct, 2),
        "net_return_pct": round(net_return_pct, 2),
        "model_version": model_v,
        "strategy_version": strat_v,
    }


def evaluate_daily_signal_file(
    signal_file: Path,
    preferred_interval: str = "1m",
    force_download: bool = False,
) -> pd.DataFrame:
    """Evaluates one immutable signal CSV file and writes to results/."""
    logger.info(f"Evaluating immutable signal file: {signal_file.name}")
    signals_df = pd.read_csv(signal_file)

    results = []
    for _, row in signals_df.iterrows():
        res = evaluate_signal_intraday(
            row, preferred_interval=preferred_interval, force_download=force_download
        )
        results.append(res)

    results_df = pd.DataFrame(results)

    # Save daily result file
    res_daily_file = RESULTS_DIR / signal_file.name
    results_df.to_csv(res_daily_file, index=False)
    logger.info(f"Saved intraday results to: {res_daily_file}")

    # Append / update all_results.csv
    update_all_results_accumulator(results_df)

    return results_df


def update_all_results_accumulator(new_results_df: pd.DataFrame):
    """Appends to outputs/paper_trading/all_results.csv without duplicates on (signal_date, ticker)."""
    if new_results_df.empty:
        return

    columns = [
        "signal_date", "trade_date", "ticker", "model_score", "trigger",
        "entry_time", "entry_price", "stop", "target", "exit_time", "exit_price",
        "status", "interval_used", "gross_return_pct", "cost_pct", "net_return_pct",
        "model_version", "strategy_version"
    ]

    if not ALL_RESULTS_FILE.exists():
        new_results_df[columns].to_csv(ALL_RESULTS_FILE, index=False)
    else:
        existing_df = pd.read_csv(ALL_RESULTS_FILE)
        merged = pd.concat([existing_df, new_results_df[columns]], ignore_index=True)
        merged = merged.drop_duplicates(subset=["signal_date", "ticker"], keep="last")
        merged.to_csv(ALL_RESULTS_FILE, index=False)


def evaluate_all_signal_files(preferred_interval: str = "1m", force_download: bool = False):
    """Evaluates all immutable signal files found in signals/."""
    signal_files = sorted(list(SIGNALS_DIR.glob("*.csv")))
    if not signal_files:
        logger.info("No signal files found in signals/. Run daily_paper_signal.py first.")
        return

    logger.info(f"Found {len(signal_files)} daily signal files to evaluate.")
    for s_file in signal_files:
        evaluate_daily_signal_file(s_file, preferred_interval=preferred_interval, force_download=force_download)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Intraday Paper-Trading Result Evaluator (breakout_v1)")
    parser.add_argument("--date", type=str, default=None, help="Specific signal date (YYYY-MM-DD) to evaluate")
    parser.add_argument("--interval", type=str, default="1m", choices=["1m", "5m"], help="Preferred intraday candle interval")
    parser.add_argument("--force-download", action="store_true", help="Force redownload of intraday parquet bars")
    args = parser.parse_args()

    if args.date:
        sig_file = SIGNALS_DIR / f"{args.date}.csv"
        if not sig_file.exists():
            logger.error(f"Signal file not found: {sig_file}")
            sys.exit(1)
        evaluate_daily_signal_file(sig_file, preferred_interval=args.interval, force_download=args.force_download)
    else:
        evaluate_all_signal_files(preferred_interval=args.interval, force_download=args.force_download)
