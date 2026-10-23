"""
Walk-Forward Validation and Realistic Trading Backtesting Engine.
Avoids all look-ahead bias through expanding chronological windows.
Executes both:
  Simulation A: Signal-Quality Evaluation (Reference = Today's Close, Target = Next High >= +2%)
  Simulation B: Realistic Trade Simulation (Entry = Next Day Open, Target = +2%, Stop = -1%,
                conservative handling of ambiguous candles, slippage, and transaction costs).
"""

import sys
import json
import hashlib
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _session_key(value):
    """Normalize mixed pandas/NumPy date values to a comparable session key."""
    return pd.Timestamp(value).normalize()


def run_walk_forward_evaluation(
    df: Optional[pd.DataFrame] = None,
    min_train_bars: int = config.WF_INITIAL_TRAIN_DAYS,
    step_bars: int = config.WF_STEP_DAYS,
    threshold: float = 0.60,
) -> pd.DataFrame:
    """
    Simulates walk-forward expanding window evaluation:
      1. Train on historical data up to date T_cutoff.
      2. Predict out-of-sample for the next step_bars window.
      3. Expand window by step_bars and retrain.
      4. Repeat until all out-of-sample test periods are predicted.
    Ensures zero future leakage at every single roll.
    """
    if df is None:
        df = dataset.load_combined_dataset()

    df = df.dropna(subset=["target"]).sort_values("Date").reset_index(drop=True)
    unique_dates = df["Date"].drop_duplicates().sort_values().reset_index(drop=True)

    feature_cols = features.extract_feature_column_names(df)
    total_dates = len(unique_dates)

    if total_dates <= min_train_bars:
        raise ValueError(
            f"Total unique trading dates ({total_dates}) is less than initial training bars ({min_train_bars})."
        )

    logger.info(
        f"Starting Walk-Forward Validation: {total_dates} total trading dates, "
        f"Initial Train: {min_train_bars} bars, Step Size: {step_bars} bars."
    )

    out_of_sample_dfs = []
    current_idx = min_train_bars
    step_num = 1

    while current_idx < total_dates:
        train_cutoff_date = unique_dates.iloc[current_idx - 1]
        next_idx = min(current_idx + step_bars, total_dates)
        test_end_date = unique_dates.iloc[next_idx - 1]

        train_mask = df["Date"] <= train_cutoff_date
        test_mask = (df["Date"] > train_cutoff_date) & (df["Date"] <= test_end_date)

        train_split = df[train_mask]
        test_split = df[test_mask]

        if len(test_split) == 0:
            break

        logger.info(
            f"  Walk-Forward Step {step_num}: Train <= {train_cutoff_date.strftime('%Y-%m-%d')} ({len(train_split)} rows) | "
            f"Predict -> {test_end_date.strftime('%Y-%m-%d')} ({len(test_split)} rows)"
        )

        # Compute fold-isolated imputation medians strictly within this training window
        fold_impute = dataset.compute_train_imputation_values(train_split, feature_cols)
        train_fold_imputed = dataset.apply_imputation(train_split, fold_impute, feature_cols)
        test_fold_imputed = dataset.apply_imputation(test_split, fold_impute, feature_cols)

        X_tr = train_fold_imputed[feature_cols].astype(np.float32)
        y_tr = train_fold_imputed["target"].astype(int)

        X_te = test_fold_imputed[feature_cols].astype(np.float32)

        # Train model with conservative trees for fast walk-forward
        wf_params = config.LGBM_PARAMS.copy()
        wf_params["n_estimators"] = 350
        wf_params["class_weight"] = "balanced"
        wf_params["verbose"] = -1

        model = LGBMClassifier(**wf_params)
        model.fit(X_tr, y_tr)

        # Predict out-of-sample
        probs = model.predict_proba(X_te)[:, 1]

        step_results = test_split.copy()
        step_results["model_prob"] = probs
        step_results["signal"] = (probs >= threshold).astype(int)
        step_results["wf_step"] = step_num

        out_of_sample_dfs.append(step_results)

        current_idx = next_idx
        step_num += 1

    oos_df = pd.concat(out_of_sample_dfs, axis=0, ignore_index=True)
    oos_df = oos_df.sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    logger.info(f"Walk-forward validation finished: {len(oos_df)} total out-of-sample predictions.")

    return oos_df


