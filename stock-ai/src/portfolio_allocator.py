"""
Portfolio Sizing & Capital Allocation Engine for Indian NSE Equities.
Translates percentage-based model signals into concrete share quantities and Rupee allocations:
  - Account Base Capital: Default ₹5,00,000 (Configurable)
  - Max Simultaneous Daily Positions: 5
  - Risk Budget per Trade: 1.0% of portfolio (₹5,000 risk)
  - Sizing Modes:
      1. EQUAL_WEIGHT: Equal cash distribution across top N candidates
      2. VOLATILITY_PARITY (Inverse ATR): Sized so max loss at stop = exactly 1% portfolio risk
  - Full friction accounting: STT, exchange charges, brokerage, stamp duty (0.15% roundtrip)
  - Cash drag & portfolio cash reserve tracking
"""

import sys
import os
import json
import logging
import math
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

PORTFOLIO_DIR = config.OUTPUTS_DIR / "paper_trading"
PORTFOLIO_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CAPITAL_INR = 500000.0  # ₹5,00,000
DEFAULT_MAX_POSITIONS = 5
DEFAULT_RISK_PCT_PER_TRADE = 0.01  # 1.0% risk per trade (₹5,000 on ₹5L)
DEFAULT_MAX_CAPITAL_PER_STOCK_PCT = 0.25  # Max 25% capital in single stock


class PortfolioAllocator:
    """
    Manages capital allocation, position sizing in shares, and cash reserves.
    """

    def __init__(
        self,
        initial_capital: float = DEFAULT_CAPITAL_INR,
        max_positions: int = DEFAULT_MAX_POSITIONS,
        risk_per_trade_pct: float = DEFAULT_RISK_PCT_PER_TRADE,
        max_stock_weight_pct: float = DEFAULT_MAX_CAPITAL_PER_STOCK_PCT,
    ):
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.max_positions = max_positions
        self.risk_per_trade_pct = risk_per_trade_pct
        self.max_stock_weight_pct = max_stock_weight_pct

    def allocate_daily_orders(
        self,
        signals_df: pd.DataFrame,
        mode: str = "VOLATILITY_PARITY",
    ) -> List[Dict]:
        """
        Allocates exact share quantities and Rupee budgets for today's qualifying signals.
        Mode options: 'VOLATILITY_PARITY' (Inverse ATR) or 'EQUAL_WEIGHT'.
        """
        if signals_df.empty:
            return []

        # Sort descending by model score and select top N up to max_positions
        candidates = signals_df.sort_values(by="model_score", ascending=False).head(self.max_positions).copy()
        allocations = []
        available_cash = self.current_capital

        risk_budget_inr = self.current_capital * self.risk_per_trade_pct  # e.g. ₹5,000
        max_stock_capital_inr = self.current_capital * self.max_stock_weight_pct  # e.g. ₹1,25,000

        for _, row in candidates.iterrows():
            ticker = row["ticker"]
            trigger_price = float(row["breakout_trigger"])
            stop_price = float(row["stop_loss"])
            target_price = float(row["profit_target"])
            atr_val = float(row.get("ATR", trigger_price * 0.02))

            # Per share risk
            per_share_risk = max(trigger_price - stop_price, trigger_price * 0.005)

            if mode == "VOLATILITY_PARITY":
                # Shares sized so that total loss at stop = risk_budget_inr
                shares = math.floor(risk_budget_inr / per_share_risk)
                # Cap by max capital weight per stock
                shares = min(shares, math.floor(max_stock_capital_inr / trigger_price))
            else:  # EQUAL_WEIGHT
                equal_cash = available_cash / min(len(candidates), self.max_positions)
                shares = math.floor(equal_cash / trigger_price)

            shares = max(shares, 1) if available_cash >= trigger_price else 0
            order_cost_inr = shares * trigger_price

            if order_cost_inr > available_cash or shares == 0:
                continue

            available_cash -= order_cost_inr
            total_risk_inr = shares * per_share_risk
            potential_reward_inr = shares * (target_price - trigger_price)
            rr_ratio = round(potential_reward_inr / total_risk_inr, 2) if total_risk_inr > 0 else 0.0

            allocations.append({
                "ticker": ticker,
                "model_score": float(row["model_score"]),
                "breakout_trigger_inr": trigger_price,
                "shares_to_buy": int(shares),
                "required_capital_inr": round(order_cost_inr, 2),
                "capital_weight_pct": round((order_cost_inr / self.current_capital) * 100, 2),
                "stop_loss_inr": stop_price,
                "profit_target_inr": target_price,
                "max_risk_inr": round(total_risk_inr, 2),
                "potential_reward_inr": round(potential_reward_inr, 2),
                "reward_to_risk_ratio": rr_ratio,
            })

        return allocations

    def simulate_portfolio_walkthrough(
        self,
        trades_df: pd.DataFrame,
        mode: str = "VOLATILITY_PARITY",
    ) -> Tuple[pd.DataFrame, Dict]:
        """
        Simulates chronological portfolio equity curve starting from initial_capital
        using multi-stock portfolio allocation and cash drag.
        """
        if trades_df.empty:
            return pd.DataFrame(), {}

        # Ensure sorted by date
        df_trades = trades_df.copy()
        df_trades["trade_date"] = pd.to_datetime(df_trades["trade_date"])
        df_trades = df_trades.sort_values("trade_date").reset_index(drop=True)

        portfolio_equity = self.initial_capital
        history = []

        for date, session_group in df_trades.groupby("trade_date"):
            # Select top N candidates for the day
            active_signals = session_group.head(self.max_positions)
            session_pnl_inr = 0.0
            allocated_cash = 0.0

            risk_budget_inr = portfolio_equity * self.risk_per_trade_pct
            max_stock_capital_inr = portfolio_equity * self.max_stock_weight_pct

            for _, trade in active_signals.iterrows():
                entry_p = float(trade.get("entry_price", 0.0))
                exit_p = float(trade.get("exit_price", 0.0))
                stop_p = float(trade.get("stop", entry_p * 0.98))
                status = str(trade.get("status", "NOT_TRIGGERED"))

                if status == "NOT_TRIGGERED" or entry_p <= 0:
                    continue

                per_share_risk = max(entry_p - stop_p, entry_p * 0.005)

                if mode == "VOLATILITY_PARITY":
                    shares = math.floor(risk_budget_inr / per_share_risk)
                    shares = min(shares, math.floor(max_stock_capital_inr / entry_p))
                else:
                    equal_cash = (portfolio_equity * 0.90) / min(len(active_signals), self.max_positions)
                    shares = math.floor(equal_cash / entry_p)

                shares = max(shares, 1)
                cost_inr = shares * entry_p
                allocated_cash += cost_inr

                # Net return after 0.15% friction
                gross_ret = (exit_p / entry_p) - 1.0
                net_ret = gross_ret - (config.TRANSACTION_COST_PCT + config.SLIPPAGE_PCT)
                trade_pnl = shares * entry_p * net_ret
                session_pnl_inr += trade_pnl

            portfolio_equity += session_pnl_inr
            cash_reserve = max(portfolio_equity - allocated_cash, 0.0)

            history.append({
                "date": date.strftime("%Y-%m-%d"),
                "portfolio_equity_inr": round(portfolio_equity, 2),
                "session_pnl_inr": round(session_pnl_inr, 2),
                "allocated_cash_inr": round(allocated_cash, 2),
                "cash_reserve_inr": round(cash_reserve, 2),
                "cash_utilization_pct": round((allocated_cash / portfolio_equity) * 100, 2) if portfolio_equity > 0 else 0.0,
            })

        history_df = pd.DataFrame(history)
        if history_df.empty:
            return pd.DataFrame(), {}

        # Portfolio metrics
        equity_series = history_df["portfolio_equity_inr"]
        peak = equity_series.cummax()
        dd = (equity_series - peak) / peak
        max_dd_pct = float(dd.min()) * 100.0
        total_pnl_inr = portfolio_equity - self.initial_capital
        total_return_pct = (total_pnl_inr / self.initial_capital) * 100.0

        summary = {
            "initial_capital_inr": self.initial_capital,
            "final_equity_inr": round(portfolio_equity, 2),
            "net_profit_inr": round(total_pnl_inr, 2),
            "total_return_pct": round(total_return_pct, 2),
            "max_portfolio_drawdown_pct": round(max_dd_pct, 2),
            "total_sessions": len(history_df),
            "avg_cash_utilization_pct": round(history_df["cash_utilization_pct"].mean(), 2),
        }

        return history_df, summary


