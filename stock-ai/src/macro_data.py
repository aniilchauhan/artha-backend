"""
Macro Market Data Module.
Fetches and caches global macro indicators relevant to Indian NSE trading:
  - Crude Oil (Brent BZ=F): Energy sector, transport, inflation proxy
  - Gold (GC=F): Safe haven, jewelry sector
  - USD/INR (USDINR=X): FII flow signal, IT/pharma sector
  - India VIX (^INDIAVIX): Fear index, market risk-on/off
  - US 10-Year Bond Yield (^TNX): Global rate environment
  - DXY Dollar Index (DX-Y.NYB): Emerging market capital flow
  - Nifty 50 (^NSEI): Primary market index
  - BankNifty (^NSEBANK): Banking sector proxy

Refreshed daily. Stores snapshot JSON for API serving.
"""

import sys
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

import yfinance as yf
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


MACRO_TICKERS = {
    "crude": {
        "symbol": "BZ=F",
        "name": "Brent Crude Oil",
        "unit": "USD/bbl",
        "icon": "🛢️",
        "sector_impact": "Energy, Transport, FMCG",
    },
    "gold": {
        "symbol": "GC=F",
        "name": "Gold",
        "unit": "USD/oz",
        "icon": "🥇",
        "sector_impact": "Metals, Jewellery, Safe Haven",
    },
    "silver": {
        "symbol": "SI=F",
        "name": "Silver",
        "unit": "USD/oz",
        "icon": "🥈",
        "sector_impact": "Metals, Industrial",
    },
    "usdinr": {
        "symbol": "USDINR=X",
        "name": "USD/INR Exchange Rate",
        "unit": "INR per USD",
        "icon": "💱",
        "sector_impact": "IT, Pharma, Exports, FII Flows",
    },
    "vix_india": {
        "symbol": "^INDIAVIX",
        "name": "India VIX",
        "unit": "Points",
        "icon": "📉",
        "sector_impact": "Market-wide fear index",
    },
    "vix_us": {
        "symbol": "^VIX",
        "name": "CBOE VIX (US)",
        "unit": "Points",
        "icon": "🌐",
        "sector_impact": "Global risk-off signal",
    },
    "us10y": {
        "symbol": "^TNX",
        "name": "US 10-Year Treasury Yield",
        "unit": "% per annum",
        "icon": "📈",
        "sector_impact": "Banking, NBFC, Global rate pressure",
    },
    "dxy": {
        "symbol": "DX-Y.NYB",
        "name": "US Dollar Index (DXY)",
        "unit": "Index",
        "icon": "💵",
        "sector_impact": "EM capital flows, FII activity",
    },
    "nifty50": {
        "symbol": "^NSEI",
        "name": "Nifty 50",
        "unit": "Points",
        "icon": "🇮🇳",
        "sector_impact": "Broad market benchmark",
    },
    "banknifty": {
        "symbol": "^NSEBANK",
        "name": "Bank Nifty",
        "unit": "Points",
        "icon": "🏦",
        "sector_impact": "Banking sector benchmark",
    },
}


def _safe_float(val: Any) -> Optional[float]:
    """Safely converts to float, returning None for NaN/None."""
    if val is None:
        return None
    try:
        result = float(val)
        if result != result:  # NaN
            return None
        return round(result, 4)
    except (TypeError, ValueError):
        return None