def simulate_signal_quality(
    pred_df: pd.DataFrame, threshold: float = 0.60
) -> Dict:
    """
    Simulation A: Signal-Quality Evaluation
      Reference price = Today's Close (Date T)
      Win condition = Next Day's High >= Close_T * (1 + TARGET_PCT)
    """
    signals_df = pred_df[pred_df["model_prob"] >= threshold].copy()
    total_signals = len(signals_df)

    if total_signals == 0:
        return {
            "simulation": "A (Signal Quality)",
            "threshold": threshold,
            "total_signals": 0,
            "win_rate": 0.0,
            "wins": 0,
            "losses": 0,
        }

    wins = int((signals_df["target"] == 1).sum())
    losses = total_signals - wins
    win_rate = wins / total_signals

    return {
        "simulation": "A (Signal Quality - Ref: Today Close)",
        "threshold": threshold,
        "total_signals": total_signals,
        "wins": wins,
        "losses": losses,
        "win_rate": float(win_rate),
    }


def simulate_realistic_trading(
    pred_df: pd.DataFrame,
    threshold: float = 0.60,
    profit_target_pct: float = config.PROFIT_TARGET_PCT,
    stop_loss_pct: float = config.STOP_LOSS_PCT,
    transaction_cost: float = config.TRANSACTION_COST_PCT,
    slippage: float = config.SLIPPAGE_PCT,
    ambiguous_rule: str = config.AMBIGUOUS_CANDLE_RULE,
    entry_mode: str = "open",  # "open", "moc" (Market-On-Close Date T), "breakout" (Close + 0.25%)
    stop_loss_type: str = "fixed",  # "fixed" or "atr"
    atr_multiplier: float = 1.2,
) -> Tuple[Dict, pd.DataFrame]:
    """
    Realistic Trade Execution Simulator supporting multiple professional execution modes:
      - entry_mode="open": Next Day Open with slippage.
      - entry_mode="moc": Date T Close (3:20 PM MIS order) matching reference price.
      - entry_mode="breakout": Triggered only if Next Day High breaks above Date T Close + 0.25%.
      - stop_loss_type="fixed": Rigid percentage stop (e.g. -1.0%).
      - stop_loss_type="atr": Volatility-scaled dynamic stop loss (e.g. 1.2 x ATR_14).
    """
    signals_df = pred_df[pred_df["model_prob"] >= threshold].copy()
    total_signals = len(signals_df)

    if total_signals == 0:
        empty_trades = pd.DataFrame(columns=["Date", "ticker", "prob", "net_return"])
        portfolio = simulate_capital_limited_portfolio(
            empty_trades, pred_df["Date"].drop_duplicates().tolist(),
            config.BACKTEST_INITIAL_CAPITAL, config.BACKTEST_MAX_POSITIONS,
        )
        return {
            "simulation": f"B ({entry_mode.upper()} / {stop_loss_type.upper()})",
            "threshold": threshold,
            "total_signals": 0,
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "ambiguous_trades": 0,
            "win_rate": 0.0,
            "avg_return_per_trade": 0.0,
            "cumulative_return": 0.0,
            "profit_factor": 0.0,
            "max_drawdown": 0.0,
            "sharpe_ratio": 0.0,
            "expectancy_per_trade": 0.0,
            "portfolio_assumptions": {
                "initial_capital_inr": config.BACKTEST_INITIAL_CAPITAL,
                "max_concurrent_positions": config.BACKTEST_MAX_POSITIONS,
                "position_sizing": "fixed equal slots as a fraction of current equity; unfilled slots held as cash",
                "selection": "highest model probability per session; one position per ticker",
                "holding_period": "entry and exit within the same session",
            },
            "portfolio_final_value_inr": config.BACKTEST_INITIAL_CAPITAL,
            "portfolio_cagr": 0.0,
            "portfolio_trade_count": 0,
            "portfolio_max_drawdown": 0.0,
            "portfolio_annualized_sharpe": 0.0,
            "portfolio_sessions": len(portfolio["curve"]),
            "portfolio_active_sessions": 0,
            "portfolio_average_positions": 0.0,
            "position_target_pct": profit_target_pct,
            "position_target_hits": 0,
            "position_target_hit_rate": 0.0,
            "portfolio_equity_curve": [
                {**row, "Date": pd.Timestamp(row["Date"]).strftime("%Y-%m-%d")}
                for row in portfolio["curve"].to_dict(orient="records")
            ],
        }, empty_trades

    trades = []

    for _, row in signals_df.iterrows():
        raw_open = row["next_open"]
        high = row["next_high"]
        low = row["next_low"]
        close = row["next_close"]
        today_close = row["Close"]

        if pd.isna(raw_open) or pd.isna(high) or pd.isna(low) or pd.isna(close) or raw_open <= 0:
            continue

        # 1. Determine Entry Price based on Entry Mode
        if entry_mode == "moc":
            # Market-On-Close: entry at Date T Close
            entry_price = today_close * (1.0 + slippage)
        elif entry_mode == "breakout":
            # Breakout confirmation: buy trigger at today_close * 1.0025 (+0.25%)
            trigger_level = today_close * 1.0025
            if high < trigger_level:
                # Stock never touched trigger price -> trade not entered
                continue
            entry_price = trigger_level * (1.0 + slippage)
        else:
            # Default: Entry at Next Day Open
            entry_price = raw_open * (1.0 + slippage)

        # 2. Determine Stop Loss based on Stop Loss Type
        target_price = entry_price * (1.0 + profit_target_pct)
        if stop_loss_type == "atr" and "atr_14" in row and not pd.isna(row["atr_14"]):
            atr_distance = row["atr_14"] * atr_multiplier
            stop_price = max(entry_price - atr_distance, entry_price * 0.90)  # capped at -10% max
        else:
            stop_price = entry_price * (1.0 - stop_loss_pct)

        target_hit = high >= target_price
        stop_hit = low <= stop_price

        is_ambiguous = target_hit and stop_hit
        trade_result = None
        exit_price = None

        if is_ambiguous:
            if ambiguous_rule == "stop_first":
                # Conservative rule: stop loss triggered first
                trade_result = "LOSS (AMBIGUOUS)"
                exit_price = stop_price * (1.0 - slippage)
            elif ambiguous_rule == "target_first":
                trade_result = "WIN (AMBIGUOUS)"
                exit_price = target_price * (1.0 - slippage)
            else:
                trade_result = "SKIPPED"
                exit_price = None
        elif target_hit:
            trade_result = "WIN"
            exit_price = target_price * (1.0 - slippage)
        elif stop_hit:
            trade_result = "LOSS"
            exit_price = stop_price * (1.0 - slippage)
        else:
            # Neither hit: exit at session close
            exit_price = close * (1.0 - slippage)
            raw_ret = (exit_price - entry_price) / entry_price
            trade_result = "WIN (CLOSE)" if raw_ret > 0 else "LOSS (CLOSE)"

        if exit_price is not None:
            gross_return = (exit_price - entry_price) / entry_price
            net_return = gross_return - transaction_cost

            trades.append({
                "Date": row["Date"],
                "ticker": row["ticker"],
                "prob": row["model_prob"],
                "entry_price": entry_price,
                "exit_price": exit_price,
                "target_price": target_price,
                "stop_price": stop_price,
                "result": trade_result,
                "is_ambiguous": is_ambiguous,
                "gross_return": gross_return,
                "net_return": net_return,
                "entry_mode": entry_mode,
                "stop_loss_type": stop_loss_type,
            })

    trades_df = pd.DataFrame(trades)

    if trades_df.empty:
        portfolio = simulate_capital_limited_portfolio(
            trades_df,
            pred_df["Date"].drop_duplicates().tolist(),
            initial_capital=config.BACKTEST_INITIAL_CAPITAL,
            max_positions=config.BACKTEST_MAX_POSITIONS,
        )
        curve = portfolio["curve"]
        empty_curve = [
            {**row, "Date": pd.Timestamp(row["Date"]).strftime("%Y-%m-%d")}
            for row in curve.to_dict(orient="records")
        ]
        assumptions = {
            "initial_capital_inr": config.BACKTEST_INITIAL_CAPITAL,
            "max_concurrent_positions": config.BACKTEST_MAX_POSITIONS,
            "position_sizing": "fixed equal slots as a fraction of current equity; unfilled slots held as cash",
            "selection": "highest model probability per session; one position per ticker",
            "holding_period": "entry and exit within the same session",
        }
        return {
            "simulation": "B (Realistic Trade Execution - Entry: Next Open)",
            "threshold": threshold,
            "ambiguous_rule": ambiguous_rule,
            "total_signals": total_signals,
            "total_trades": 0,
            "wins": 0,
            "losses": 0,
            "ambiguous_trades": 0,
            "win_rate": 0.0,
            "avg_return_per_trade": 0.0,
            "cumulative_return": 0.0,
            "profit_factor": 0.0,
            "max_drawdown": 0.0,
            "sharpe_ratio": 0.0,
            "expectancy_per_trade": 0.0,
            "portfolio_assumptions": assumptions,
            "portfolio_final_value_inr": config.BACKTEST_INITIAL_CAPITAL,
            "portfolio_cagr": 0.0,
            "portfolio_trade_count": 0,
            "portfolio_max_drawdown": 0.0,
            "portfolio_annualized_sharpe": 0.0,
            "portfolio_sessions": len(curve),
            "portfolio_active_sessions": 0,
            "portfolio_average_positions": 0.0,
            "position_target_pct": profit_target_pct,
            "position_target_hits": 0,
            "position_target_hit_rate": 0.0,
            "portfolio_equity_curve": empty_curve,
        }, trades_df

    total_trades = len(trades_df)
    ambiguous_count = int(trades_df["is_ambiguous"].sum())
    wins = int((trades_df["net_return"] > 0).sum())
    losses = int((trades_df["net_return"] <= 0).sum())
    win_rate = wins / total_trades if total_trades > 0 else 0.0

    avg_return = float(trades_df["net_return"].mean())
    total_gains = trades_df.loc[trades_df["net_return"] > 0, "net_return"].sum()
    total_losses = abs(trades_df.loc[trades_df["net_return"] <= 0, "net_return"].sum())
    profit_factor = float(total_gains / total_losses) if total_losses > 0 else 999.0

    # Trade expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
    avg_win = float(trades_df.loc[trades_df["net_return"] > 0, "net_return"].mean()) if wins > 0 else 0.0
    avg_loss = float(abs(trades_df.loc[trades_df["net_return"] <= 0, "net_return"].mean())) if losses > 0 else 0.0
    expectancy = (win_rate * avg_win) - ((1.0 - win_rate) * avg_loss)

    # Per-trade compounding is not an investable portfolio: it reinvests the full
    # account in every same-day signal. Keep it only as an explicitly labelled
    # diagnostic; portfolio metrics below use a capital and concurrency limit.
    trades_df = trades_df.sort_values("Date").reset_index(drop=True)
    trade_sequence_equity = (1.0 + trades_df["net_return"]).cumprod()
    trade_sequence_drawdown = (trade_sequence_equity - trade_sequence_equity.cummax()) / trade_sequence_equity.cummax()
    portfolio = simulate_capital_limited_portfolio(
        trades_df,
        pred_df["Date"].drop_duplicates().tolist(),
        initial_capital=config.BACKTEST_INITIAL_CAPITAL,
        max_positions=config.BACKTEST_MAX_POSITIONS,
    )

    # Sharpe ratio is based on portfolio daily equity changes, including zero
    # return sessions, rather than an average of unrelated stock trades.
    daily_returns = portfolio["daily_returns"]
    if len(daily_returns) > 1 and daily_returns.std() > 0:
        sharpe_ratio = float((daily_returns.mean() / daily_returns.std()) * np.sqrt(252))
    else:
        sharpe_ratio = 0.0

    portfolio_curve = portfolio["curve"]
    cumulative_return = float(portfolio_curve["equity"].iloc[-1] / config.BACKTEST_INITIAL_CAPITAL - 1.0)
    max_drawdown = float(portfolio_curve["drawdown"].min()) if not portfolio_curve.empty else 0.0
    final_value = float(portfolio_curve["equity"].iloc[-1]) if not portfolio_curve.empty else config.BACKTEST_INITIAL_CAPITAL
    cagr = (final_value / config.BACKTEST_INITIAL_CAPITAL) ** (252 / len(portfolio_curve)) - 1.0 if len(portfolio_curve) and final_value > 0 else None
    selected_keys = portfolio["selected_keys"]
    selected_mask = [(_session_key(d), ticker) in selected_keys for d, ticker in zip(trades_df["Date"], trades_df["ticker"])]
    selected_trades = trades_df.loc[selected_mask]
    selected_count = len(selected_trades)
    selected_target_hits = int(selected_trades["result"].eq("WIN").sum())
    selected_net_winners = int((selected_trades["net_return"] > 0).sum())

    metrics = {
        "simulation": f"B ({entry_mode.upper()} / {stop_loss_type.upper()})",
        "threshold": threshold,
        "ambiguous_rule": ambiguous_rule,
        "profit_target_pct": profit_target_pct,
        "stop_loss_pct": stop_loss_pct,
        "transaction_cost_pct": transaction_cost,
        "slippage_pct": slippage,
        "total_signals": total_signals,
        "total_trades": total_trades,
        "wins": wins,
        "losses": losses,
        "ambiguous_trades": ambiguous_count,
        "win_rate": float(win_rate),
        "avg_return_per_trade": float(avg_return),
        "cumulative_return": float(cumulative_return),
        "profit_factor": float(profit_factor),
        "max_drawdown": float(max_drawdown),
        "sharpe_ratio": float(sharpe_ratio),
        "expectancy_per_trade": float(expectancy),
        "trade_sequence_compounded_return_diagnostic": float(trade_sequence_equity.iloc[-1] - 1.0),
        "trade_sequence_max_drawdown_diagnostic": float(trade_sequence_drawdown.min()),
        "portfolio_assumptions": {
            "initial_capital_inr": config.BACKTEST_INITIAL_CAPITAL,
            "max_concurrent_positions": config.BACKTEST_MAX_POSITIONS,
            "position_sizing": "fixed equal slots as a fraction of current equity; unfilled slots held as cash",
            "selection": "highest model probability per session; one position per ticker",
            "holding_period": "entry and exit within the same session",
        },
        "portfolio_final_value_inr": final_value,
        "portfolio_cagr": float(cagr) if cagr is not None else None,
        "portfolio_trade_count": selected_count,
        "portfolio_win_rate": float(selected_net_winners / selected_count) if selected_count else 0.0,
        "portfolio_max_drawdown": max_drawdown,
        "portfolio_annualized_sharpe": sharpe_ratio,
        "portfolio_sessions": len(portfolio_curve),
        "portfolio_active_sessions": int((portfolio_curve["positions"] > 0).sum()) if not portfolio_curve.empty else 0,
        "portfolio_average_positions": float(portfolio_curve["positions"].mean()) if not portfolio_curve.empty else 0.0,
        "position_target_pct": profit_target_pct,
        "position_target_hits": selected_target_hits,
        "position_target_hit_rate": float(selected_target_hits / selected_count) if selected_count else 0.0,
        "portfolio_equity_curve": [
            {**row, "Date": pd.Timestamp(row["Date"]).strftime("%Y-%m-%d")}
            for row in portfolio_curve.to_dict(orient="records")
        ],
    }

    # Preserve the portfolio curve on the trade frame so downstream plotting and
    # exports can show the same constrained portfolio as the reported metrics.
    curve_columns = portfolio_curve.set_index("Date") if not portfolio_curve.empty else None
    if curve_columns is not None:
        trades_df["portfolio_selected"] = False
        trades_df["portfolio_weight"] = 0.0
        trade_keys = list(zip((_session_key(d) for d in trades_df["Date"]), trades_df["ticker"]))
        trades_df["portfolio_selected"] = [key in selected_keys for key in trade_keys]
        normalized_trade_dates = [_session_key(d) for d in trades_df["Date"]]
        trades_df["portfolio_shares"] = [portfolio["selected_positions"].get(key, {}).get("shares", 0) for key in trade_keys]
        trades_df["portfolio_notional_inr"] = [portfolio["selected_positions"].get(key, {}).get("notional_inr", 0.0) for key in trade_keys]
        trades_df["equity"] = [curve_columns.loc[d, "equity"] if d in curve_columns.index else np.nan for d in normalized_trade_dates]
        trades_df["peak_equity"] = [curve_columns.loc[d, "peak_equity"] if d in curve_columns.index else np.nan for d in normalized_trade_dates]
        trades_df["drawdown"] = [curve_columns.loc[d, "drawdown"] if d in curve_columns.index else np.nan for d in normalized_trade_dates]
        trades_df["portfolio_weight"] = [portfolio["selected_positions"].get(key, {}).get("weight", 0.0) for key in trade_keys]
        trades_df["daily_portfolio_return"] = [curve_columns.loc[d, "daily_return"] if d in curve_columns.index else np.nan for d in normalized_trade_dates]

    return metrics, trades_df


