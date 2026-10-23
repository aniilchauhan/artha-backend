"""
Swing Trading Universe Eligibility and Liquidity Audit Module.
Identifies and maintains the list of liquid Indian NSE cash equities suitable for
multi-session 10% swing trading, avoiding illiquid stocks, circuit locks, and survivorship bias.
"""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

logger = logging.getLogger(__name__)

# Minimum eligibility thresholds per docs/SWING_TARGET_SPECIFICATION.md
MIN_MEDIAN_TURNOVER_INR = 100_000_000  # ₹10 Crore (100M INR)
MIN_AVG_VOLUME = 250_000               # 250,000 shares daily
MIN_SHARE_PRICE = 20.0                 # ₹20 to exclude penny stocks
MAX_CIRCUIT_PCT = 0.02                 # Maximum 2% circuit-locked days allowed
MIN_CONTINUITY_PCT = 0.90              # Minimum 90% trading session continuity

OUTPUT_UNIVERSE_CSV = config.OUTPUTS_DIR / "swing_universe_membership.csv"


def evaluate_ticker_liquidity(df: pd.DataFrame, ticker: str) -> Dict:
    """Evaluates liquidity, continuity, price levels, and circuit risks for a single stock."""
    if len(df) < 60:
        return {
            "symbol": ticker,
            "eligible": False,
            "exclusion_reason": "INSUFFICIENT_HISTORY (<60 sessions)",
            "median_turnover_inr": 0.0,
            "avg_volume": 0.0,
            "latest_close": 0.0,
            "circuit_pct": 0.0,
            "continuity_pct": 0.0,
        }

    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    # Clean & validate prices
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    if len(df) < 60:
        return {
            "symbol": ticker,
            "eligible": False,
            "exclusion_reason": "INVALID_PRICE_DATA",
            "median_turnover_inr": 0.0,
            "avg_volume": 0.0,
            "latest_close": 0.0,
            "circuit_pct": 0.0,
            "continuity_pct": 0.0,
        }

    # Turnover = Close * Volume
    df["Turnover"] = df["Close"] * df["Volume"]

    recent_20 = df.tail(20)
    median_turnover = float(recent_20["Turnover"].median())
    avg_volume = float(recent_20["Volume"].mean())
    latest_close = float(df["Close"].iloc[-1])

    # Circuit day = High == Low and High > 0
    circuit_days = (df["High"] == df["Low"]) & (df["High"] > 0)
    circuit_pct = float(circuit_days.mean())

    # Continuity: gap in trading days relative to business days
    trading_days = len(df)
    date_range = (df["Date"].max() - df["Date"].min()).days
    expected_days = max(1, date_range * 5 // 7)  # approx weekday count
    continuity_pct = min(1.0, float(trading_days / expected_days))

    # Evaluate criteria
    reasons = []
    if latest_close < MIN_SHARE_PRICE:
        reasons.append(f"PRICE_TOO_LOW (<₹{MIN_SHARE_PRICE:.0f})")
    if median_turnover < MIN_MEDIAN_TURNOVER_INR:
        reasons.append(f"LOW_TURNOVER (₹{median_turnover/1e7:.1f} Cr < ₹{MIN_MEDIAN_TURNOVER_INR/1e7:.0f} Cr)")
    if avg_volume < MIN_AVG_VOLUME:
        reasons.append(f"LOW_VOLUME ({avg_volume:,.0f} < {MIN_AVG_VOLUME:,.0f})")
    if circuit_pct > MAX_CIRCUIT_PCT:
        reasons.append(f"CIRCUIT_PRONE ({circuit_pct*100:.1f}% locked)")
    if continuity_pct < MIN_CONTINUITY_PCT:
        reasons.append(f"INSUFFICIENT_CONTINUITY ({continuity_pct*100:.1f}%)")

    eligible = len(reasons) == 0
    reason_str = "ELIGIBLE" if eligible else "; ".join(reasons)

    return {
        "symbol": ticker,
        "eligible": eligible,
        "exclusion_reason": reason_str,
        "median_turnover_inr": median_turnover,
        "avg_volume": avg_volume,
        "latest_close": latest_close,
        "circuit_pct": circuit_pct,
        "continuity_pct": continuity_pct,
    }


def audit_universe_eligibility(
    tickers: Optional[List[str]] = None,
    raw_dir: Path = config.RAW_DIR,
    save_csv: bool = True,
) -> pd.DataFrame:
    """Audits a list of tickers (or full universe default) and saves membership ledger."""
    if tickers is None:
        if raw_dir.exists():
            tickers = [
                f.replace(".csv", "").replace("_", ".")
                for f in os.listdir(raw_dir)
                if f.endswith(".csv") and not f.startswith("^")
            ]
        if not tickers:
            tickers = config.get_stock_universe(mode="full")

    records = []
    for ticker in tickers:
        safe_filename = ticker.replace("^", "").replace(".", "_") + ".csv"
        file_path = raw_dir / safe_filename
        if not file_path.exists():
            records.append({
                "symbol": ticker,
                "eligible": False,
                "exclusion_reason": "FILE_NOT_FOUND",
                "median_turnover_inr": 0.0,
                "avg_volume": 0.0,
                "latest_close": 0.0,
                "circuit_pct": 0.0,
                "continuity_pct": 0.0,
            })
            continue

        try:
            df = pd.read_csv(file_path)
            record = evaluate_ticker_liquidity(df, ticker)
            records.append(record)
        except Exception as e:
            records.append({
                "symbol": ticker,
                "eligible": False,
                "exclusion_reason": f"READ_ERROR: {str(e)[:40]}",
                "median_turnover_inr": 0.0,
                "avg_volume": 0.0,
                "latest_close": 0.0,
                "circuit_pct": 0.0,
                "continuity_pct": 0.0,
            })

    result_df = pd.DataFrame(records)
    if save_csv:
        config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        result_df.to_csv(OUTPUT_UNIVERSE_CSV, index=False)
        logger.info(f"Saved universe audit to {OUTPUT_UNIVERSE_CSV} ({result_df['eligible'].sum()} eligible)")

    return result_df


def get_eligible_swing_universe() -> List[str]:
    """Returns the list of audited eligible tickers for swing trading."""
    if OUTPUT_UNIVERSE_CSV.exists():
        df = pd.read_csv(OUTPUT_UNIVERSE_CSV)
        eligible = df[df["eligible"] == True]["symbol"].tolist()
        if len(eligible) > 0:
            return eligible
    df = audit_universe_eligibility()
    return df[df["eligible"] == True]["symbol"].tolist()


if __name__ == "__main__":
    df_audit = audit_universe_eligibility()
    print(f"Total tickers audited: {len(df_audit)}")
    print(f"Eligible for swing trading: {df_audit['eligible'].sum()}")
    print(df_audit.head(10)[["symbol", "eligible", "median_turnover_inr", "exclusion_reason"]])
