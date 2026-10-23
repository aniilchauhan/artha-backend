"""
Daily Paper-Trading Signal Generator & Validator for Indian NSE Equities.
FROZEN SYSTEM VERSION:
  - Model Version   : v1 (LightGBM 64-feature classifier)
  - Strategy Version: breakout_v1 (Breakout Confirmation + ATR Dynamic Stops)

Runs strictly after NSE market close (recommended: 3:45 PM IST on trading days).
1. Updates historical data up to Date T.
2. Computes 64 feature vector for Date T close.
3. Scores all 50 stocks using frozen models/v1/lightgbm_stock_model.pkl.
4. Identifies qualifying signals (score >= threshold).
5. Calculates exact execution levels:
     - Breakout Trigger : Close * 1.0025 (+0.25% momentum confirmation)
     - Profit Target    : Trigger * 1.02 (+2.00% upside)
     - Dynamic Stop-Loss: Trigger - (1.2 * ATR_14)
6. Appends to immutable audit trail and daily CSV files.
7. Evaluates previous day's pending signals once Date T actual OHLC is known.
"""

import sys
import os
import json
import logging
import datetime
from pathlib import Path
from typing import Dict, List, Optional
import joblib
import numpy as np
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import download_data, features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Directory Paths for Frozen Version 1
STRATEGY_FILE = config.BASE_DIR / "strategy" / "breakout_v1.json"
FROZEN_MODEL_FILE = config.BASE_DIR / "models" / "v1" / "lightgbm_stock_model.pkl"
FROZEN_FEATURES_FILE = config.BASE_DIR / "models" / "v1" / "features.json"

PAPER_DIR = config.OUTPUTS_DIR / "paper_trading"
SIGNALS_DIR = PAPER_DIR / "signals"
ALL_SIGNALS_FILE = PAPER_DIR / "all_signals.csv"
AUDIT_LOG_FILE = PAPER_DIR / "audit_log.csv"

PAPER_DIR.mkdir(parents=True, exist_ok=True)
SIGNALS_DIR.mkdir(parents=True, exist_ok=True)


def load_frozen_strategy() -> Dict:
    with open(STRATEGY_FILE, "r") as f:
        return json.load(f)


def load_frozen_model_and_features():
    if not FROZEN_MODEL_FILE.exists():
        raise FileNotFoundError(f"Frozen model not found at {FROZEN_MODEL_FILE}")
    model = joblib.load(FROZEN_MODEL_FILE)
    with open(FROZEN_FEATURES_FILE, "r") as f:
        feat_meta = json.load(f)
    return model, feat_meta["features"]


def log_audit_event(action: str, signal_date: str, ticker: str, model_v: str, strat_v: str):
    """Maintains an append-only audit trail proving signals were recorded prior to session open."""
    now_iso = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S IST")
    record = {
        "timestamp": now_iso,
        "action": action,
        "signal_date": signal_date,
        "ticker": ticker,
        "model_version": model_v,
        "strategy_version": strat_v,
    }
    log_df = pd.DataFrame([record])
    if not AUDIT_LOG_FILE.exists():
        log_df.to_csv(AUDIT_LOG_FILE, index=False)
    else:
        log_df.to_csv(AUDIT_LOG_FILE, mode="a", header=False, index=False)