def simulate_capital_limited_portfolio(
    trades_df: pd.DataFrame,
    sessions: List,
    initial_capital: float,
    max_positions: int,
) -> Dict:
    """Simulate daily returns with bounded capital and concurrent positions.

    The current execution simulator closes every trade within its signal day, so
    positions do not carry between sessions. Each slot uses 1/max_positions of
    equity; unfilled slots remain cash. Ties resolve deterministically by ticker.
    """
    if initial_capital <= 0 or max_positions <= 0:
        raise ValueError("Initial capital and max_positions must be positive")
    curve_rows = []
    selected_keys = set()
    selected_positions = {}
    equity = float(initial_capital)
    peak = equity
    trades_by_date = {
        _session_key(date): rows for date, rows in trades_df.groupby("Date", sort=False)
    } if not trades_df.empty else {}

    for raw_date in sorted(set(sessions)):
        date = _session_key(raw_date)
        day_trades = trades_by_date.get(date)
        if day_trades is None:
            candidates = trades_df.iloc[0:0]
        else:
            candidates = (day_trades.sort_values(["prob", "ticker"], ascending=[False, True])
                          .drop_duplicates("ticker", keep="first"))
        slot_weight = 1.0 / max_positions
        slot_budget = equity * slot_weight
        selected = []
        portfolio_pnl = 0.0
        exposure_fraction = 0.0
        for _, candidate in candidates.iterrows():
            if len(selected) >= max_positions:
                break
            entry_price = float(candidate.get("entry_price", 0) or 0)
            if not np.isfinite(entry_price) or entry_price <= 0:
                continue
            shares = int(np.floor(slot_budget / entry_price))
            if shares <= 0:
                continue
            notional = shares * entry_price
            weight = notional / equity
            portfolio_pnl += notional * float(candidate["net_return"])
            exposure_fraction += weight
            selected.append((candidate["ticker"], shares, notional, weight))
        count = len(selected)
        portfolio_return = portfolio_pnl / equity
        equity *= 1.0 + portfolio_return
        peak = max(peak, equity)
        drawdown = equity / peak - 1.0 if peak else 0.0
        curve_rows.append({
            "Date": date,
            "equity": equity,
            "peak_equity": peak,
            "drawdown": drawdown,
            "daily_return": portfolio_return,
            "positions": count,
            "exposure_fraction": exposure_fraction,
        })
        for ticker, shares, notional, weight in selected:
            key = (date, ticker)
            selected_keys.add(key)
            selected_positions[key] = {
                "shares": shares,
                "notional_inr": notional,
                "weight": weight,
            }

    curve = pd.DataFrame(curve_rows)
    return {
        "curve": curve,
        "daily_returns": curve["daily_return"] if not curve.empty else pd.Series(dtype=float),
        "selected_keys": selected_keys,
        "selected_positions": selected_positions,
    }


