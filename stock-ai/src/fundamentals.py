"""
Fundamentals Data Module for Indian NSE Stocks.
Fetches and caches key fundamental financial metrics per ticker using yfinance.
Data includes: P/E, P/B, EPS, ROE, ROCE, Debt/Equity, Revenue Growth, Margins,
Dividend Yield, Free Cash Flow, and Book Value.

Designed for weekly refreshes — fundamentals don't change daily.
Stores per-ticker JSON files and a combined summary for fast lookups.
"""

import sys
import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any

import yfinance as yf

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

# Fields to extract from yfinance .info dict
FUNDAMENTAL_FIELDS = {
    # Valuation
    "trailingPE": "pe_ratio",
    "forwardPE": "pe_forward",
    "priceToBook": "pb_ratio",
    "enterpriseToEbitda": "ev_ebitda",
    "priceToSalesTrailing12Months": "ps_ratio",
    # Earnings
    "trailingEps": "eps_ttm",
    "forwardEps": "eps_forward",
    "earningsGrowth": "earnings_growth",
    # Profitability
    "returnOnEquity": "roe",
    "returnOnAssets": "roa",
    "grossMargins": "gross_margin",
    "operatingMargins": "operating_margin",
    "profitMargins": "net_margin",
    # Revenue
    "revenueGrowth": "revenue_growth",
    "totalRevenue": "total_revenue",
    "revenuePerShare": "revenue_per_share",
    # Balance Sheet
    "debtToEquity": "debt_to_equity",
    "currentRatio": "current_ratio",
    "quickRatio": "quick_ratio",
    "totalDebt": "total_debt",
    "totalCash": "total_cash",
    "bookValue": "book_value",
    # Cash Flow
    "freeCashflow": "free_cashflow",
    "operatingCashflow": "operating_cashflow",
    # Dividends
    "dividendYield": "dividend_yield",
    "dividendRate": "dividend_rate",
    "payoutRatio": "payout_ratio",
    "trailingAnnualDividendYield": "dividend_yield_ttm",
    # Market Context
    "marketCap": "market_cap",
    "beta": "beta",
    "52WeekHigh": "week52_high",
    "52WeekLow": "week52_low",
    "sharesOutstanding": "shares_outstanding",
    "floatShares": "float_shares",
    "heldPercentInsiders": "insider_holding",
    "heldPercentInstitutions": "institutional_holding",
}


def _safe_float(val: Any, multiplier: float = 1.0) -> Optional[float]:
    """Safely converts a value to float, returning None if not possible."""
    if val is None:
        return None
    try:
        result = float(val) * multiplier
        if result != result:  # NaN check
            return None
        return round(result, 4)
    except (TypeError, ValueError):
        return None


def fetch_fundamentals_single(ticker: str, retry: int = 2) -> Dict:
    """
    Fetches fundamental data for a single ticker via yfinance.
    Returns a dict with normalized field names and values.
    """
    for attempt in range(retry + 1):
        try:
            yf_ticker = yf.Ticker(ticker)
            info = yf_ticker.info or {}

            fundamental = {
                "ticker": ticker,
                "fetched_at": datetime.now().isoformat(),
                "company_name": info.get("longName") or info.get("shortName", ticker),
                "sector": info.get("sector", "Unknown"),
                "industry": info.get("industry", "Unknown"),
                "exchange": info.get("exchange", "NSE"),
                "currency": info.get("currency", "INR"),
                "website": info.get("website", ""),
                "description": (info.get("longBusinessSummary", "") or "")[:500],
            }

            # Map all fundamental fields
            for yf_key, our_key in FUNDAMENTAL_FIELDS.items():
                raw_val = info.get(yf_key)
                # Convert percentages from decimal to %
                if our_key in ("roe", "roa", "gross_margin", "operating_margin",
                                "net_margin", "revenue_growth", "earnings_growth",
                                "dividend_yield", "dividend_yield_ttm", "payout_ratio",
                                "insider_holding", "institutional_holding"):
                    fundamental[our_key] = _safe_float(raw_val, multiplier=100.0)  # → percent
                elif our_key in ("total_revenue", "total_debt", "total_cash",
                                  "free_cashflow", "operating_cashflow", "market_cap", "shares_outstanding", "float_shares"):
                    # Convert to Crores INR
                    v = _safe_float(raw_val)
                    fundamental[our_key] = round(v / 1e7, 2) if v is not None else None  # → Crores
                else:
                    fundamental[our_key] = _safe_float(raw_val)

            # Derived: PEG ratio (P/E / earnings growth), if both available
            if fundamental.get("pe_ratio") and fundamental.get("earnings_growth"):
                eg = fundamental["earnings_growth"] / 100.0 if fundamental["earnings_growth"] else None
                fundamental["peg_ratio"] = _safe_float(
                    fundamental["pe_ratio"] / eg if eg and eg > 0 else None
                )
            else:
                fundamental["peg_ratio"] = None

            # Derived: ROCE estimate = (Operating Margin × Revenue) / Total Capital
            fundamental["roce"] = fundamental.get("roe")  # Use ROE as proxy if ROCE unavailable

            # Quality score (composite) — higher = better fundamental health
            quality_factors = []
            if fundamental.get("roe") is not None:
                quality_factors.append(min(fundamental["roe"] / 20.0, 1.0))
            if fundamental.get("net_margin") is not None:
                quality_factors.append(min(fundamental["net_margin"] / 15.0, 1.0))
            if fundamental.get("revenue_growth") is not None:
                quality_factors.append(min((fundamental["revenue_growth"] + 10) / 30.0, 1.0))
            if fundamental.get("debt_to_equity") is not None:
                quality_factors.append(max(0, 1.0 - fundamental["debt_to_equity"] / 300.0))

            fundamental["quality_score"] = round(
                sum(quality_factors) / len(quality_factors) * 100, 1
            ) if quality_factors else None

            return fundamental

        except Exception as e:
            logger.warning(f"[Fundamentals] Attempt {attempt+1} failed for {ticker}: {e}")
            if attempt < retry:
                time.sleep(1.0 + attempt * 0.5)

    return {
        "ticker": ticker,
        "fetched_at": datetime.now().isoformat(),
        "error": "Failed to fetch",
    }


