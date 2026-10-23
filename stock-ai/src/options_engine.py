"""
NSE Options Strike & Payoff Modeling Engine.
Calculates nearest At-The-Money (ATM) / In-The-Money (ITM) options contracts,
strike intervals, official NSE lot sizes, and leveraged payoff targets for
breakout (CE) and breakdown (PE) opportunities.
"""

import math
from typing import Dict, Optional

# Official NSE F&O contract lot sizes (CORE50 / NIFTY Liquid Equities)
NSE_LOT_SIZES: Dict[str, int] = {
    "RELIANCE.NS": 250,
    "TCS.NS": 175,
    "INFY.NS": 400,
    "HDFCBANK.NS": 550,
    "ICICIBANK.NS": 700,
    "SBIN.NS": 750,
    "BHARTIARTL.NS": 475,
    "LT.NS": 175,
    "SUNPHARMA.NS": 350,
    "VEDL.NS": 2000,
    "HAL.NS": 150,
    "KOTAKBANK.NS": 400,
    "AXISBANK.NS": 625,
    "BAJFINANCE.NS": 750,
    "BAJAJFINSV.NS": 500,
    "INDUSINDBK.NS": 500,
    "WIPRO.NS": 1500,
    "HCLTECH.NS": 350,
    "TECHM.NS": 600,
    "COALINDIA.NS": 2100,
    "ADANIENT.NS": 300,
    "ADANIPORTS.NS": 400,
    "TATASTEEL.NS": 5500,
    "MARUTI.NS": 50,
    "TITAN.NS": 175,
    "DIVISLAB.NS": 100,
    "EICHERMOT.NS": 150,
    "HEROMOTOCO.NS": 150,
    "BAJAJ-AUTO.NS": 75,
    "NTPC.NS": 1500,
    "POWERGRID.NS": 1800,
    "ONGC.NS": 3850,
    "BPCL.NS": 1800,
    "CIPLA.NS": 650,
    "DRREDDY.NS": 125,
    "ASIANPAINT.NS": 200,
    "BEL.NS": 2850,
    "ULTRACEMCO.NS": 100,
    "GRASIM.NS": 250,
    "JSWSTEEL.NS": 675,
    "HINDALCO.NS": 1400,
    "TATACONSUM.NS": 900,
    "NESTLEIND.NS": 250,
    "HINDUNILVR.NS": 300,
    "ITC.NS": 1600,
    "TRENT.NS": 200,
    "SHREECEM.NS": 25,
    "APOLLOHOSP.NS": 125,
    "M&M.NS": 350,
}

# Standard strike gap based on underlying price tier
def get_strike_interval(price: float) -> float:
    """Returns the standard strike step interval for NSE equity options."""
    if price < 100:
        return 2.5
    elif price < 250:
        return 5.0
    elif price < 500:
        return 10.0
    elif price < 1000:
        return 20.0
    elif price < 2500:
        return 50.0
    elif price < 5000:
        return 100.0
    elif price < 10000:
        return 200.0
    else:
        return 500.0


def calculate_atm_strike(underlying_price: float, direction: str = "LONG") -> float:
    """Calculates the nearest At-The-Money (ATM) strike price."""
    step = get_strike_interval(underlying_price)
    if direction == "LONG":
        # Nearest round strike at or slightly above price
        return round(round(underlying_price / step) * step, 1)
    else:
        # Nearest round strike at or slightly below price
        return round(round(underlying_price / step) * step, 1)