def plot_backtest_equity_curves(trades_df: pd.DataFrame, output_path: Path):
    """
    Plots cumulative equity curve and drawdown profile.
    """
    if trades_df.empty:
        return

    # Plot the same equal-slot portfolio returned by the summary, not an
    # unweighted average across all candidate signals on each date.
    if "daily_portfolio_return" not in trades_df or "equity" not in trades_df:
        logger.warning("Portfolio equity columns are missing; skipping misleading legacy curve")
        return
    if "portfolio_selected" not in trades_df or not trades_df["portfolio_selected"].any():
        logger.warning("No selected portfolio trades; skipping equity curve")
        return
    daily_perf = trades_df[["Date", "daily_portfolio_return", "equity", "drawdown"]].drop_duplicates("Date").sort_values("Date")

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 8), sharex=True, gridspec_kw={"height_ratios": [2.5, 1]})

    ax1.plot(daily_perf["Date"], daily_perf["equity"], color="#2ca02c", linewidth=2, label="Capital-Limited Portfolio (Net of Costs)")
    ax1.axhline(config.BACKTEST_INITIAL_CAPITAL, color="gray", linestyle="--", alpha=0.7)
    ax1.set_title("Walk-Forward Portfolio Backtest: Equity and Drawdown", fontsize=13, fontweight="bold")
    ax1.set_ylabel("Portfolio Value (INR)", fontsize=11)
    ax1.grid(True, linestyle=":", alpha=0.6)
    ax1.legend(loc="upper left")

    ax2.fill_between(daily_perf["Date"], daily_perf["drawdown"], 0, color="#d62728", alpha=0.4, label="Portfolio Drawdown")
    ax2.set_ylabel("Drawdown", fontsize=11)
    ax2.set_xlabel("Date", fontsize=11)
    ax2.grid(True, linestyle=":", alpha=0.6)
    ax2.legend(loc="lower left")

    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150)
    plt.close()
    logger.info(f"Saved backtest equity curve to: {output_path}")


