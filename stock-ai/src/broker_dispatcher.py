"""
Indian Broker Sandbox Webhook & Order Dispatcher for Axion Stock AI.
Converts calibrated portfolio allocation orders into broker-compliant schemas:
  - Zerodha Kite Connect API format
  - Angel One SmartAPI format
  - Dhan HQ API format
  - Zerodha Basket CSV (drag-and-drop 1-click import into Kite Web)
  - Generic Webhook JSON (for TradingView / Telegram / custom gateways)

Modes:
  1. SIMULATED_SANDBOX: Generates verified mock fills with realistic 0.05% slippage,
     computes Indian transaction taxes (STT, GST, exchange turnover), and returns
     immutable order execution receipts.
  2. LIVE_WEBHOOK: Dispatches structured JSON payloads to a specified webhook endpoint.
"""

import sys
import os
import json
import logging
import argparse
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))
import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("broker_dispatcher")

PAPER_DIR = config.OUTPUTS_DIR / "paper_trading"
PORTFOLIO_FILE = PAPER_DIR / "portfolio_allocation.json"
RECEIPTS_FILE = PAPER_DIR / "broker_dispatch_receipts.json"
BASKET_CSV_FILE = PAPER_DIR / "zerodha_basket.csv"


def clean_ticker_for_broker(ticker: str) -> str:
    """Removes .NS or .BO suffix for Indian broker trading symbols."""
    return ticker.replace(".NS", "").replace(".BO", "").strip().upper()


def format_zerodha_orders(orders: List[Dict]) -> List[Dict]:
    """Formats orders for Zerodha Kite Connect API."""
    kite_orders = []
    for ord_item in orders:
        if ord_item.get("shares_to_buy", 0) <= 0:
            continue
        symbol = clean_ticker_for_broker(ord_item["ticker"])
        kite_orders.append({
            "tradingsymbol": symbol,
            "exchange": "NSE",
            "transaction_type": "BUY",
            "order_type": "LIMIT",
            "quantity": int(ord_item["shares_to_buy"]),
            "product": "CNC",
            "price": round(float(ord_item["breakout_trigger_inr"]), 2),
            "trigger_price": 0.0,
            "tag": "AXION_STOCK_AI",
            "validity": "DAY",
            "stoploss": round(float(ord_item.get("stop_loss_inr", 0.0)), 2),
            "target": round(float(ord_item.get("profit_target_inr", 0.0)), 2),
        })
    return kite_orders


def format_angelone_orders(orders: List[Dict]) -> List[Dict]:
    """Formats orders for Angel One SmartAPI."""
    angel_orders = []
    for ord_item in orders:
        if ord_item.get("shares_to_buy", 0) <= 0:
            continue
        symbol = clean_ticker_for_broker(ord_item["ticker"])
        angel_orders.append({
            "variety": "NORMAL",
            "tradingsymbol": f"{symbol}-EQ",
            "symboltoken": "0",  # Placeholder mapped by broker gateway
            "transactiontype": "BUY",
            "exchange": "NSE",
            "ordertype": "LIMIT",
            "producttype": "DELIVERY",
            "duration": "DAY",
            "price": str(round(float(ord_item["breakout_trigger_inr"]), 2)),
            "quantity": str(int(ord_item["shares_to_buy"])),
            "tag": "AXION_STOCK_AI",
        })
    return angel_orders


def format_dhan_orders(orders: List[Dict]) -> List[Dict]:
    """Formats orders for Dhan HQ API."""
    dhan_orders = []
    for ord_item in orders:
        if ord_item.get("shares_to_buy", 0) <= 0:
            continue
        symbol = clean_ticker_for_broker(ord_item["ticker"])
        dhan_orders.append({
            "dhanClientId": "AXION_USER",
            "transactionType": "BUY",
            "exchangeSegment": "NSE_EQ",
            "productType": "CNC",
            "orderType": "LIMIT",
            "validity": "DAY",
            "securityId": symbol,
            "quantity": int(ord_item["shares_to_buy"]),
            "price": round(float(ord_item["breakout_trigger_inr"]), 2),
            "triggerPrice": 0.0,
            "afterMarketOrder": False,
        })
    return dhan_orders


