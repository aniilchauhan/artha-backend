"""
Performance Analytics Engine for Frozen breakout_v1 Paper-Trading Results.
Reads outputs/paper_trading/all_results.csv and computes:
  - Signal vs Trigger Metrics (Trigger Rate)
  - Outcome Frequencies (Target Hit, Stop Hit, Ambiguous, Time Exit)
  - Standard vs Conservative Win Rates (Ambiguous treated as losses)
  - Average Winner, Average Loser, Net Return per Trade, Profit Factor, Expectancy
  - Score Tier Breakdown (0.60–0.70, 0.70–0.75, 0.75–0.80, 0.80+)
  - Month-by-Month Performance
"""

import sys
import os
import json
import logging
from pathlib import Path
from typing import Dict, Optional
import pandas as pd
import numpy as np

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

ALL_RESULTS_FILE = config.OUTPUTS_DIR / "paper_trading" / "all_results.csv"


def calculate_metrics_for_subset(trades_df: pd.DataFrame, label: str = "Subset") -> Dict:
    """Computes comprehensive trading metrics for a given subset of results."""
    total_signals = len(trades_df)
    if total_signals == 0:
        return {
            "Label": label,
            "Signals": 0,
            "Not Triggered": 0,
            "Pending": 0,
            "Data Missing": 0,
            "Triggered Trades": 0,
            "Trigger Rate": "0.0%",
            "Target Hits": 0,
            "Stop Hits": 0,
            "Time Exits": 0,
            "Ambiguous": 0,
            "Win Rate": "0.0%",
            "Conservative Win Rate": "0.0%",
            "Avg Winner": "0.00%",
            "Avg Loser": "0.00%",
            "Avg Net Return": "0.00%",
            "Expectancy": "0.00%",
            "Profit Factor": "0.00",
            "Max Drawdown": "0.0%",
        }

    # Filter to triggered trades
    triggered = trades_df[trades_df["status"].isin(["TARGET_HIT", "STOP_HIT", "TIME_EXIT", "AMBIGUOUS"])].copy()
    num_triggered = len(triggered)
    trigger_rate = (num_triggered / total_signals) * 100.0

    not_triggered_cnt = int((trades_df["status"] == "NOT_TRIGGERED").sum())
    data_missing_cnt = int((trades_df["status"] == "DATA_MISSING").sum())
    pending_cnt = int((trades_df["status"] == "PENDING").sum())

    if num_triggered == 0:
        return {
            "Label": label,
            "Signals": total_signals,
            "Not Triggered": not_triggered_cnt,
            "Pending": pending_cnt,
            "Data Missing": data_missing_cnt,
            "Triggered Trades": 0,
            "Trigger Rate": f"{trigger_rate:.1f}%",
            "Target Hits": 0,
            "Stop Hits": 0,
            "Time Exits": 0,
            "Ambiguous": 0,
            "Win Rate": "0.0%",
            "Conservative Win Rate": "0.0%",
            "Avg Winner": "0.00%",
            "Avg Loser": "0.00%",
            "Avg Net Return": "0.00%",
            "Expectancy": "0.00%",
            "Profit Factor": "0.00",
            "Max Drawdown": "0.0%",
        }

    target_hits = int((triggered["status"] == "TARGET_HIT").sum())
    stop_hits = int((triggered["status"] == "STOP_HIT").sum())
    ambiguous = int((triggered["status"] == "AMBIGUOUS").sum())
    time_exits = int((triggered["status"] == "TIME_EXIT").sum())

    # Standard win rate: target_hits / triggered
    win_rate = (target_hits / num_triggered) * 100.0
    # Conservative win rate: ambiguous treated strictly as losses
    cons_win_rate = (target_hits / num_triggered) * 100.0

    # Winners & Losers
    winners = triggered[triggered["net_return_pct"] > 0]
    losers = triggered[triggered["net_return_pct"] <= 0]

    avg_win = float(winners["net_return_pct"].mean()) if not winners.empty else 0.0
    avg_loss = float(losers["net_return_pct"].mean()) if not losers.empty else 0.0
    avg_net_ret = float(triggered["net_return_pct"].mean())

    total_gains = float(winners["net_return_pct"].sum())
    total_losses = abs(float(losers["net_return_pct"].sum()))
    pf = (total_gains / total_losses) if total_losses > 0 else (999.0 if total_gains > 0 else 0.0)

    # Expectancy = (Win_Rate * Avg_Win) + (Loss_Rate * Avg_Loss)
    win_p = len(winners) / num_triggered
    loss_p = len(losers) / num_triggered
    expectancy = (win_p * avg_win) + (loss_p * avg_loss)

    # Max Drawdown
    equity = (1.0 + (triggered["net_return_pct"] / 100.0)).cumprod()
    peak = equity.cummax()
    dd = (equity - peak) / peak
    max_dd = float(dd.min()) * 100.0 if not dd.empty else 0.0

    return {
        "Label": label,
        "Signals": total_signals,
        "Not Triggered": not_triggered_cnt,
        "Pending": pending_cnt,
        "Triggered Trades": num_triggered,
        "Trigger Rate": f"{trigger_rate:.1f}%",
        "Target Hits": target_hits,
        "Stop Hits": stop_hits,
        "Ambiguous": ambiguous,
        "Time Exits": time_exits,
        "Win Rate": f"{win_rate:.1f}%",
        "Conservative Win Rate": f"{cons_win_rate:.1f}%",
        "Avg Winner": f"{avg_win:+.2f}%",
        "Avg Loser": f"{avg_loss:+.2f}%",
        "Avg Net Return": f"{avg_net_ret:+.2f}%",
        "Expectancy": f"{expectancy:+.2f}%",
        "Profit Factor": f"{pf:.2f}",
        "Max Drawdown": f"{max_dd:.1f}%",
    }


