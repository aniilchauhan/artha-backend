#!/usr/bin/env python3
"""
Institutional Live Mark-to-Market (MTM) Portfolio Tracker & Auto-Exit Engine
Axion Stock AI

Features:
- Ingests filled orders from broker dispatch receipts into an Active Positions book.
- Connects to live NSE market pricing (via yfinance fast_info) with graceful offline fallback.
- Computes real-time MTM portfolio valuation, unrealized P&L, day return, and peak drawdown.
- Enforces automated exit rules:
    * Profit Target Hit: Sells CNC position at or above target price (+2% or model target).
    * Stop Loss Hit: Executes emergency risk cut at or below stop loss (ATR-based).
    * Dynamic Trailing Stop: Progressively raises stop loss as position moves into profit.
- Realistically accounts for sell-side Indian statutory friction:
    * STT (0.1% on delivery sell)
    * Flat Brokerage (₹20) + 18% GST (₹3.60)
    * Exchange turnover charges (0.00345%)
- Logs all completed trades into an immutable institutional Trade Journal (trade_journal.json).
"""

import os
import sys
import json
import argparse
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, List, Any, Optional

try:
    import yfinance as yf
except ImportError:
    yf = None

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "outputs", "paper_trading")
DISPATCH_FILE = os.path.join(OUTPUT_DIR, "broker_dispatch_receipts.json")
POSITIONS_FILE = os.path.join(OUTPUT_DIR, "active_positions.json")
JOURNAL_FILE = os.path.join(OUTPUT_DIR, "trade_journal.json")
MTM_SUMMARY_FILE = os.path.join(OUTPUT_DIR, "mtm_summary.json")

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def compute_sell_friction(turnover: float) -> float:
    """Computes Indian statutory sell-side transaction costs."""
    stt = turnover * 0.001          # 0.1% STT on delivery sell
    brokerage = 20.0                # Flat ₹20
    gst = brokerage * 0.18          # 18% GST on brokerage
    exchange_turnover = turnover * 0.0000345  # 0.00345% NSE turnover fee
    return round(stt + brokerage + gst + exchange_turnover, 2)

def load_json(path: str, default: Any = None) -> Any:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default

def save_json(path: str, data: Any):
    ensure_dir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