def export_zerodha_basket_csv(orders: List[Dict], output_file: Path = BASKET_CSV_FILE) -> str:
    """
    Exports CSV compatible with Zerodha Kite Web Basket import:
    Format: Instrument,Exchange,Order Type,Product,Action,Quantity,Limit Price,Trigger Price
    """
    rows = []
    for ord_item in orders:
        if ord_item.get("shares_to_buy", 0) <= 0:
            continue
        symbol = clean_ticker_for_broker(ord_item["ticker"])
        rows.append({
            "Instrument": symbol,
            "Exchange": "NSE",
            "Order Type": "LIMIT",
            "Product": "CNC",
            "Action": "BUY",
            "Quantity": int(ord_item["shares_to_buy"]),
            "Limit Price": round(float(ord_item["breakout_trigger_inr"]), 2),
            "Trigger Price": 0,
        })

    df = pd.DataFrame(rows)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_file, index=False)
    logger.info(f"Saved Zerodha Basket CSV ({len(df)} orders): {output_file}")
    return str(output_file)


def simulate_sandbox_execution(broker: str, orders: List[Dict], capital_base: float) -> Dict:
    """
    Generates realistic simulated order execution receipts:
      - 0.05% realistic execution slippage.
      - STT 0.1% on delivery buys.
      - Flat ₹20 brokerage per executed basket order.
      - GST 18% on brokerage & exchange fees.
      - Unique simulated order ID.
    """
    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    timestamp_id = now.strftime("%Y%m%d%H%M%S")

    simulated_orders = []
    total_gross_inr = 0.0
    total_brokerage_inr = 0.0
    total_stt_inr = 0.0
    total_gst_inr = 0.0

    for idx, ord_item in enumerate(orders, start=1):
        if ord_item.get("shares_to_buy", 0) <= 0:
            continue

        symbol = clean_ticker_for_broker(ord_item["ticker"])
        trigger_price = float(ord_item["breakout_trigger_inr"])
        shares = int(ord_item["shares_to_buy"])

        # Add 0.05% slippage on breakout
        fill_price = round(trigger_price * 1.0005, 2)
        gross_value = round(shares * fill_price, 2)
        total_gross_inr += gross_value

        # Taxes and fees
        stt = round(gross_value * 0.001, 2)  # 0.1% STT on equity delivery
        brokerage = 20.0  # Flat ₹20 per trade on Zerodha / Angel / Dhan
        exchange_turnover = round(gross_value * 0.0000345, 2)
        gst = round((brokerage + exchange_turnover) * 0.18, 2)  # 18% GST on services

        total_stt_inr += stt
        total_brokerage_inr += brokerage
        total_gst_inr += gst

        order_id = f"SIM-{broker.upper()[:4]}-{timestamp_id}-{idx:03d}"

        simulated_orders.append({
            "order_id": order_id,
            "broker": broker.upper(),
            "tradingsymbol": symbol,
            "shares": shares,
            "trigger_price_inr": trigger_price,
            "fill_price_inr": fill_price,
            "gross_value_inr": gross_value,
            "stop_loss_inr": float(ord_item.get("stop_loss_inr", 0.0)),
            "profit_target_inr": float(ord_item.get("profit_target_inr", 0.0)),
            "taxes_and_charges_inr": round(stt + brokerage + exchange_turnover + gst, 2),
            "status": "FILLED_SANDBOX",
            "filled_at": now_str,
            "tag": "AXION_STOCK_AI",
        })

    total_taxes = round(total_stt_inr + total_brokerage_inr + total_gst_inr, 2)
    net_deployed = round(total_gross_inr + total_taxes, 2)
    cash_remaining = round(max(0.0, capital_base - net_deployed), 2)

    receipt = {
        "dispatch_id": f"DISPATCH-{timestamp_id}",
        "broker": broker.upper(),
        "mode": "SIMULATED_SANDBOX",
        "timestamp": now_str,
        "total_orders": len(simulated_orders),
        "total_gross_capital_inr": round(total_gross_inr, 2),
        "total_taxes_and_charges_inr": total_taxes,
        "net_capital_deployed_inr": net_deployed,
        "cash_remaining_inr": cash_remaining,
        "status": "ALL_ORDERS_FILLED",
        "executed_orders": simulated_orders,
    }

    return receipt