def generate_portfolio_allocation_sample():
    """Generates a sample portfolio allocation report for today's signals or recent candidates."""
    allocator = PortfolioAllocator(initial_capital=DEFAULT_CAPITAL_INR)

    # Load latest signals
    signals_file = config.OUTPUTS_DIR / "paper_trading" / "all_signals.csv"
    if not signals_file.exists() or pd.read_csv(signals_file).empty:
        # Load from predict.py output
        pred_file = config.OUTPUTS_DIR / "latest_predictions.csv"
        if pred_file.exists():
            df_pred = pd.read_csv(pred_file)
            df_pred["breakout_trigger"] = df_pred["Close_Numeric"] * 1.0025
            df_pred["profit_target"] = df_pred["breakout_trigger"] * 1.02
            df_pred["stop_loss"] = df_pred["breakout_trigger"] - (df_pred["Close_Numeric"] * 0.02)
            df_pred["ATR"] = df_pred["Close_Numeric"] * 0.02
            df_pred["ticker"] = df_pred["Ticker"]
            df_pred["model_score"] = df_pred["Model Score"]
            orders = allocator.allocate_daily_orders(df_pred, mode="VOLATILITY_PARITY")
        else:
            orders = []
    else:
        df_sig = pd.read_csv(signals_file)
        orders = allocator.allocate_daily_orders(df_sig, mode="VOLATILITY_PARITY")

    out_json = PORTFOLIO_DIR / "portfolio_allocation.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({
            "capital_base_inr": DEFAULT_CAPITAL_INR,
            "max_positions": DEFAULT_MAX_POSITIONS,
            "risk_per_trade_pct": DEFAULT_RISK_PCT_PER_TRADE * 100,
            "orders": orders,
        }, f, indent=4)

    logger.info(f"Generated portfolio allocation JSON: {out_json}")
    return orders


if __name__ == "__main__":
    orders = generate_portfolio_allocation_sample()
    print("\n" + "=" * 80)
    print("PORTFOLIO SIZING & RUPEE CAPITAL ALLOCATION REPORT")
    print(f"Account Base Capital : Rs. {DEFAULT_CAPITAL_INR:,.2f}")
    print(f"Risk Budget / Trade  : 1.0% (Rs. {DEFAULT_CAPITAL_INR * DEFAULT_RISK_PCT_PER_TRADE:,.2f})")
    print(f"Max Positions / Day  : {DEFAULT_MAX_POSITIONS}")
    print("=" * 80)

    if not orders:
        print("No active candidates allocated for current session.")
    else:
        df_orders = pd.DataFrame(orders)
        display_cols = [
            "ticker", "model_score", "shares_to_buy", "required_capital_inr",
            "breakout_trigger_inr", "stop_loss_inr", "profit_target_inr",
            "max_risk_inr", "potential_reward_inr", "reward_to_risk_ratio"
        ]
        print(df_orders[display_cols].to_string(index=False))

    print("=" * 80 + "\n")