def run_full_backtest(threshold: float = 0.60, force_rerun: bool = False):
    """
    Executes walk-forward evaluation and both Simulation A and B.
    """
    print("\n" + "=" * 75)
    print(f"STEP 9: WALK-FORWARD BACKTESTING ENGINE (THRESHOLD = {threshold})")
    print("=" * 75)

    wf_pred_path = config.OUTPUTS_DIR / "walk_forward_predictions.parquet"

    if not force_rerun and wf_pred_path.exists():
        logger.info(f"Loading existing walk-forward predictions from: {wf_pred_path}")
        oos_df = pd.read_parquet(wf_pred_path)
    else:
        combined_df = dataset.load_combined_dataset()
        # 1. Run Walk-Forward Validation
        oos_df = run_walk_forward_evaluation(combined_df, threshold=threshold)
        oos_df.to_parquet(wf_pred_path, index=False)
        logger.info(f"Saved walk-forward predictions to: {wf_pred_path}")

    fingerprint_cols = [column for column in ("Date", "ticker", "model_prob") if column in oos_df]
    evaluation_id = hashlib.sha256(
        pd.util.hash_pandas_object(oos_df[fingerprint_cols], index=False).values.tobytes()
    ).hexdigest()[:24]

    # Multi-Threshold Comparison Table
    print("\n" + "=" * 90)
    print("WALK-FORWARD MULTI-THRESHOLD COMPARISON (SIMULATION A vs SIMULATION B)")
    print("=" * 90)
    comparison = []
    for th in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        s_a = simulate_signal_quality(oos_df, threshold=th)
        s_b, _ = simulate_realistic_trading(oos_df, threshold=th)
        comparison.append({
            "Threshold": th,
            "Signals": s_a["total_signals"],
            "Sim A (Close->High) Win%": f"{s_a['win_rate']*100:.1f}%",
            "Sim B (Open Entry) Win%": f"{s_b['win_rate']*100:.1f}%",
            "Sim B Avg Net Ret": f"{s_b['avg_return_per_trade']*100:.2f}%",
            "Sim B Profit Factor": f"{s_b['profit_factor']:.2f}",
        })
    comp_df = pd.DataFrame(comparison)
    print(comp_df.to_string(index=False))
    print("=" * 90)

    # 2. Simulation A: Signal Quality Evaluation
    sim_a = simulate_signal_quality(oos_df, threshold=threshold)

    print("\n" + "=" * 70)
    print("SIMULATION A: SIGNAL-QUALITY EVALUATION")
    print("Reference Price: Today's Close | Target: Next Day High >= +2%")
    print("-" * 70)
    print(f"Threshold Evaluated      : {sim_a['threshold']:.2f}")
    print(f"Total Signals Generated  : {sim_a['total_signals']:,}")
    print(f"Wins (High >= +2%)       : {sim_a['wins']:,}")
    print(f"Losses (High < +2%)      : {sim_a['losses']:,}")
    print(f"Signal Precision/Win Rate: {sim_a['win_rate']:.2%}")
    print("=" * 70)

    # 3. Simulation B: Realistic Trade Simulation
    sim_b, trades_df = simulate_realistic_trading(
        oos_df,
        threshold=threshold,
        profit_target_pct=config.PROFIT_TARGET_PCT,
        stop_loss_pct=config.STOP_LOSS_PCT,
        transaction_cost=config.TRANSACTION_COST_PCT,
        slippage=config.SLIPPAGE_PCT,
        ambiguous_rule=config.AMBIGUOUS_CANDLE_RULE,
    )

    print("\n" + "=" * 70)
    print("SIMULATION B: REALISTIC TRADE EXECUTION")
    print("Entry: Next Day Open | Target: +2% | Stop Loss: -1% | Conservative Intraday Rule")
    print(f"Transaction Cost: {config.TRANSACTION_COST_PCT*100:.2f}% | Slippage: {config.SLIPPAGE_PCT*100:.2f}%")
    print("-" * 70)
    print(f"Total Executed Trades    : {sim_b['total_trades']:,}")
    print(f"Wins                     : {sim_b['wins']:,}")
    print(f"Losses                   : {sim_b['losses']:,}")
    print(f"Ambiguous Trades (Stop 1st): {sim_b['ambiguous_trades']:,}")
    print(f"Win Rate                 : {sim_b['win_rate']:.2%}")
    print(f"Avg Net Return per Trade : {sim_b['avg_return_per_trade']:.2%}")
    print(f"Cumulative Net Return    : {sim_b['cumulative_return']:.2%}")
    print(f"Profit Factor            : {sim_b['profit_factor']:.2f}")
    print(f"Maximum Drawdown         : {sim_b['max_drawdown']:.2%}")
    print(f"Annualized Sharpe Ratio  : {sim_b['sharpe_ratio']:.2f}")
    print(f"Expectancy per Trade     : {sim_b['expectancy_per_trade']:.4f}")
    print("=" * 70)

    # 4. Multi-Strategy Comparative Evaluation (Refined Execution Models)
    print("\n" + "=" * 95)
    print("STRATEGY EXECUTION COMPARISON MATRIX (THRESHOLD = " + str(threshold) + ")")
    print("=" * 95)

    strat_configs = [
        ("Baseline: Next Open Entry (-1% Fixed Stop)", "open", "fixed", 1.2),
        ("Strategy 1: MOC Entry 3:20 PM (-1% Fixed Stop)", "moc", "fixed", 1.2),
        ("Strategy 2: Dynamic ATR Stop (Next Open Entry, 1.2x ATR Stop)", "open", "atr", 1.2),
        ("Strategy 3: Breakout Trigger (Close+0.25% Entry, 1.2x ATR Stop)", "breakout", "atr", 1.2),
    ]

    strat_summaries = []
    for s_name, e_mode, s_mode, a_mult in strat_configs:
        m, _ = simulate_realistic_trading(
            oos_df,
            threshold=threshold,
            entry_mode=e_mode,
            stop_loss_type=s_mode,
            atr_multiplier=a_mult,
        )
        strat_summaries.append({
            "Strategy Name": s_name,
            "evaluation_id": evaluation_id,
            "Trades": m.get("total_trades", 0),
            "Win Rate": f"{m.get('win_rate', 0)*100:.1f}%",
            "Avg Net Ret": f"{m.get('avg_return_per_trade', 0)*100:.2f}%",
            "Profit Factor": f"{m.get('profit_factor', 0):.2f}",
            "Sharpe": f"{m.get('sharpe_ratio', 0):.2f}",
            "Expectancy": f"{m.get('expectancy_per_trade', 0):.4f}",
            "raw_metrics": m,
        })

    strat_df = pd.DataFrame([
        {k: v for k, v in item.items() if k != "raw_metrics"} for item in strat_summaries
    ])
    print(strat_df.to_string(index=False))
    print("=" * 95)

    # Plot Equity Curve for the best performing strategy or baseline
    plot_path = config.OUTPUTS_DIR / "backtest_equity_curve.png"
    plot_backtest_equity_curves(trades_df, plot_path)

    # Save metrics & trade logs
    trades_df["evaluation_id"] = evaluation_id
    trades_df.to_csv(config.OUTPUTS_DIR / "backtest_trades.csv", index=False)
    trades_df.tail(100).to_json(config.OUTPUTS_DIR / "trades_sample.json", orient="records", date_format="iso")
    results = {
        "evaluation_id": evaluation_id,
        "simulation_a": sim_a,
        "simulation_b": sim_b,
        "strategy_comparison": [item["raw_metrics"] for item in strat_summaries],
    }
    with open(config.OUTPUTS_DIR / "backtest_summary.json", "w") as f:
        json.dump(results, f, indent=4)
    with open(config.OUTPUTS_DIR / "strategy_comparison.json", "w") as f:
        json.dump(strat_summaries, f, indent=4)
    logger.info("Saved backtest trades, summary JSON, and strategy comparison to outputs/")

    manifest_path = config.OUTPUTS_DIR / "provenance.json"
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest.setdefault("artifacts", {})
            for fname in ("backtest_summary.json", "backtest_trades.csv"):
                fpath = config.OUTPUTS_DIR / fname
                if fpath.exists():
                    manifest["artifacts"][fname] = hashlib.sha256(fpath.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            logger.info("Synchronized provenance.json checksums.")
        except Exception as e:
            logger.warning(f"Could not update provenance.json: {e}")

    return results, trades_df


if __name__ == "__main__":
    run_full_backtest(threshold=0.60)