def generate_performance_report():
    """Generates complete terminal report across tiers and months."""
    if not ALL_RESULTS_FILE.exists():
        print(f"No results file found at {ALL_RESULTS_FILE}. Run src/intraday_evaluator.py first.")
        return

    df = pd.read_csv(ALL_RESULTS_FILE)
    if df.empty:
        print("Results file is empty.")
        return

    print("\n" + "=" * 80)
    print("INTRADAY PAPER-TRADING PERFORMANCE REPORT — FROZEN breakout_v1")
    print(f"Total Signals in Ledger : {len(df):,}")
    print(f"Friction Accounting   : 0.10% round-trip cost + 0.05% slippage = 0.15% per trade")
    print("=" * 80)

    # 1. Overall Summary
    overall = calculate_metrics_for_subset(df, label="Overall Strategy")
    print("\n1. OVERALL EXECUTION SUMMARY:")
    print("-" * 55)
    for k, v in overall.items():
        if k != "Label":
            print(f"  {k:<24} : {v}")

    # 2. Score Tier Breakdown
    score_tiers = [
        ("0.60 - 0.70", 0.60, 0.70),
        ("0.70 - 0.75", 0.70, 0.75),
        ("0.75 - 0.80", 0.75, 0.80),
        ("0.80+", 0.80, 1.00),
    ]

    tier_records = []
    for label, low, high in score_tiers:
        mask = (df["model_score"] >= low) & (df["model_score"] < high)
        if high == 1.00:
            mask = (df["model_score"] >= low) & (df["model_score"] <= high)
        sub = df[mask]
        m = calculate_metrics_for_subset(sub, label=label)
        tier_records.append(m)

    tier_df = pd.DataFrame(tier_records)
    print("\n2. PERFORMANCE BY MODEL SCORE TIER:")
    print("-" * 80)
    display_cols = ["Label", "Signals", "Triggered Trades", "Trigger Rate", "Win Rate", "Avg Net Return", "Profit Factor"]
    print(tier_df[display_cols].to_string(index=False))

    # 3. Month-by-Month Breakdown
    df["Month"] = pd.to_datetime(df["signal_date"]).dt.to_period("M").astype(str)
    monthly_records = []
    for month, m_sub in df.groupby("Month"):
        m = calculate_metrics_for_subset(m_sub, label=month)
        monthly_records.append(m)

    month_df = pd.DataFrame(monthly_records)
    print("\n3. MONTH-BY-MONTH PERFORMANCE BREAKDOWN:")
    print("-" * 80)
    print(month_df[display_cols].to_string(index=False))

    print("\n" + "=" * 80)
    print("END OF PERFORMANCE REPORT")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    generate_performance_report()