def calculate_option_recommendation(
    ticker: str,
    underlying_price: float,
    direction: str = "LONG",
    target_stock_pct: float = 0.02,
    capital_budget: float = 25000.0,
    days_to_expiry: int = 15,
) -> Dict:
    """
    Computes complete options trade specification:
      - Option Type: CE (Call) for LONG, PE (Put) for SHORT
      - ATM Strike Price
      - Estimated Entry Premium
      - Target Premium (+40% to +70% on +2% stock move)
      - Stop Loss Premium (-25% to -30%)
      - Lot Size and Recommended Lot Count for capital budget
      - Estimated Net Payoff in Rupees
    """
    symbol = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
    lot_size = NSE_LOT_SIZES.get(symbol, 500)
    option_type = "CE" if direction == "LONG" else "PE"
    strike = calculate_atm_strike(underlying_price, direction)

    # Empirical ATM premium approximation: ~2.2% to 3.5% of underlying price for ~15 DTE
    time_factor = math.sqrt(max(1, days_to_expiry) / 30.0)
    base_premium_pct = 0.026 * time_factor
    est_entry_premium = max(1.0, round(underlying_price * base_premium_pct, 2))

    # Delta modeling (ATM Delta ~ 0.50)
    delta = 0.52 if direction == "LONG" else -0.50
    expected_underlying_move = underlying_price * target_stock_pct
    expected_premium_gain = round(expected_underlying_move * abs(delta) * 1.15, 2) # Include slight gamma expansion

    target_premium = round(est_entry_premium + expected_premium_gain, 2)
    stop_premium = round(est_entry_premium * 0.72, 2) # Hard -28% stop loss on premium

    expected_roi_pct = round(((target_premium - est_entry_premium) / est_entry_premium) * 100, 1)
    max_risk_pct = round(((est_entry_premium - stop_premium) / est_entry_premium) * 100, 1)

    cost_per_lot = round(est_entry_premium * lot_size, 2)
    # Recommend number of lots based on capital budget (min 1 lot)
    recommended_lots = max(1, int(capital_budget // max(1.0, cost_per_lot)))
    total_investment = round(cost_per_lot * recommended_lots, 2)

    projected_profit_inr = round((target_premium - est_entry_premium) * lot_size * recommended_lots, 2)
    max_risk_inr = round((est_entry_premium - stop_premium) * lot_size * recommended_lots, 2)

    return {
        "ticker": ticker,
        "underlyingPrice": underlying_price,
        "direction": direction,
        "optionType": option_type,
        "strikePrice": strike,
        "symbolFormatted": f"{ticker.replace('.NS', '')} {int(strike) if strike.is_integer() else strike} {option_type}",
        "lotSize": lot_size,
        "recommendedLots": recommended_lots,
        "estimatedPremium": est_entry_premium,
        "targetPremium": target_premium,
        "stopPremium": stop_premium,
        "costPerLot": cost_per_lot,
        "totalInvestmentInr": total_investment,
        "projectedProfitInr": projected_profit_inr,
        "maxRiskInr": max_risk_inr,
        "expectedRoiPct": expected_roi_pct,
        "maxRiskPct": max_risk_pct,
        "delta": round(abs(delta), 2),
        "executionGuideline": f"Buy {recommended_lots} lot(s) of {int(strike) if strike.is_integer() else strike} {option_type} near Rs. {est_entry_premium}. Exit at Target Rs. {target_premium} (+{expected_roi_pct}%) or Stop Rs. {stop_premium}.",
    }


# ==========================================================================
# NSE F&O LIVE DATA — OI, PCR, MAX PAIN (NSE Bhav Copy)
# ==========================================================================

import sys
import json
import logging
import time
import urllib.request
import io
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import List, Optional, Tuple
import pandas as pd

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

_logger = logging.getLogger(__name__)

NSE_BHAV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}


def _get_nse_bhav_url(target_date: Optional[date] = None) -> str:
    """Builds the NSE F&O EOD bhav copy URL for the given date."""
    if target_date is None:
        target_date = date.today()
    date_str = target_date.strftime("%d%b%Y").upper()
    return f"https://archives.nseindia.com/content/fo/fo_bhavdata_full_{date_str}.csv"


def download_fo_bhav(target_date: Optional[date] = None, lookback_days: int = 5) -> Optional[pd.DataFrame]:
    """
    Downloads NSE F&O EOD bhav copy for the given date.
    Tries up to 'lookback_days' previous days if the given date is not available
    (handles weekends / holidays automatically).
    """
    if target_date is None:
        target_date = date.today()

    for offset in range(lookback_days):
        attempt_date = target_date - timedelta(days=offset)
        url = _get_nse_bhav_url(attempt_date)
        try:
            req = urllib.request.Request(url, headers=NSE_BHAV_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read()
            df = pd.read_csv(io.StringIO(raw.decode("utf-8", errors="replace")))
            df.columns = [c.strip() for c in df.columns]
            _logger.info(f"[Options] Downloaded F&O bhav for {attempt_date}: {len(df)} rows.")
            return df
        except Exception as e:
            _logger.debug(f"[Options] No bhav for {attempt_date}: {e}")

    _logger.warning(f"[Options] Could not download F&O bhav for last {lookback_days} days.")
    return None


def _compute_pcr_max_pain(bhav_df: pd.DataFrame, symbol: str) -> Dict:
    """
    Computes Put/Call Ratio (PCR) and Max Pain level for a given equity symbol.

    PCR = Total Put OI / Total Call OI (by open interest, not premium)
    Max Pain = Strike where total options (CE + PE) holders lose the most money
               (i.e., the strike at which total option value at expiry is minimized for buyers)
    """
    sym_clean = symbol.replace(".NS", "").upper().strip()
    # NSE bhav typically has columns: SYMBOL, EXPIRY_DT, STRIKE_PR, OPTION_TYP, OPEN_INT, CHG_IN_OI, ...
    sym_df = bhav_df[bhav_df["SYMBOL"].astype(str).str.strip().str.upper() == sym_clean]

    if sym_df.empty:
        return {}

    # Take nearest expiry (smallest expiry date >= today)
    try:
        sym_df = sym_df.copy()
        sym_df["EXPIRY_DT"] = pd.to_datetime(sym_df["EXPIRY_DT"], errors="coerce", dayfirst=True)
        today_ts = pd.Timestamp(date.today())
        future_expiries = sym_df[sym_df["EXPIRY_DT"] >= today_ts]["EXPIRY_DT"].unique()
        if len(future_expiries) == 0:
            return {}
        nearest_expiry = min(future_expiries)
        sym_df = sym_df[sym_df["EXPIRY_DT"] == nearest_expiry].copy()
    except Exception:
        return {}

    # OI columns
    oi_col = "OPEN_INT" if "OPEN_INT" in sym_df.columns else "OI"
    if oi_col not in sym_df.columns:
        return {}

    sym_df[oi_col] = pd.to_numeric(sym_df[oi_col], errors="coerce").fillna(0)
    sym_df["STRIKE_PR"] = pd.to_numeric(sym_df["STRIKE_PR"], errors="coerce")

    call_df = sym_df[sym_df["OPTION_TYP"].astype(str).str.strip().str.upper() == "CE"]
    put_df = sym_df[sym_df["OPTION_TYP"].astype(str).str.strip().str.upper() == "PE"]

    total_call_oi = call_df[oi_col].sum()
    total_put_oi = put_df[oi_col].sum()
    total_oi = total_call_oi + total_put_oi

    pcr = round(total_put_oi / total_call_oi, 3) if total_call_oi > 0 else None

    # PCR interpretation
    if pcr is None:
        pcr_signal = "unknown"
    elif pcr > 1.3:
        pcr_signal = "bullish"   # High put buying = contrarian bullish
    elif pcr < 0.7:
        pcr_signal = "bearish"   # Low put buying = complacency
    else:
        pcr_signal = "neutral"

    # Max Pain Calculation
    strikes = sorted(sym_df["STRIKE_PR"].dropna().unique())
    min_pain = float("inf")
    max_pain_strike = None

    call_oi_by_strike = call_df.set_index("STRIKE_PR")[oi_col].to_dict()
    put_oi_by_strike = put_df.set_index("STRIKE_PR")[oi_col].to_dict()

    for test_strike in strikes:
        # Compute total value at expiry if market closes at test_strike
        call_value = sum(
            max(0, test_strike - s) * oi
            for s, oi in call_oi_by_strike.items()
        )
        put_value = sum(
            max(0, s - test_strike) * oi
            for s, oi in put_oi_by_strike.items()
        )
        total_pain = call_value + put_value
        if total_pain < min_pain:
            min_pain = total_pain
            max_pain_strike = test_strike

    # OI Change (if CHG_IN_OI available)
    oi_change_col = "CHG_IN_OI" if "CHG_IN_OI" in sym_df.columns else None
    total_oi_change = None
    if oi_change_col:
        sym_df[oi_change_col] = pd.to_numeric(sym_df[oi_change_col], errors="coerce").fillna(0)
        total_oi_change = int(sym_df[oi_change_col].sum())

    return {
        "symbol": sym_clean,
        "ticker": f"{sym_clean}.NS",
        "expiry": nearest_expiry.strftime("%Y-%m-%d") if nearest_expiry else None,
        "total_oi": int(total_oi),
        "call_oi": int(total_call_oi),
        "put_oi": int(total_put_oi),
        "pcr": pcr,
        "pcr_signal": pcr_signal,
        "max_pain": float(max_pain_strike) if max_pain_strike is not None else None,
        "total_oi_change": total_oi_change,
        "lot_size": NSE_LOT_SIZES.get(f"{sym_clean}.NS", 500),
    }


def build_options_snapshot(
    tickers: Optional[List[str]] = None,
    force_refresh: bool = False,
) -> Dict[str, Dict]:
    """
    Builds a complete F&O options snapshot for all eligible tickers.
    Downloads NSE bhav copy once and processes all tickers from it.

    Args:
        tickers: List of NSE tickers. Defaults to config.STOCK_UNIVERSE filtered by F&O eligibility.
        force_refresh: Re-download bhav even if fresh cache exists.

    Returns:
        Dict mapping ticker → options data dict.
    """
    if tickers is None:
        tickers = list(NSE_LOT_SIZES.keys())  # Only F&O eligible stocks

    # Check cache freshness (EOD data, so 6h is fine during market hours)
    if config.OPTIONS_FILE.exists() and not force_refresh:
        try:
            age_hours = (time.time() - config.OPTIONS_FILE.stat().st_mtime) / 3600
            if age_hours < 6:
                with open(config.OPTIONS_FILE, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                _logger.info(f"[Options] Using cached options snapshot ({age_hours:.1f}h old).")
                return cached
        except Exception:
            pass

    # Download latest bhav
    bhav_df = download_fo_bhav()
    if bhav_df is None or bhav_df.empty:
        _logger.warning("[Options] No bhav data. Returning empty snapshot.")
        return {}

    snapshot: Dict[str, Dict] = {}
    for ticker in tickers:
        data = _compute_pcr_max_pain(bhav_df, ticker)
        if data:
            snapshot[ticker] = data

    # Save snapshot
    try:
        config.OPTIONS_DIR.mkdir(parents=True, exist_ok=True)
        with open(config.OPTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
        _logger.info(f"[Options] Snapshot saved: {len(snapshot)} F&O stocks processed.")
    except Exception as e:
        _logger.error(f"[Options] Failed to save options snapshot: {e}")

    return snapshot


def get_options_for_ticker(ticker: str) -> Optional[Dict]:
    """Returns options data for a single ticker from the cached snapshot."""
    if config.OPTIONS_FILE.exists():
        try:
            with open(config.OPTIONS_FILE, "r", encoding="utf-8") as f:
                snap = json.load(f)
            return snap.get(ticker)
        except Exception:
            pass
    return None


def is_fo_eligible(ticker: str) -> bool:
    """Returns True if the ticker is F&O eligible (has a lot size defined)."""
    normalized = ticker if ticker.endswith(".NS") else f"{ticker}.NS"
    return normalized in NSE_LOT_SIZES


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    _logger.info("Building F&O options snapshot...")
    snap = build_options_snapshot(force_refresh=True)
    print(f"\nOptions snapshot: {len(snap)} stocks")
    for ticker, data in list(snap.items())[:5]:
        print(f"  {ticker:<20} PCR: {data.get('pcr'):<6} Max Pain: {data.get('max_pain'):<8} Total OI: {data.get('total_oi')}")