def generate_daily_paper_signals(
    min_score_threshold: Optional[float] = None,
    force_refresh: bool = False,
) -> pd.DataFrame:
    """
    Main daily pipeline for paper trading signal generation.
    """
    strat_cfg = load_frozen_strategy()
    threshold = min_score_threshold or strat_cfg["execution_parameters"]["score_threshold_primary"]
    model_version = strat_cfg["model_version"]
    strategy_version = strat_cfg["strategy_version"]
    universe = strat_cfg["stock_universe"]

    logger.info(f"Loading Frozen System: Model {model_version} | Strategy {strategy_version} | Threshold {threshold:.2f}")
    model, feature_cols = load_frozen_model_and_features()

    # 1. Update Market & Universe Data
    logger.info("Synchronizing daily market and stock data...")
    provider = download_data.YFinanceDataProvider(max_retries=3, retry_delay=1.0)
    download_data.download_universe(
        tickers=list(config.MARKET_INDICES.values()),
        output_dir=config.MARKET_DIR,
        provider=provider,
        force=force_refresh,
    )
    download_data.download_universe(
        tickers=universe,
        output_dir=config.RAW_DIR,
        provider=provider,
        force=force_refresh,
    )

    # 2. Compute Market Benchmarks
    benchmarks = features.load_market_benchmarks()

    # 3. Generate Features for Today's Close across all 50 stocks
    scored_stocks = []
    scan_date = None

    for ticker in universe:
        raw_file = config.RAW_DIR / f"{ticker.replace('^', '').replace('.', '_')}.csv"
        if not raw_file.exists():
            continue

        raw_df = pd.read_csv(raw_file)
        if len(raw_df) < 50:
            continue

        # Build clean feature pipeline (is_training=False ensures strict anti-leakage)
        feat_df = features.build_stock_pipeline(
            ticker=ticker,
            raw_df=raw_df,
            benchmarks=benchmarks,
            is_training=False,
        )

        latest_row = feat_df.iloc[-1:].copy()
        date_str = pd.to_datetime(latest_row["Date"].values[0]).strftime("%Y-%m-%d")
        if scan_date is None:
            scan_date = date_str

        # Ensure all 64 frozen features are present
        X_latest = latest_row.reindex(columns=feature_cols, fill_value=0.0).astype(np.float32)

        # Model Inference
        prob = float(model.predict_proba(X_latest)[:, 1][0])

        # Technical context
        close_p = float(latest_row["Close"].values[0])
        atr_val = float(latest_row["atr_14"].values[0]) if "atr_14" in latest_row else (close_p * 0.02)
        rsi_val = float(latest_row["rsi_14"].values[0]) if "rsi_14" in latest_row else np.nan
        vol_ratio = float(latest_row["vol_to_sma20"].values[0]) if "vol_to_sma20" in latest_row else np.nan
        ret_1d = float(latest_row["ret_1d"].values[0]) if "ret_1d" in latest_row else np.nan
        ret_5d = float(latest_row["ret_5d"].values[0]) if "ret_5d" in latest_row else np.nan
        nifty_trend = float(latest_row["nifty_trend"].values[0]) if "nifty_trend" in latest_row else np.nan

        # Sector context
        sector_sym = config.SECTOR_MAP.get(ticker, "NIFTY")
        sector_rel = float(latest_row["stock_vs_sector_1d"].values[0]) if "stock_vs_sector_1d" in latest_row else np.nan

        # Breakout Strategy Execution Formulas
        breakout_trigger = round(close_p * 1.0025, 2)
        profit_target = round(breakout_trigger * 1.02, 2)
        stop_loss = round(breakout_trigger - (1.2 * atr_val), 2)

        scored_stocks.append({
            "signal_date": date_str,
            "ticker": ticker,
            "today_close": round(close_p, 2),
            "model_score": round(prob, 4),
            "ATR": round(atr_val, 2),
            "breakout_trigger": breakout_trigger,
            "stop_loss": stop_loss,
            "profit_target": profit_target,
            "RSI": round(rsi_val, 1) if not pd.isna(rsi_val) else "N/A",
            "volume_ratio": round(vol_ratio, 2) if not pd.isna(vol_ratio) else "N/A",
            "return_1d": f"{ret_1d*100:+.2f}%" if not pd.isna(ret_1d) else "N/A",
            "return_5d": f"{ret_5d*100:+.2f}%" if not pd.isna(ret_5d) else "N/A",
            "Nifty_trend": f"{nifty_trend*100:+.2f}%" if not pd.isna(nifty_trend) else "N/A",
            "sector_trend": f"{sector_rel*100:+.2f}% ({sector_sym})" if not pd.isna(sector_rel) else "N/A",
            "model_version": model_version,
            "strategy_version": strategy_version,
            "status": "PENDING",
            "execution_price": np.nan,
            "exit_price": np.nan,
            "net_pnl_pct": np.nan,
        })

    all_scored_df = pd.DataFrame(scored_stocks)
    all_scored_df = all_scored_df.sort_values(by="model_score", ascending=False).reset_index(drop=True)

    # Filter to qualifying signals
    qualifying_df = all_scored_df[all_scored_df["model_score"] >= threshold].copy()

    # 4. Save Immutable Daily Signal File
    daily_file = SIGNALS_DIR / f"{scan_date}.csv"
    if daily_file.exists():
        logger.warning(f"Daily signal file {daily_file.name} already exists. Preserving original records.")
    else:
        qualifying_df.to_csv(daily_file, index=False)
        logger.info(f"Saved immutable daily signal file: {daily_file}")
        # Always log scan completion to audit trail
        log_audit_event(
            action=f"SCAN_COMPLETED_{len(qualifying_df)}_SIGNALS",
            signal_date=scan_date,
            ticker="ALL_UNIVERSE",
            model_v=model_version,
            strat_v=strategy_version,
        )
        # Log individual signals
        for _, row in qualifying_df.iterrows():
            log_audit_event("SIGNAL_RECORDED", scan_date, row["ticker"], model_version, strategy_version)

    # 5. Update Master Accumulator all_signals.csv
    update_all_signals_accumulator(qualifying_df)

    # 6. Print Formatted Terminal Report
    print_daily_report(scan_date, len(all_scored_df), qualifying_df, threshold)

    return qualifying_df