def fetch_macro_snapshot(force_refresh: bool = False, max_age_hours: float = 4.0) -> Dict:
    """
    Fetches current macro market data and stores as a snapshot.
    Uses cache if data is fresh enough (default: 4 hours).

    Returns:
        Dict with macro indicators, each containing:
          price, change_1d, change_1d_pct, change_5d_pct,
          week_52_high, week_52_low, name, unit, icon, sector_impact
    """
    # Check cache freshness
    if config.MACRO_SNAPSHOT_FILE.exists() and not force_refresh:
        try:
            age_hours = (time.time() - config.MACRO_SNAPSHOT_FILE.stat().st_mtime) / 3600
            if age_hours < max_age_hours:
                with open(config.MACRO_SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                logger.info(f"[Macro] Using cached snapshot ({age_hours:.1f}h old).")
                return cached
        except Exception:
            pass

    snapshot = {
        "fetched_at": datetime.now().isoformat(),
        "indicators": {},
    }

    symbols = [meta["symbol"] for meta in MACRO_TICKERS.values()]
    logger.info(f"[Macro] Downloading {len(symbols)} macro instruments via yfinance...")

    try:
        data = yf.download(
            tickers=symbols,
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        logger.error(f"[Macro] yfinance bulk download failed: {e}")
        data = None

    for key, meta in MACRO_TICKERS.items():
        symbol = meta["symbol"]
        try:
            if data is not None and not data.empty:
                if len(symbols) == 1:
                    ticker_df = data
                else:
                    if symbol in data.columns.get_level_values(0):
                        ticker_df = data[symbol]
                    else:
                        ticker_df = pd.DataFrame()
            else:
                ticker_df = pd.DataFrame()

            close_series = None
            if not ticker_df.empty and "Close" in ticker_df.columns:
                close_series = ticker_df["Close"].dropna()

            if close_series is not None and len(close_series) >= 1:
                current = _safe_float(close_series.iloc[-1])
                prev1d = _safe_float(close_series.iloc[-2]) if len(close_series) >= 2 else None
                prev5d = _safe_float(close_series.iloc[0]) if len(close_series) >= 5 else None

                change_1d = None
                change_1d_pct = None
                if current is not None and prev1d is not None and prev1d != 0:
                    change_1d = round(current - prev1d, 4)
                    change_1d_pct = round((current - prev1d) / prev1d * 100, 3)

                change_5d_pct = None
                if current is not None and prev5d is not None and prev5d != 0:
                    change_5d_pct = round((current - prev5d) / prev5d * 100, 3)

                snapshot["indicators"][key] = {
                    "symbol": symbol,
                    "name": meta["name"],
                    "unit": meta["unit"],
                    "icon": meta["icon"],
                    "sector_impact": meta["sector_impact"],
                    "price": current,
                    "change_1d": change_1d,
                    "change_1d_pct": change_1d_pct,
                    "change_5d_pct": change_5d_pct,
                }
            else:
                # Individual ticker fallback
                logger.debug(f"[Macro] Fallback single fetch for {symbol}...")
                try:
                    single = yf.Ticker(symbol)
                    hist = single.history(period="5d")
                    if not hist.empty and "Close" in hist.columns:
                        closes = hist["Close"].dropna()
                        current = _safe_float(closes.iloc[-1])
                        prev1d = _safe_float(closes.iloc[-2]) if len(closes) >= 2 else None
                        change_1d_pct = round((current - prev1d) / prev1d * 100, 3) if current and prev1d and prev1d != 0 else None
                        snapshot["indicators"][key] = {
                            "symbol": symbol,
                            "name": meta["name"],
                            "unit": meta["unit"],
                            "icon": meta["icon"],
                            "sector_impact": meta["sector_impact"],
                            "price": current,
                            "change_1d": round(current - prev1d, 4) if current and prev1d else None,
                            "change_1d_pct": change_1d_pct,
                            "change_5d_pct": None,
                        }
                    else:
                        raise ValueError("Empty history")
                except Exception as fallback_err:
                    logger.warning(f"[Macro] Could not fetch {symbol}: {fallback_err}")
                    snapshot["indicators"][key] = {
                        "symbol": symbol,
                        "name": meta["name"],
                        "unit": meta["unit"],
                        "icon": meta["icon"],
                        "sector_impact": meta["sector_impact"],
                        "price": None,
                        "change_1d": None,
                        "change_1d_pct": None,
                        "change_5d_pct": None,
                        "error": "unavailable",
                    }

        except Exception as e:
            logger.warning(f"[Macro] Error processing {symbol}: {e}")
            snapshot["indicators"][key] = {
                "symbol": symbol,
                "name": meta["name"],
                "unit": meta["unit"],
                "icon": meta["icon"],
                "sector_impact": meta["sector_impact"],
                "price": None,
                "change_1d_pct": None,
                "error": str(e),
            }

    # Add market context / signals
    snapshot["signals"] = _generate_macro_signals(snapshot["indicators"])

    # Save to disk
    try:
        config.MACRO_DIR.mkdir(parents=True, exist_ok=True)
        with open(config.MACRO_SNAPSHOT_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
        logger.info(f"[Macro] Snapshot saved: {len(snapshot['indicators'])} indicators.")
    except Exception as e:
        logger.error(f"[Macro] Failed to save snapshot: {e}")

    return snapshot


def _generate_macro_signals(indicators: Dict) -> List[Dict]:
    """Generates macro market context signals from indicator readings."""
    signals = []

    vix = indicators.get("vix_india", {}).get("price")
    if vix is not None:
        if vix > 20:
            signals.append({
                "signal": "HIGH_FEAR",
                "label": "High Volatility — Market Fear Elevated",
                "detail": f"India VIX at {vix:.1f} (>20). Exercise caution.",
                "sentiment": "bearish",
            })
        elif vix < 12:
            signals.append({
                "signal": "LOW_VOLATILITY",
                "label": "Low Volatility — Market Complacent",
                "detail": f"India VIX at {vix:.1f} (<12). Risk-on environment.",
                "sentiment": "bullish",
            })

    crude = indicators.get("crude", {}).get("change_1d_pct")
    if crude is not None and abs(crude) > 2.0:
        signals.append({
            "signal": "CRUDE_MOVE",
            "label": f"Crude Oil {'Surge' if crude > 0 else 'Drop'}: {crude:+.1f}%",
            "detail": "Watch Energy (ONGC, Reliance) and Transport (SpiceJet, IndiGo) stocks.",
            "sentiment": "bearish" if crude > 3 else "bullish" if crude < -3 else "neutral",
        })

    usdinr = indicators.get("usdinr", {}).get("price")
    if usdinr is not None:
        if usdinr > 86:
            signals.append({
                "signal": "WEAK_RUPEE",
                "label": f"Rupee Weak: ₹{usdinr:.1f}/USD",
                "detail": "IT & Pharma exporters benefit. Import-heavy sectors at risk.",
                "sentiment": "mixed",
            })

    us10y = indicators.get("us10y", {}).get("price")
    if us10y is not None and us10y > 4.5:
        signals.append({
            "signal": "HIGH_US_RATES",
            "label": f"US 10Y Yield High: {us10y:.2f}%",
            "detail": "FII outflows risk elevated. Rate-sensitive sectors under pressure.",
            "sentiment": "bearish",
        })

    return signals


def load_macro_snapshot() -> Dict:
    """Loads the macro snapshot from disk. Fetches fresh if not available."""
    if config.MACRO_SNAPSHOT_FILE.exists():
        try:
            with open(config.MACRO_SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return fetch_macro_snapshot()


if __name__ == "__main__":
    logger.info("Fetching macro market snapshot...")
    snap = fetch_macro_snapshot(force_refresh=True)
    print(f"\nMacro Snapshot — {snap['fetched_at']}")
    print("-" * 60)
    for key, ind in snap["indicators"].items():
        price = ind.get("price")
        chg = ind.get("change_1d_pct")
        print(f"  {ind['icon']}  {key:<14} {ind['name']:<30} "
              f"{price:>10.2f} {ind['unit']:<15} "
              f"{chg:+.2f}%" if price and chg else f"  {ind['icon']}  {key:<14} {ind['name']:<30} N/A")
    if snap.get("signals"):
        print("\n📊 Market Signals:")
        for sig in snap["signals"]:
            print(f"  [{sig['sentiment'].upper()}] {sig['label']}")