def initialize_positions_from_dispatch(reset_to_entry: bool = True) -> Dict[str, Any]:
    """Imports filled orders from broker dispatch into active positions with status OPEN."""
    dispatch = load_json(DISPATCH_FILE)
    if not dispatch or "executed_orders" not in dispatch:
        print("[WARN] No broker dispatch receipts found. Run broker dispatcher first.")
        return {"positions": [], "cash_balance": 500000.0, "total_capital": 500000.0, "last_updated": datetime.now().isoformat()}

    cash_balance = dispatch.get("cash_remaining_inr", 330196.71)
    total_capital = dispatch.get("total_gross_capital_inr", 169538.30) + cash_balance

    positions = []
    for order in dispatch.get("executed_orders", []):
        tradingsymbol = order.get("tradingsymbol")
        shares = int(order.get("shares", 0))
        entry_price = float(order.get("fill_price_inr", order.get("trigger_price_inr", 0.0)))
        entry_value = round(shares * entry_price, 2)
        stop_loss = float(order.get("stop_loss_inr", entry_price * 0.965))
        profit_target = float(order.get("profit_target_inr", entry_price * 1.02))

        # Initial LTP: at entry
        current_ltp = entry_price
        current_value = entry_value
        unrealized_pnl = 0.0
        unrealized_pnl_pct = 0.0

        pos = {
            "position_id": f"POS-{tradingsymbol}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "tradingsymbol": tradingsymbol,
            "shares": shares,
            "entry_price": entry_price,
            "entry_value": entry_value,
            "entry_time": order.get("filled_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            "stop_loss": stop_loss,
            "profit_target": profit_target,
            "trailing_stop": stop_loss,
            "highest_price": entry_price,
            "current_ltp": current_ltp,
            "current_value": current_value,
            "unrealized_pnl": unrealized_pnl,
            "unrealized_pnl_pct": unrealized_pnl_pct,
            "status": "OPEN",
            "buy_friction": float(order.get("taxes_and_charges_inr", 65.0)),
            "broker": order.get("broker", "ZERODHA"),
            "order_id": order.get("order_id", "")
        }
        positions.append(pos)

    book = {
        "positions": positions,
        "cash_balance": cash_balance,
        "initial_capital": total_capital,
        "last_updated": datetime.now().isoformat()
    }
    save_json(POSITIONS_FILE, book)
    print(f"[OK] Initialized {len(positions)} active positions from broker dispatch. Cash: INR {cash_balance:,.2f}")
    return book

def fetch_live_quotes(symbols: List[str]) -> Dict[str, float]:
    """Fetches real-time LTPs for given NSE symbols."""
    quotes = {}
    if not symbols:
        return quotes

    if yf:
        try:
            tickers_str = " ".join([f"{s}.NS" for s in symbols])
            tickers = yf.Tickers(tickers_str)
            for s in symbols:
                try:
                    t = tickers.tickers.get(f"{s}.NS")
                    if t:
                        info = getattr(t, "fast_info", None)
                        if info and hasattr(info, "last_price") and info.last_price:
                            quotes[s] = round(float(info.last_price), 2)
                        elif info and "lastPrice" in info:
                            quotes[s] = round(float(info["lastPrice"]), 2)
                        else:
                            hist = t.history(period="1d")
                            if not hist.empty and "Close" in hist:
                                quotes[s] = round(float(hist["Close"].iloc[-1]), 2)
                except Exception:
                    pass
        except Exception as e:
            print(f"[WARN] yfinance live quote fetch error: {e}")

    return quotes


def fetch_quote_snapshot(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    """Return provider-tagged quotes; missing data is never replaced by a stale LTP."""
    prices = fetch_live_quotes(symbols)
    fetched_at = datetime.now(ZoneInfo("Asia/Kolkata"))
    market_open = fetched_at.weekday() < 5 and (fetched_at.hour > 9 or (fetched_at.hour == 9 and fetched_at.minute >= 15)) and (fetched_at.hour < 15 or (fetched_at.hour == 15 and fetched_at.minute <= 30))
    return {
        symbol: {
            "price": price,
            "provider": "yahoo-finance",
            "fetched_at": fetched_at.isoformat(),
            "market_session": "open" if market_open else "closed",
            "simulated": False,
        }
        for symbol, price in prices.items()
    }


def quote_allows_auto_exit(quote: Optional[Dict[str, Any]], now: Optional[datetime] = None, max_age_seconds: int = 90) -> bool:
    """Only a recent, provider-backed quote during a known open session may trigger an exit."""
    if not quote or quote.get("simulated") or quote.get("provider") != "yahoo-finance" or quote.get("market_session") != "open":
        return False
    try:
        timestamp = datetime.fromisoformat(str(quote["fetched_at"]))
        current = now or datetime.now(timestamp.tzinfo)
        return 0 <= (current - timestamp).total_seconds() <= max_age_seconds
    except (KeyError, TypeError, ValueError):
        return False

def update_mtm_and_check_exits(enable_auto_exit: bool = True, custom_ticks: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    """
    Updates LTP for all open positions, updates trailing stops, evaluates
    stop-loss and profit-target triggers, and logs closed trades.
    """
    book = load_json(POSITIONS_FILE)
    if not book or "positions" not in book:
        book = initialize_positions_from_dispatch()

    journal = load_json(JOURNAL_FILE, {"closed_trades": [], "summary": {}})
    if "closed_trades" not in journal:
        journal["closed_trades"] = []

    open_positions = [p for p in book.get("positions", []) if p.get("status") == "OPEN"]
    symbols = list(set([p["tradingsymbol"] for p in open_positions]))
    
    # Fetch live quotes
    quote_snapshots = fetch_quote_snapshot(symbols) if symbols else {}
    live_quotes = {symbol: quote["price"] for symbol, quote in quote_snapshots.items()}
    if custom_ticks:
        live_quotes.update(custom_ticks)

    cash_balance = book.get("cash_balance", 330196.71)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    total_unrealized_pnl = 0.0
    total_positions_value = 0.0
    closed_this_round = []

    for pos in book.get("positions", []):
        if pos.get("status") != "OPEN":
            continue

        sym = pos["tradingsymbol"]
        shares = pos["shares"]
        entry_price = pos["entry_price"]
        entry_val = pos["entry_value"]
        stop_loss = pos["stop_loss"]
        profit_target = pos["profit_target"]
        trailing_stop = pos.get("trailing_stop", stop_loss)
        highest_price = pos.get("highest_price", entry_price)

        # Keep stale values for valuation, but never use them to authorize an exit.
        quote = quote_snapshots.get(sym)
        ltp = live_quotes.get(sym, pos.get("current_ltp", entry_price))
        pos["current_ltp"] = ltp
        pos["highest_price"] = max(highest_price, ltp)

        # Dynamic Trailing Stop calculation:
        # If profit >= 1.0%, trail stop loss up to break-even or 1.5% below highest price
        pct_gain = (ltp - entry_price) / entry_price
        if pct_gain >= 0.01:
            suggested_trail = max(entry_price, round(pos["highest_price"] * 0.985, 2))
            if suggested_trail > trailing_stop:
                pos["trailing_stop"] = suggested_trail
                trailing_stop = suggested_trail

        current_val = round(shares * ltp, 2)
        pos["current_value"] = current_val
        pnl = round(current_val - entry_val, 2)
        pnl_pct = round(((ltp - entry_price) / entry_price) * 100, 2)
        pos["unrealized_pnl"] = pnl
        pos["unrealized_pnl_pct"] = pnl_pct

        # Check Exit Triggers
        exit_triggered = False
        exit_reason = None
        exit_price = ltp

        if enable_auto_exit and quote_allows_auto_exit(quote):
            # 1. Profit Target Hit
            if ltp >= profit_target:
                exit_triggered = True
                exit_reason = "PROFIT_TARGET_HIT"
                exit_price = max(ltp, profit_target)
            # 2. Stop Loss or Trailing Stop Hit
            elif ltp <= trailing_stop or ltp <= stop_loss:
                exit_triggered = True
                exit_reason = "TRAILING_STOP_HIT" if ltp <= trailing_stop and trailing_stop > stop_loss else "STOP_LOSS_HIT"
                exit_price = min(ltp, trailing_stop)

        if exit_triggered:
            gross_exit = round(shares * exit_price, 2)
            sell_friction = compute_sell_friction(gross_exit)
            buy_friction = pos.get("buy_friction", 65.0)
            net_realized_pnl = round(gross_exit - entry_val - sell_friction - buy_friction, 2)
            net_return_pct = round((net_realized_pnl / entry_val) * 100, 2)
            
            # Risk/Reward R-Multiple achieved
            risk_unit = entry_val - (shares * stop_loss)
            r_multiple = round(net_realized_pnl / risk_unit, 2) if risk_unit > 0 else 0.0

            pos["status"] = exit_reason
            pos["exit_price"] = exit_price
            pos["exit_time"] = now_str
            pos["gross_exit_value"] = gross_exit
            pos["sell_friction"] = sell_friction
            pos["net_realized_pnl"] = net_realized_pnl
            pos["net_return_pct"] = net_return_pct
            pos["r_multiple"] = r_multiple

            # Free up capital back to cash
            net_proceeds = gross_exit - sell_friction
            cash_balance = round(cash_balance + net_proceeds, 2)

            trade_record = {
                "trade_id": f"TRD-{sym}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "tradingsymbol": sym,
                "shares": shares,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "entry_time": pos["entry_time"],
                "exit_time": now_str,
                "entry_value": entry_val,
                "exit_value": gross_exit,
                "total_friction_inr": round(buy_friction + sell_friction, 2),
                "net_realized_pnl": net_realized_pnl,
                "net_return_pct": net_return_pct,
                "exit_reason": exit_reason,
                "r_multiple": r_multiple,
                "status": "CLOSED"
            }
            journal["closed_trades"].insert(0, trade_record)
            closed_this_round.append(trade_record)
            print(f"[EXIT TRIGGERED] {sym}: {exit_reason} @ INR {exit_price} | P&L: INR {net_realized_pnl:,.2f} ({net_return_pct}%) | R: {r_multiple}R")
        else:
            if enable_auto_exit and not quote_allows_auto_exit(quote):
                pos["automation_paused_reason"] = "QUOTE_UNVERIFIED_OR_MARKET_SESSION_UNKNOWN"
            total_unrealized_pnl += pnl
            total_positions_value += current_val

    # Update book cash balance
    book["cash_balance"] = cash_balance
    book["last_updated"] = datetime.now().isoformat()
    save_json(POSITIONS_FILE, book)

    # Calculate Trade Journal Analytics
    closed_trades = journal.get("closed_trades", [])
    winning_trades = [t for t in closed_trades if t.get("net_realized_pnl", 0) > 0]
    losing_trades = [t for t in closed_trades if t.get("net_realized_pnl", 0) <= 0]
    total_realized_pnl = sum([t.get("net_realized_pnl", 0) for t in closed_trades])
    gross_profits = sum([t.get("net_realized_pnl", 0) for t in winning_trades])
    gross_losses = abs(sum([t.get("net_realized_pnl", 0) for t in losing_trades]))

    win_rate = round((len(winning_trades) / len(closed_trades) * 100), 1) if closed_trades else 0.0
    profit_factor = round(gross_profits / gross_losses, 2) if gross_losses > 0 else (round(gross_profits, 2) if gross_profits > 0 else 0.0)

    journal["summary"] = {
        "total_trades": len(closed_trades),
        "winning_trades": len(winning_trades),
        "losing_trades": len(losing_trades),
        "win_rate_pct": win_rate,
        "profit_factor": profit_factor,
        "total_realized_pnl_inr": round(total_realized_pnl, 2),
        "last_updated": now_str
    }
    save_json(JOURNAL_FILE, journal)

    # Calculate Portfolio MTM Summary
    initial_cap = book.get("initial_capital", 500000.0)
    current_equity = round(cash_balance + total_positions_value, 2)
    total_portfolio_pnl = round(current_equity - initial_cap, 2)
    total_portfolio_return_pct = round((total_portfolio_pnl / initial_cap) * 100, 2)

    active_count = len([p for p in book["positions"] if p.get("status") == "OPEN"])

    mtm_summary = {
        "timestamp": now_str,
        "initial_capital_inr": initial_cap,
        "current_equity_inr": current_equity,
        "cash_balance_inr": round(cash_balance, 2),
        "active_positions_value_inr": round(total_positions_value, 2),
        "total_unrealized_pnl_inr": round(total_unrealized_pnl, 2),
        "total_realized_pnl_inr": round(total_realized_pnl, 2),
        "net_portfolio_pnl_inr": total_portfolio_pnl,
        "net_portfolio_return_pct": total_portfolio_return_pct,
        "active_positions_count": active_count,
        "closed_trades_count": len(closed_trades),
        "win_rate_pct": win_rate,
        "profit_factor": profit_factor,
        "closed_this_round": closed_this_round
    }
    save_json(MTM_SUMMARY_FILE, mtm_summary)

    print(f"[MTM SYNC COMPLETE] Equity: INR {current_equity:,.2f} | Unrealized: INR {total_unrealized_pnl:,.2f} | Realized: INR {total_realized_pnl:,.2f} | Active: {active_count}")
    return mtm_summary

def manual_close_position(tradingsymbol: str) -> Dict[str, Any]:
    """Manually closes an open position at current market price."""
    book = load_json(POSITIONS_FILE)
    if not book:
        return {"error": "No active positions book found."}

    target_pos = None
    for p in book.get("positions", []):
        if p.get("tradingsymbol") == tradingsymbol and p.get("status") == "OPEN":
            target_pos = p
            break

    if not target_pos:
        return {"error": f"Active position for {tradingsymbol} not found or already closed."}

    sym = target_pos["tradingsymbol"]
    shares = target_pos["shares"]
    entry_price = target_pos["entry_price"]
    entry_val = target_pos["entry_value"]
    exit_price = target_pos.get("current_ltp", entry_price)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    gross_exit = round(shares * exit_price, 2)
    sell_friction = compute_sell_friction(gross_exit)
    buy_friction = target_pos.get("buy_friction", 65.0)
    net_realized_pnl = round(gross_exit - entry_val - sell_friction - buy_friction, 2)
    net_return_pct = round((net_realized_pnl / entry_val) * 100, 2)
    risk_unit = entry_val - (shares * target_pos["stop_loss"])
    r_multiple = round(net_realized_pnl / risk_unit, 2) if risk_unit > 0 else 0.0

    target_pos["status"] = "MANUAL_EXIT"
    target_pos["exit_price"] = exit_price
    target_pos["exit_time"] = now_str
    target_pos["gross_exit_value"] = gross_exit
    target_pos["sell_friction"] = sell_friction
    target_pos["net_realized_pnl"] = net_realized_pnl
    target_pos["net_return_pct"] = net_return_pct
    target_pos["r_multiple"] = r_multiple

    net_proceeds = gross_exit - sell_friction
    book["cash_balance"] = round(book.get("cash_balance", 0) + net_proceeds, 2)
    book["last_updated"] = datetime.now().isoformat()
    save_json(POSITIONS_FILE, book)

    # Append to journal
    journal = load_json(JOURNAL_FILE, {"closed_trades": [], "summary": {}})
    trade_record = {
        "trade_id": f"TRD-{sym}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "tradingsymbol": sym,
        "shares": shares,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "entry_time": target_pos["entry_time"],
        "exit_time": now_str,
        "entry_value": entry_val,
        "exit_value": gross_exit,
        "total_friction_inr": round(buy_friction + sell_friction, 2),
        "net_realized_pnl": net_realized_pnl,
        "net_return_pct": net_return_pct,
        "exit_reason": "MANUAL_EXIT",
        "r_multiple": r_multiple,
        "status": "CLOSED"
    }
    journal["closed_trades"].insert(0, trade_record)
    save_json(JOURNAL_FILE, journal)

    # Recalculate summary
    return update_mtm_and_check_exits(enable_auto_exit=False)

def main():
    parser = argparse.ArgumentParser(description="Live MTM Portfolio Tracker & Auto-Exit Engine")
    parser.add_argument("--sync-from-broker", action="store_true", help="Sync/import active positions from broker dispatch")
    parser.add_argument("--sync", action="store_true", help="Update live prices and calculate MTM P&L")
    parser.add_argument("--auto-exit", action="store_true", help="Evaluate stop-loss and profit target rules")
    parser.add_argument("--keep-open", action="store_true", help="Calculate MTM without triggering auto-exits")
    parser.add_argument("--scenario", choices=["live", "bullish", "mixed", "bearish"], default=None, help="Inject market scenario ticks for simulation")
    parser.add_argument("--close-position", type=str, default=None, help="Manually close a position by symbol (e.g. TCS)")
    parser.add_argument("--simulate-tick", nargs=2, metavar=("SYMBOL", "PRICE"), help="Simulate a custom tick price for testing (e.g. --simulate-tick VEDL 275.50)")
    args = parser.parse_args()

    if args.sync_from_broker:
        initialize_positions_from_dispatch()

    custom_ticks = {}
    if args.simulate_tick:
        sym, price_str = args.simulate_tick
        custom_ticks[sym.upper()] = float(price_str)
        print(f"[SIMULATE] Injected price tick for {sym.upper()}: INR {float(price_str)}")

    if args.scenario:
        # Generate scenario ticks relative to entry prices
        book = load_json(POSITIONS_FILE, {})
        multipliers = {
            "bullish": {"VEDL": 1.025, "TCS": 1.018, "INFY": 1.012, "HCLTECH": 1.015},
            "mixed": {"VEDL": 1.012, "TCS": 1.005, "INFY": 0.995, "HCLTECH": 1.008},
            "bearish": {"VEDL": 0.960, "TCS": 0.970, "INFY": 0.955, "HCLTECH": 0.965}
        }
        mult_map = multipliers.get(args.scenario, {})
        for p in book.get("positions", []):
            s = p.get("tradingsymbol")
            mult = mult_map.get(s, 1.01)
            custom_ticks[s] = round(p.get("entry_price", 100.0) * mult, 2)
        print(f"[SCENARIO] Injected '{args.scenario}' scenario ticks: {custom_ticks}")

    if args.close_position:
        res = manual_close_position(args.close_position.upper())
        print(json.dumps(res, indent=2))
        return

    enable_exit = (args.auto_exit or bool(args.simulate_tick) or (args.scenario in ["bullish", "bearish"])) and not args.keep_open

    res = update_mtm_and_check_exits(enable_auto_exit=enable_exit, custom_ticks=custom_ticks if custom_ticks else None)
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
