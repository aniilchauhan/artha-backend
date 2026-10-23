"""
Multi-Session Swing Dataset Generator with Purged Walk-Forward Splitting.
Implements the 20-session breakout strategy, realistic gap-down stop fills,
0.15% friction accounting, and strict overlap leakage prevention (purging & embargoing).
Per docs/SWING_TARGET_SPECIFICATION.md.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.swing_universe import get_eligible_swing_universe
from src.swing_execution import resolve_exit, stop_for_next_bar

logger = logging.getLogger(__name__)

# Constants
TARGET_GAIN_PCT = 0.10        # +10.0%
MAX_STOP_LOSS_PCT = 0.05      # -5.0% maximum loss cap
VALIDITY_WINDOW_DAYS = 3      # 3 trading sessions to trigger
PRIMARY_HORIZON_DAYS = 20     # 20 trading sessions primary limit
TRANSACTION_FRICTION = 0.0015 # 0.15% round-trip (STT, brokerage, exchange fees, slippage)
DEFAULT_SLIPPAGE = 0.0005     # 0.05% execution slippage on entry

SWING_DATASET_PARQUET = config.PROCESSED_DIR / "swing_dataset.parquet"
SWING_DATASET_CSV = config.PROCESSED_DIR / "swing_dataset.csv"


def generate_stock_swing_labels(
    ticker: str,
    df: pd.DataFrame,
    horizon_days: int = PRIMARY_HORIZON_DAYS,
    validity_days: int = VALIDITY_WINDOW_DAYS,
) -> pd.DataFrame:
    """
    Generates multi-session outcome labels for a single stock using historical daily bars.
    Simulates:
    1. Consolidation resistance breakout trigger (20-day high + 0.2%).
    2. 3-day entry validity window.
    3. Gap abort (>3%) and realistic fill price.
    4. 20-session outcome walker with gap-down stop fills (Open < Stop -> fill = Open).
    5. Net returns after 0.15% friction.
    """
    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Open", "High", "Low", "Close"]).reset_index(drop=True)

    n = len(df)
    if n < 40:
        return pd.DataFrame()

    # 20-session rolling high (resistance)
    df["Resistance_20d"] = df["High"].rolling(window=20).max()
    df["LowestLow_5d"] = df["Low"].rolling(window=5).min()

    records = []
    # Loop over candidate signal dates
    # Need at least 20 historical bars for resistance, plus validity + horizon
    for i in range(20, n - 1):
        signal_date = df["Date"].iloc[i]
        signal_close = df["Close"].iloc[i]
        res_20d = df["Resistance_20d"].iloc[i]
        prior_5d_low = df["LowestLow_5d"].iloc[i]

        # Breakout setup candidate: Close within 3% of 20-day resistance
        if signal_close < (res_20d * 0.97):
            continue

        trigger_price = res_20d * 1.002  # 0.2% above 20d resistance

        # Walk forward through validity window (up to validity_days sessions)
        entry_idx = None
        entry_price = None
        entry_date = None
        gap_skipped = False

        for k in range(1, validity_days + 1):
            cand_idx = i + k
            if cand_idx >= n:
                break

            cand_open = df["Open"].iloc[cand_idx]
            cand_high = df["High"].iloc[cand_idx]

            # Check for opening gap above trigger
            if cand_open > trigger_price:
                if cand_open > (trigger_price * 1.03):
                    # Gap too large (>3% chase), trade aborted
                    gap_skipped = True
                    break
                else:
                    # Filled at open with slippage
                    entry_idx = cand_idx
                    entry_price = cand_open * (1 + DEFAULT_SLIPPAGE)
                    entry_date = df["Date"].iloc[cand_idx]
                    break
            elif cand_high >= trigger_price:
                # Triggered intraday at trigger price with slippage
                entry_idx = cand_idx
                entry_price = trigger_price * (1 + DEFAULT_SLIPPAGE)
                entry_date = df["Date"].iloc[cand_idx]
                break

        if gap_skipped:
            records.append({
                "symbol": ticker,
                "signal_date": signal_date,
                "signal_close": signal_close,
                "trigger_price": trigger_price,
                "entry_date": None,
                "entry_price": None,
                "target_price": None,
                "stop_price": None,
                "outcome": "SKIPPED_GAP_TOO_LARGE",
                "label_10pct": 0,
                "days_held": 0,
                "exit_date": None,
                "exit_price": None,
                "gross_return_pct": 0.0,
                "net_return_pct": 0.0,
                "mfe_pct": 0.0,
                "mae_pct": 0.0,
                "is_active_pending": False,
            })
            continue

        if entry_idx is None:
            # Did not trigger within validity window
            records.append({
                "symbol": ticker,
                "signal_date": signal_date,
                "signal_close": signal_close,
                "trigger_price": trigger_price,
                "entry_date": None,
                "entry_price": None,
                "target_price": None,
                "stop_price": None,
                "outcome": "NO_ENTRY",
                "label_10pct": 0,
                "days_held": 0,
                "exit_date": None,
                "exit_price": None,
                "gross_return_pct": 0.0,
                "net_return_pct": 0.0,
                "mfe_pct": 0.0,
                "mae_pct": 0.0,
                "is_active_pending": False,
            })
            continue

        # Position entered at entry_price
        target_price = entry_price * (1.0 + TARGET_GAIN_PCT)
        structural_stop = prior_5d_low
        capped_stop = entry_price * (1.0 - MAX_STOP_LOSS_PCT)
        stop_price = max(capped_stop, structural_stop)  # tighter stop, max -5%

        # Track forward up to horizon_days sessions
        outcome = "TIME_EXIT"
        exit_price = None
        exit_date = None
        days_held = 0
        highs_seen = []
        lows_seen = []
        is_pending = False
        breakeven_trailed = False

        for h in range(0, horizon_days + 1):
            pos_idx = entry_idx + h
            if pos_idx >= n:
                # Still within holding window but history ended -> Pending trade
                is_pending = True
                days_held = h - 1
                exit_price = df["Close"].iloc[-1]
                exit_date = df["Date"].iloc[-1]
                outcome = "PENDING"
                break

            day_open = df["Open"].iloc[pos_idx]
            day_high = df["High"].iloc[pos_idx]
            day_low = df["Low"].iloc[pos_idx]
            day_close = df["Close"].iloc[pos_idx]
            day_date = df["Date"].iloc[pos_idx]

            highs_seen.append(day_high)
            lows_seen.append(day_low)
            days_held = h

            decision = resolve_exit(
                {"Open": day_open, "High": day_high, "Low": day_low, "Close": day_close},
                entry_price,
                target_price,
                stop_price,
                entry_bar=h == 0 and day_open < trigger_price,
            )
            if decision:
                outcome = "TARGET_HIT" if decision["status"] == "target_hit" else ("BREAKEVEN_EXIT" if breakeven_trailed else "STOP_HIT")
                exit_price = decision["exit_price"]
                exit_date = day_date
                break

            next_stop = stop_for_next_bar(stop_price, entry_price, day_high)
            breakeven_trailed = breakeven_trailed or next_stop > stop_price
            stop_price = next_stop

            # 4. If reached last holding day without target or stop
            if h == horizon_days:
                outcome = "TIME_EXIT"
                exit_price = day_close
                exit_date = day_date
                break

        if is_pending:
            gross_ret = (exit_price - entry_price) / entry_price if exit_price else 0.0
            net_ret = gross_ret - TRANSACTION_FRICTION
            mfe = (max(highs_seen) - entry_price) / entry_price if highs_seen else 0.0
            mae = (min(lows_seen) - entry_price) / entry_price if lows_seen else 0.0
            records.append({
                "symbol": ticker,
                "signal_date": signal_date,
                "signal_close": signal_close,
                "trigger_price": trigger_price,
                "entry_date": entry_date,
                "entry_price": entry_price,
                "target_price": target_price,
                "stop_price": stop_price,
                "outcome": "PENDING",
                "label_10pct": 0,
                "days_held": days_held,
                "exit_date": exit_date,
                "exit_price": exit_price,
                "gross_return_pct": gross_ret,
                "net_return_pct": net_ret,
                "mfe_pct": mfe,
                "mae_pct": mae,
                "is_active_pending": True,
            })
            continue

        gross_ret = (exit_price - entry_price) / entry_price
        net_ret = gross_ret - TRANSACTION_FRICTION
        mfe = (max(highs_seen) - entry_price) / entry_price if highs_seen else 0.0
        mae = (min(lows_seen) - entry_price) / entry_price if lows_seen else 0.0

        records.append({
            "symbol": ticker,
            "signal_date": signal_date,
            "signal_close": signal_close,
            "trigger_price": trigger_price,
            "entry_date": entry_date,
            "entry_price": entry_price,
            "target_price": target_price,
            "stop_price": stop_price,
            "outcome": outcome,
            "label_10pct": 1 if outcome == "TARGET_HIT" else 0,
            "days_held": days_held,
            "exit_date": exit_date,
            "exit_price": exit_price,
            "gross_return_pct": gross_ret,
            "net_return_pct": net_ret,
            "mfe_pct": mfe,
            "mae_pct": mae,
            "is_active_pending": False,
        })

    return pd.DataFrame(records)


def build_swing_outcome_dataset(
    tickers: Optional[List[str]] = None,
    raw_dir: Path = config.RAW_DIR,
    horizon_days: int = PRIMARY_HORIZON_DAYS,
    save_files: bool = True,
) -> pd.DataFrame:
    """Builds the consolidated swing outcome dataset across all eligible tickers."""
    if tickers is None:
        tickers = get_eligible_swing_universe()

    all_dfs = []
    for ticker in tickers:
        safe_filename = ticker.replace("^", "").replace(".", "_") + ".csv"
        file_path = raw_dir / safe_filename
        if not file_path.exists():
            continue

        try:
            df = pd.read_csv(file_path)
            labeled_df = generate_stock_swing_labels(ticker, df, horizon_days=horizon_days)
            if not labeled_df.empty:
                all_dfs.append(labeled_df)
        except Exception as e:
            logger.debug(f"Error labeling {ticker}: {e}")

    if not all_dfs:
        return pd.DataFrame()

    full_df = pd.concat(all_dfs, ignore_index=True)
    full_df["signal_date"] = pd.to_datetime(full_df["signal_date"])
    full_df = full_df.sort_values(["signal_date", "symbol"]).reset_index(drop=True)

    if save_files:
        config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
        full_df.to_parquet(SWING_DATASET_PARQUET, index=False)
        full_df.to_csv(SWING_DATASET_CSV, index=False)
        logger.info(f"Saved swing outcome dataset: {len(full_df)} rows to {SWING_DATASET_PARQUET}")

    return full_df


def purged_train_test_split(
    df: pd.DataFrame,
    train_end_date: str = "2024-06-30",
    val_start_date: str = "2024-07-01",
    val_end_date: str = "2025-06-30",
    test_start_date: str = "2025-07-01",
    horizon_days: int = PRIMARY_HORIZON_DAYS,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Chronological Train/Val/Test Split with Purging and Embargoing.
    Any observation whose forward evaluation window overlaps a partition boundary is purged.
    """
    df = df.copy()
    df["signal_date"] = pd.to_datetime(df["signal_date"])

    train_end = pd.to_datetime(train_end_date)
    val_start = pd.to_datetime(val_start_date)
    val_end = pd.to_datetime(val_end_date)
    test_start = pd.to_datetime(test_start_date)

    # Purge window: signals within (horizon_days + 3) days before train_end bleed into val!
    purge_buffer_days = pd.Timedelta(days=int((horizon_days + 3) * 1.5))

    train_cutoff = train_end - purge_buffer_days
    val_cutoff = val_end - purge_buffer_days

    # Train partition
    train_df = df[df["signal_date"] <= train_cutoff].copy()

    # Val partition (starts strictly after val_start, ends before val_cutoff)
    val_df = df[(df["signal_date"] >= val_start) & (df["signal_date"] <= val_cutoff)].copy()

    # Test partition (strictly after test_start)
    test_df = df[df["signal_date"] >= test_start].copy()

    logger.info(
        f"Purged Split: Train={len(train_df)} (up to {train_cutoff.date()}), "
        f"Val={len(val_df)} ({val_start.date()} to {val_cutoff.date()}), "
        f"Test={len(test_df)} (from {test_start.date()})"
    )

    return train_df, val_df, test_df


if __name__ == "__main__":
    df_outcomes = build_swing_outcome_dataset()
    print(f"Total swing setups: {len(df_outcomes)}")
    print("\nOutcome distribution for triggered entries:")
    triggered = df_outcomes[~df_outcomes["outcome"].isin(["NO_ENTRY", "SKIPPED_GAP_TOO_LARGE"])]
    print(triggered["outcome"].value_counts(normalize=True).round(3))
    print(f"\nAverage Net Return on Triggered Trades: {triggered['net_return_pct'].mean()*100:.2f}%")