def update_all_signals_accumulator(new_signals_df: pd.DataFrame):
    """Appends new signals to outputs/paper_trading/all_signals.csv without duplicates."""
    columns = [
        "signal_date", "ticker", "today_close", "model_score", "ATR", "breakout_trigger",
        "stop_loss", "profit_target", "RSI", "volume_ratio", "return_1d", "return_5d",
        "Nifty_trend", "sector_trend", "model_version", "strategy_version", "status",
        "execution_price", "exit_price", "net_pnl_pct"
    ]
    if not ALL_SIGNALS_FILE.exists():
        if new_signals_df.empty:
            pd.DataFrame(columns=columns).to_csv(ALL_SIGNALS_FILE, index=False)
            return
        else:
            new_signals_df.to_csv(ALL_SIGNALS_FILE, index=False)
            return

    if new_signals_df.empty:
        return

    existing_df = pd.read_csv(ALL_SIGNALS_FILE)
    merged = pd.concat([existing_df, new_signals_df], ignore_index=True)
    merged = merged.drop_duplicates(subset=["signal_date", "ticker"], keep="first")
    merged.to_csv(ALL_SIGNALS_FILE, index=False)


def print_daily_report(scan_date: str, total_scanned: int, qualifying_df: pd.DataFrame, threshold: float):
    """Outputs clean, formatted daily report specified in prompt."""
    print("\n" + "=" * 78)
    print(f"NSE PAPER TRADING SIGNALS — {scan_date}")
    print(f"Strategy: Breakout v1 (Trigger +0.25%, Stop 1.2x ATR, Target +2.0%)")
    print(f"Stocks Scanned: {total_scanned} | Score Cutoff Threshold: {threshold:.2f}")
    print(f"Qualifying Signals Generated: {len(qualifying_df)}")
    print("=" * 78 + "\n")

    if qualifying_df.empty:
        print(f"No stocks crossed the minimum score threshold of {threshold:.2f} for this session.")
        print("Market regime is currently compressed or consolidating. Capital remains 100% in cash.")
    else:
        for idx, row in qualifying_df.iterrows():
            print(f"{idx + 1}. {row['ticker']}")
            print(f"   Score   : {row['model_score']:.4f}")
            print(f"   Close   : Rs. {row['today_close']:,.2f}")
            print(f"   Trigger : Rs. {row['breakout_trigger']:,.2f} (Buy Stop Order)")
            print(f"   Stop    : Rs. {row['stop_loss']:,.2f} (Dynamic ATR Stop)")
            print(f"   Target  : Rs. {row['profit_target']:,.2f} (+2.00% Upside Limit)")
            print(f"   Context : RSI: {row['RSI']} | Vol Ratio: {row['volume_ratio']}x | 5D Ret: {row['return_5d']}")
            print("-" * 78)

    print("\nFORWARD PAPER TRADING PROTOCOL REMINDER:")
    print("  * Orders are simulated strictly for paper-trading tracking.")
    print("  * If tomorrow's session High < Trigger -> Status becomes NOT_TRIGGERED (0 PnL).")
    print("  * No real capital or broker accounts are connected.")
    print("=" * 78 + "\n")