def dispatch_live_webhook(webhook_url: str, payload: Dict) -> Dict:
    """Dispatches payload to an external HTTP webhook."""
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            webhook_url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Axion-StockAI-Dispatcher/1.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            code = resp.getcode()
            body = resp.read().decode("utf-8", errors="replace")
            logger.info(f"Webhook dispatched to {webhook_url} (HTTP {code})")
            return {
                "success": True,
                "status_code": code,
                "response": body[:200],
            }
    except Exception as e:
        logger.error(f"Webhook dispatch failed: {e}")
        return {
            "success": False,
            "error": str(e),
        }


def run_broker_dispatch(
    broker: str = "zerodha",
    mode: str = "sandbox",
    webhook_url: Optional[str] = None,
) -> Dict:
    """
    Main dispatch entry point.
    """
    if not PORTFOLIO_FILE.exists():
        raise FileNotFoundError(f"Portfolio allocation file not found at {PORTFOLIO_FILE}. Run paper_trading.py first.")

    with open(PORTFOLIO_FILE, "r", encoding="utf-8") as f:
        portfolio = json.load(f)

    orders = portfolio.get("orders", [])
    capital_base = float(portfolio.get("capital_base_inr", 1000000.0))

    broker_lower = broker.lower().strip()

    # Generate broker specific payloads
    if broker_lower == "zerodha":
        broker_payload = format_zerodha_orders(orders)
    elif broker_lower == "angelone":
        broker_payload = format_angelone_orders(orders)
    elif broker_lower == "dhan":
        broker_payload = format_dhan_orders(orders)
    else:  # Generic
        broker_payload = orders

    # Always generate/update Zerodha Basket CSV
    basket_path = export_zerodha_basket_csv(orders)

    # Simulated sandbox execution
    receipt = simulate_sandbox_execution(broker_lower, orders, capital_base)
    receipt["broker_payload"] = broker_payload
    receipt["basket_csv_path"] = basket_path

    # If live webhook requested and URL provided
    if mode.lower() == "webhook" and webhook_url:
        webhook_res = dispatch_live_webhook(webhook_url, receipt)
        receipt["webhook_delivery"] = webhook_res

    # Save to receipts file
    with open(RECEIPTS_FILE, "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=4)
    logger.info(f"Persisted broker dispatch receipt: {RECEIPTS_FILE}")

    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Indian Broker Order Dispatcher")
    parser.add_argument(
        "--broker",
        type=str,
        default="zerodha",
        choices=["zerodha", "angelone", "dhan", "generic"],
        help="Target broker format",
    )
    parser.add_argument(
        "--mode",
        type=str,
        default="sandbox",
        choices=["sandbox", "webhook"],
        help="Execution mode (sandbox or webhook)",
    )
    parser.add_argument("--webhook-url", type=str, default=None, help="Target webhook endpoint")

    args = parser.parse_args()
    res = run_broker_dispatch(broker=args.broker, mode=args.mode, webhook_url=args.webhook_url)

    print("\n" + "=" * 80)
    print(f"INDIAN BROKER DISPATCH RECEIPT ({res['broker']} - {res['mode']})")
    print(f"Dispatch ID     : {res['dispatch_id']}")
    print(f"Timestamp       : {res['timestamp']}")
    print(f"Total Orders    : {res['total_orders']}")
    print(f"Gross Capital   : Rs. {res['total_gross_capital_inr']:,.2f}")
    print(f"Taxes & Charges : Rs. {res['total_taxes_and_charges_inr']:,.2f}")
    print(f"Net Deployed    : Rs. {res['net_capital_deployed_inr']:,.2f}")
    print(f"Cash Remaining  : Rs. {res['cash_remaining_inr']:,.2f}")
    print("=" * 80)

    for o in res["executed_orders"]:
        print(
            f"  {o['order_id']} | {o['tradingsymbol']:<10} | Qty: {o['shares']:<4} "
            f"| Fill: Rs.{o['fill_price_inr']:>8.2f} | Total: Rs.{o['gross_value_inr']:>9,.2f} "
            f"| Status: {o['status']}"
        )
    print("=" * 80 + "\n")