def fetch_all_fundamentals(
    tickers: Optional[List[str]] = None,
    force_refresh: bool = False,
    max_age_days: int = 7,
    delay_between_tickers: float = 0.3,
) -> Dict[str, Dict]:
    """
    Fetches fundamental data for all tickers.
    Uses cached files if fresh enough (default: 7 days).
    Saves per-ticker JSON files and an aggregated summary.

    Args:
        tickers: List of NSE tickers (e.g. ['RELIANCE.NS', 'TCS.NS']).
                 Defaults to config.STOCK_UNIVERSE.
        force_refresh: Skip cache check and re-fetch everything.
        max_age_days: Maximum age of cached data before re-fetching.
        delay_between_tickers: Sleep between requests to avoid rate limits.

    Returns:
        Dict mapping ticker → fundamental dict.
    """
    if tickers is None:
        tickers = config.STOCK_UNIVERSE

    summary: Dict[str, Dict] = {}

    # Load existing summary if it exists
    if config.FUNDAMENTALS_SUMMARY_FILE.exists() and not force_refresh:
        try:
            with open(config.FUNDAMENTALS_SUMMARY_FILE, "r", encoding="utf-8") as f:
                summary = json.load(f)
        except Exception:
            summary = {}

    stale_cutoff = datetime.now() - timedelta(days=max_age_days)
    tickers_to_refresh = []

    for ticker in tickers:
        cached = summary.get(ticker, {})
        fetched_at_str = cached.get("fetched_at")
        is_stale = True
        if fetched_at_str:
            try:
                fetched_at = datetime.fromisoformat(fetched_at_str)
                is_stale = fetched_at < stale_cutoff
            except Exception:
                is_stale = True
        if is_stale or force_refresh:
            tickers_to_refresh.append(ticker)

    logger.info(
        f"[Fundamentals] {len(tickers_to_refresh)}/{len(tickers)} tickers need refresh."
    )

    for i, ticker in enumerate(tickers_to_refresh):
        logger.info(f"[Fundamentals] Fetching {ticker} ({i+1}/{len(tickers_to_refresh)})...")
        data = fetch_fundamentals_single(ticker)
        summary[ticker] = data

        # Save per-ticker file
        safe_name = ticker.replace(".", "_").replace("^", "") + ".json"
        ticker_file = config.FUNDAMENTALS_DIR / safe_name
        try:
            with open(ticker_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.warning(f"Could not save {ticker_file}: {e}")

        if delay_between_tickers > 0:
            time.sleep(delay_between_tickers)

    # Save updated summary
    try:
        with open(config.FUNDAMENTALS_SUMMARY_FILE, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        logger.info(f"[Fundamentals] Summary saved to {config.FUNDAMENTALS_SUMMARY_FILE}")
    except Exception as e:
        logger.error(f"Failed to save fundamentals summary: {e}")

    return summary


def get_fundamentals(ticker: str) -> Dict:
    """
    Gets fundamental data for a single ticker from cache.
    If not cached or stale, fetches fresh data.
    """
    safe_name = ticker.replace(".", "_").replace("^", "") + ".json"
    ticker_file = config.FUNDAMENTALS_DIR / safe_name

    if ticker_file.exists():
        try:
            with open(ticker_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Check freshness (7 days)
            fetched_at_str = data.get("fetched_at")
            if fetched_at_str:
                fetched_at = datetime.fromisoformat(fetched_at_str)
                if (datetime.now() - fetched_at).days < 7:
                    return data
        except Exception:
            pass

    # Fetch fresh
    logger.info(f"[Fundamentals] Cache miss for {ticker}, fetching fresh...")
    return fetch_fundamentals_single(ticker)


def load_fundamentals_summary() -> Dict[str, Dict]:
    """Loads the aggregated fundamentals summary from disk."""
    if config.FUNDAMENTALS_SUMMARY_FILE.exists():
        try:
            with open(config.FUNDAMENTALS_SUMMARY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Could not load fundamentals summary: {e}")
    return {}


if __name__ == "__main__":
    logger.info("Running fundamentals fetch for default universe...")
    results = fetch_all_fundamentals()
    logger.info(f"Done. Fetched fundamentals for {len(results)} stocks.")
    # Show sample
    for ticker, data in list(results.items())[:3]:
        print(f"\n--- {ticker} ---")
        for k in ("pe_ratio", "roe", "debt_to_equity", "revenue_growth", "quality_score"):
            print(f"  {k}: {data.get(k)}")
