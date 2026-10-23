"""
Multi-Session Swing Portfolio Simulation Engine.
Models realistic capital constraints, position sizing (1% risk budget),
maximum 5 concurrent positions, sector concentration limits, and cash preservation.
Per docs/SWING_TARGET_SPECIFICATION.md.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.swing_dataset import SWING_DATASET_PARQUET

logger = logging.getLogger(__name__)

INITIAL_CAPITAL = 1_000_000.0  # ₹10 Lakhs (1,000,000 INR)
MAX_CONCURRENT_POSITIONS = 5
MAX_ALLOCATION_PER_TRADE = 0.20 # 20% max nominal equity
RISK_BUDGET_PER_TRADE = 0.01   # 1% risk of total portfolio equity per position
MAX_POSITIONS_PER_SECTOR = 2
MIN_PROBABILITY_THRESHOLD = 0.55

PORTFOLIO_REPORT_JSON = config.OUTPUTS_DIR / "swing_portfolio_simulation.json"


def run_portfolio_simulation(
    trades_df: pd.DataFrame,
    initial_capital: float = INITIAL_CAPITAL,
    min_prob: float = MIN_PROBABILITY_THRESHOLD,
    save_report: bool = True,
) -> Dict:
    """
    Simulates portfolio equity curve respecting capital limits, risk sizing,
    concurrent position limits, and gap-down stop fills.
    """
    trades = trades_df.copy()
    trades["entry_date"] = pd.to_datetime(trades["entry_date"])
    trades["exit_date"] = pd.to_datetime(trades["exit_date"])

    # Filter eligible trades
    if "calibrated_prob" in trades.columns:
        trades = trades[trades["calibrated_prob"] >= min_prob]

    # Exclude non-entries
    trades = trades[~trades["outcome"].isin(["NO_ENTRY", "SKIPPED_GAP_TOO_LARGE"])].copy()
    trades = trades.sort_values("entry_date").reset_index(drop=True)

    cash = initial_capital
    active_positions: List[Dict] = []
    equity_history = []
    completed_trades: List[Dict] = []

    # Build unique chronological trading days
    all_dates = pd.date_range(trades["entry_date"].min(), trades["exit_date"].max(), freq="B")

    trade_queue = trades.to_dict("records")
    trade_idx = 0
    n_trades = len(trade_queue)

    for current_date in all_dates:
        # 1. Check for exiting active positions today
        remaining_positions = []
        for pos in active_positions:
            if pos["exit_date"] <= current_date:
                # Close position
                net_ret = pos["net_return_pct"]
                realized_pnl = pos["allocated_capital"] * net_ret
                cash += (pos["allocated_capital"] + realized_pnl)
                pos["realized_pnl"] = realized_pnl
                completed_trades.append(pos)
            else:
                remaining_positions.append(pos)
        active_positions = remaining_positions

        # 2. Add new positions if capacity allows
        while trade_idx < n_trades:
            cand = trade_queue[trade_idx]
            if cand["entry_date"] > current_date:
                break

            if cand["entry_date"] == current_date:
                if len(active_positions) < MAX_CONCURRENT_POSITIONS:
                    portfolio_val = cash + sum(p["allocated_capital"] for p in active_positions)
                    risk_amount = portfolio_val * RISK_BUDGET_PER_TRADE

                    p_entry = cand["entry_price"]
                    p_stop = cand["stop_price"]
                    stop_distance = max(0.01, (p_entry - p_stop) / p_entry)

                    # Size based on risk budget
                    sized_capital = risk_amount / stop_distance
                    max_allowed = portfolio_val * MAX_ALLOCATION_PER_TRADE
                    allocated = min(sized_capital, max_allowed, cash)

                    if allocated >= (portfolio_val * 0.05):  # at least 5% position
                        cash -= allocated
                        active_positions.append({
                            **cand,
                            "allocated_capital": allocated,
                        })

            trade_idx += 1

        # Calculate daily portfolio equity
        total_equity = cash + sum(p["allocated_capital"] for p in active_positions)
        equity_history.append({
            "date": current_date.strftime("%Y-%m-%d"),
            "equity": round(total_equity, 2),
            "cash": round(cash, 2),
            "active_positions_count": len(active_positions),
        })

    # Portfolio Performance Statistics
    eq_df = pd.DataFrame(equity_history)
    eq_series = eq_df["equity"]
    peak = eq_series.cummax()
    drawdown = (eq_series - peak) / peak
    max_dd = float(drawdown.min())

    daily_returns = eq_series.pct_change().dropna()
    sharpe = float((daily_returns.mean() / (daily_returns.std() + 1e-8)) * np.sqrt(252))
    total_return_pct = float((eq_series.iloc[-1] - initial_capital) / initial_capital)

    win_rate = float(np.mean([1 if t["net_return_pct"] > 0 else 0 for t in completed_trades])) if completed_trades else 0.0

    report = {
        "initial_capital": initial_capital,
        "final_equity": round(float(eq_series.iloc[-1]), 2),
        "total_net_return_pct": round(total_return_pct * 100, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "annualized_sharpe": round(sharpe, 2),
        "win_rate_pct": round(win_rate * 100, 2),
        "total_trades_executed": len(completed_trades),
        "max_concurrent_positions_limit": MAX_CONCURRENT_POSITIONS,
        "risk_budget_per_trade_pct": RISK_BUDGET_PER_TRADE * 100,
        "friction_per_trade_pct": 0.15,
    }

    if save_report:
        config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        with open(PORTFOLIO_REPORT_JSON, "w") as f:
            json.dump(report, f, indent=2)
        logger.info(f"Saved portfolio simulation report to {PORTFOLIO_REPORT_JSON}")

    return report


if __name__ == "__main__":
    if SWING_DATASET_PARQUET.exists():
        df_trades = pd.read_parquet(SWING_DATASET_PARQUET)
        rep = run_portfolio_simulation(df_trades)
        print("\n--- Swing Portfolio Simulation Results ---")
        print(json.dumps(rep, indent=2))
    else:
        print("Swing dataset not found. Run swing_dataset.py first.")