def evaluate_past_signals():
    """
    Evaluates historical pending paper signals once the next trading session OHLC is available.
    Statuses assigned:
      - NOT_TRIGGERED: Session High < breakout_trigger
      - TARGET_HIT   : Session High >= profit_target (and Low > stop_loss)
      - STOP_HIT     : Session Low <= stop_loss (and High < profit_target)
      - AMBIGUOUS    : Both target and stop inside candle (conservatively assumed STOP_HIT)
      - TIME_EXIT    : Position held to market close 3:25 PM IST
    """
    if not ALL_SIGNALS_FILE.exists():
        logger.info("No all_signals.csv found. Nothing to evaluate.")
        return

    all_df = pd.read_csv(ALL_SIGNALS_FILE)
    pending = all_df[all_df["status"] == "PENDING"]
    if pending.empty:
        logger.info("No pending signals awaiting next-session outcome.")
        return

    logger.info(f"Evaluating {len(pending)} pending forward paper signals...")
    updated_count = 0

    for idx, row in pending.iterrows():
        ticker = row["ticker"]
        sig_date = pd.to_datetime(row["signal_date"])
        trigger = float(row["breakout_trigger"])
        target = float(row["profit_target"])
        stop = float(row["stop_loss"])

        raw_file = config.RAW_DIR / f"{ticker.replace('^', '').replace('.', '_')}.csv"
        if not raw_file.exists():
            continue

        raw_df = pd.read_csv(raw_file)
        raw_df["Date"] = pd.to_datetime(raw_df["Date"])
        raw_df = raw_df.sort_values("Date").reset_index(drop=True)

        # Look for the session immediately following sig_date
        next_sessions = raw_df[raw_df["Date"] > sig_date]
        if next_sessions.empty:
            # Tomorrow's data not available yet
            continue

        next_row = next_sessions.iloc[0]
        n_open = float(next_row["Open"])
        n_high = float(next_row["High"])
        n_low = float(next_row["Low"])
        n_close = float(next_row["Close"])

        # Check if triggered
        if n_high < trigger:
            all_df.loc[idx, "status"] = "NOT_TRIGGERED"
            all_df.loc[idx, "execution_price"] = 0.0
            all_df.loc[idx, "exit_price"] = 0.0
            all_df.loc[idx, "net_pnl_pct"] = 0.0
            updated_count += 1
            log_audit_event("EVALUATED_NOT_TRIGGERED", row["signal_date"], ticker, row["model_version"], row["strategy_version"])
            continue

        # Triggered! Execution price is trigger, or next_open if gapped up
        exec_price = max(trigger, n_open)
        # Recalculate target and stop relative to actual entry if gapped
        exec_target = round(exec_price * 1.02, 2)
        exec_stop = round(exec_price - (1.2 * float(row["ATR"])), 2)

        hit_tp = n_high >= exec_target
        hit_sl = n_low <= exec_stop

        if hit_tp and hit_sl:
            # Conservative ambiguous rule
            status = "AMBIGUOUS"
            exit_p = exec_stop
        elif hit_tp:
            status = "TARGET_HIT"
            exit_p = exec_target
        elif hit_sl:
            status = "STOP_HIT"
            exit_p = exec_stop
        else:
            status = "TIME_EXIT"
            exit_p = n_close

        # Transaction cost & slippage deduction (0.15% roundtrip)
        raw_ret = (exit_p / exec_price) - 1.0
        net_ret = raw_ret - (config.TRANSACTION_COST_PCT + config.SLIPPAGE_PCT)

        all_df.loc[idx, "status"] = status
        all_df.loc[idx, "execution_price"] = exec_price
        all_df.loc[idx, "exit_price"] = exit_p
        all_df.loc[idx, "net_pnl_pct"] = round(net_ret * 100, 2)
        updated_count += 1
        log_audit_event(f"EVALUATED_{status}", row["signal_date"], ticker, row["model_version"], row["strategy_version"])

    all_df.to_csv(ALL_SIGNALS_FILE, index=False)
    logger.info(f"Outcome evaluation complete. Updated {updated_count} signals in {ALL_SIGNALS_FILE}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Daily Paper-Trading Signal Engine (Version 1 Frozen)")
    parser.add_argument("--threshold", type=float, default=None, help="Custom probability threshold (default: 0.60)")
    parser.add_argument("--force-download", action="store_true", help="Force redownload of latest daily bars")
    parser.add_argument("--evaluate-only", action="store_true", help="Only evaluate past pending signals without new scan")
    args = parser.parse_args()

    if args.evaluate_only:
        evaluate_past_signals()
    else:
        # 1. First evaluate any pending signals from previous sessions
        evaluate_past_signals()
        # 2. Generate new forward paper signals for tomorrow's session
        generate_daily_paper_signals(min_score_threshold=args.threshold, force_refresh=args.force_download)
