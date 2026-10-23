"""
Corporate Actions & Events Module for Indian NSE Stocks.
Downloads and caches upcoming corporate events including:
  - Quarterly Results Dates
  - Board Meeting Dates
  - Ex-Dividend Dates
  - Stock Splits & Bonus Issues
  - Rights Issues and Buybacks

Data sourced from:
  1. NSE Official Archives (CA.csv, ResultsCalendar.csv) — free, no auth required
  2. yfinance .calendar attribute — per-ticker earnings/ex-dividend dates

Refreshed daily. Events older than today are automatically pruned.
"""

import sys
import json
import logging
import time
import urllib.request
import io
from datetime import datetime, timedelta, date
from pathlib import Path
from typing import Dict, List, Optional, Any

import pandas as pd
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

NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Event type constants
EVENT_RESULTS = "results"
EVENT_BOARD = "board_meeting"
EVENT_DIVIDEND = "ex_dividend"
EVENT_SPLIT = "split"
EVENT_BONUS = "bonus"
EVENT_BUYBACK = "buyback"
EVENT_AGM = "agm"
EVENT_RIGHTS = "rights"

EVENT_ICONS = {
    EVENT_RESULTS: "📊",
    EVENT_BOARD: "📋",
    EVENT_DIVIDEND: "💰",
    EVENT_SPLIT: "✂️",
    EVENT_BONUS: "🎁",
    EVENT_BUYBACK: "🔄",
    EVENT_AGM: "🏛️",
    EVENT_RIGHTS: "📜",
}


def _download_nse_csv(url: str, timeout: int = 15) -> Optional[pd.DataFrame]:
    """Downloads a CSV from NSE archives and returns as DataFrame."""
    try:
        req = urllib.request.Request(url, headers=NSE_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw_bytes = resp.read()
        df = pd.read_csv(io.StringIO(raw_bytes.decode("utf-8", errors="replace")))
        df.columns = [c.strip() for c in df.columns]
        return df
    except Exception as e:
        logger.warning(f"[Events] Failed to download {url}: {e}")
        return None


def _parse_nse_date(date_str: Any) -> Optional[date]:
    """Parses various NSE date formats to a Python date object."""
    if not date_str or pd.isna(date_str):
        return None
    date_str = str(date_str).strip()
    for fmt in ("%d-%b-%Y", "%d/%b/%Y", "%Y-%m-%d", "%d-%m-%Y", "%b %d, %Y", "%d %b %Y"):
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None


def _days_from_today(event_date: Optional[date]) -> Optional[int]:
    """Returns number of calendar days from today. Negative = past event."""
    if event_date is None:
        return None
    return (event_date - date.today()).days


def fetch_nse_corporate_actions(force_refresh: bool = False) -> List[Dict]:
    """
    Downloads NSE corporate actions CSV and extracts upcoming events.
    Returns list of event dicts with: ticker, event_type, date, description.
    """
    cache_file = config.EVENTS_DIR / "nse_ca_raw.json"

    # Use cache if fresh (< 12 hours)
    if cache_file.exists() and not force_refresh:
        try:
            age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
            if age_hours < 12:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass

    events = []

    # Try NSE Corporate Actions endpoint
    nse_url = "https://archives.nseindia.com/content/equities/CA.csv"
    df = _download_nse_csv(nse_url)

    if df is not None and not df.empty:
        logger.info(f"[Events] Downloaded NSE CA.csv with {len(df)} rows.")
        # Typical columns: SYMBOL, SERIES, EXDATE, PURPOSE, RECORD DT, BC_STARTDT, BC_ENDDT
        for _, row in df.iterrows():
            symbol = str(row.get("SYMBOL", "")).strip()
            if not symbol:
                continue
            ticker = f"{symbol}.NS"

            purpose = str(row.get("PURPOSE", "")).strip().upper()
            exdate_str = row.get("EXDATE") or row.get("EX DATE") or row.get("EX-DATE")
            record_date_str = row.get("RECORD DT", "")

            exdate = _parse_nse_date(exdate_str)
            if exdate is None:
                continue

            days_away = _days_from_today(exdate)
            # Only include future events (up to 90 days away) and very recent past (last 2 days)
            if days_away is None or days_away < -2 or days_away > 90:
                continue

            # Classify event type from PURPOSE
            if any(k in purpose for k in ("DIVIDEND", "INTERIM DIVIDEND", "FINAL DIVIDEND")):
                event_type = EVENT_DIVIDEND
            elif any(k in purpose for k in ("BONUS", "BONUS ISSUE")):
                event_type = EVENT_BONUS
            elif any(k in purpose for k in ("SPLIT", "STOCK SPLIT", "SUB-DIVISION")):
                event_type = EVENT_SPLIT
            elif "RIGHTS" in purpose:
                event_type = EVENT_RIGHTS
            elif "BUYBACK" in purpose:
                event_type = EVENT_BUYBACK
            elif "AGM" in purpose or "ANNUAL GENERAL" in purpose:
                event_type = EVENT_AGM
            elif any(k in purpose for k in ("BOARD", "MEETING", "RESULTS", "QUARTERLY")):
                event_type = EVENT_BOARD
            else:
                event_type = EVENT_BOARD  # Default unknown to board meeting

            events.append({
                "ticker": ticker,
                "symbol": symbol,
                "event_type": event_type,
                "date": exdate.isoformat(),
                "days_away": days_away,
                "description": purpose.title()[:80],
                "icon": EVENT_ICONS.get(event_type, "📅"),
                "source": "nse_ca",
            })

    else:
        logger.warning("[Events] NSE CA.csv unavailable, using yfinance fallback.")

    # Save to cache
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
    except Exception as e:
        logger.warning(f"[Events] Could not write CA cache: {e}")

    return events


def fetch_results_calendar(force_refresh: bool = False) -> List[Dict]:
    """
    Downloads NSE quarterly results calendar and returns upcoming earnings dates.
    """
    cache_file = config.EVENTS_DIR / "results_calendar_raw.json"

    if cache_file.exists() and not force_refresh:
        try:
            age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
            if age_hours < 12:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass

    events = []
    results_url = "https://archives.nseindia.com/content/equities/ResultsCalendar.csv"
    df = _download_nse_csv(results_url)

    if df is not None and not df.empty:
        logger.info(f"[Events] Downloaded ResultsCalendar.csv with {len(df)} rows.")
        for _, row in df.iterrows():
            symbol = str(row.get("Symbol", "") or row.get("SYMBOL", "")).strip()
            if not symbol:
                continue
            ticker = f"{symbol}.NS"
            date_str = row.get("Date", "") or row.get("BOARD MTG DATE", "") or row.get("Meeting Date", "")
            event_date = _parse_nse_date(date_str)
            if event_date is None:
                continue
            days_away = _days_from_today(event_date)
            if days_away is None or days_away < -2 or days_away > 90:
                continue

            company = str(row.get("CompanyName", "") or row.get("Company Name", "") or symbol).strip()
            events.append({
                "ticker": ticker,
                "symbol": symbol,
                "company": company[:60],
                "event_type": EVENT_RESULTS,
                "date": event_date.isoformat(),
                "days_away": days_away,
                "description": "Quarterly Results",
                "icon": EVENT_ICONS[EVENT_RESULTS],
                "source": "nse_results_cal",
            })

    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(events, f, indent=2)
    except Exception as e:
        logger.warning(f"[Events] Could not write results calendar cache: {e}")

    return events


def fetch_yfinance_events(tickers: List[str], delay: float = 0.2) -> List[Dict]:
    """
    Fetches earnings + ex-dividend dates per ticker via yfinance .calendar.
    Used as a fallback / supplement to NSE data.
    """
    events = []
    for ticker in tickers:
        try:
            yf_ticker = yf.Ticker(ticker)
            cal = yf_ticker.calendar

            # yfinance returns calendar as dict or DataFrame
            if isinstance(cal, dict):
                earnings_date = cal.get("Earnings Date")
                exdiv_date = cal.get("Ex-Dividend Date")
            elif hasattr(cal, "loc"):
                try:
                    earnings_date = cal.loc["Earnings Date"].iloc[0] if "Earnings Date" in cal.index else None
                    exdiv_date = cal.loc["Ex-Dividend Date"].iloc[0] if "Ex-Dividend Date" in cal.index else None
                except Exception:
                    earnings_date = None
                    exdiv_date = None
            else:
                earnings_date = None
                exdiv_date = None

            for evt_date_raw, evt_type in [(earnings_date, EVENT_RESULTS), (exdiv_date, EVENT_DIVIDEND)]:
                if evt_date_raw is None:
                    continue
                try:
                    if hasattr(evt_date_raw, "date"):
                        evt_date = evt_date_raw.date()
                    else:
                        evt_date = _parse_nse_date(str(evt_date_raw))
                    if evt_date is None:
                        continue
                    days_away = _days_from_today(evt_date)
                    if days_away is None or days_away < -2 or days_away > 90:
                        continue
                    events.append({
                        "ticker": ticker,
                        "symbol": ticker.replace(".NS", ""),
                        "event_type": evt_type,
                        "date": evt_date.isoformat(),
                        "days_away": days_away,
                        "description": "Quarterly Results" if evt_type == EVENT_RESULTS else "Ex-Dividend",
                        "icon": EVENT_ICONS[evt_type],
                        "source": "yfinance",
                    })
                except Exception:
                    continue

            if delay > 0:
                time.sleep(delay)

        except Exception as e:
            logger.debug(f"[Events] yfinance error for {ticker}: {e}")

    return events


def build_events_index(
    tickers: Optional[List[str]] = None,
    force_refresh: bool = False,
) -> Dict[str, List[Dict]]:
    """
    Builds a complete events index keyed by ticker.
    Combines NSE official CA data + Results Calendar + yfinance fallback.

    Args:
        tickers: Universe tickers to include. Defaults to config.STOCK_UNIVERSE.
        force_refresh: Re-download all sources.

    Returns:
        Dict mapping ticker → list of upcoming events.
    """
    if tickers is None:
        tickers = config.STOCK_UNIVERSE

    ticker_set = set(tickers)
    all_events: List[Dict] = []

    # Source 1: NSE Corporate Actions
    logger.info("[Events] Fetching NSE corporate actions...")
    ca_events = fetch_nse_corporate_actions(force_refresh=force_refresh)
    all_events.extend([e for e in ca_events if e["ticker"] in ticker_set])

    # Source 2: NSE Results Calendar
    logger.info("[Events] Fetching NSE results calendar...")
    rc_events = fetch_results_calendar(force_refresh=force_refresh)
    all_events.extend([e for e in rc_events if e["ticker"] in ticker_set])

    # Source 3: yfinance fallback — only for tickers not already covered
    covered = set(e["ticker"] for e in all_events if e["event_type"] == EVENT_RESULTS)
    uncovered = [t for t in tickers if t not in covered]
    if uncovered:
        logger.info(f"[Events] Fetching yfinance events for {len(uncovered)} uncovered tickers...")
        yf_events = fetch_yfinance_events(uncovered[:100])  # Limit to avoid rate limiting
        all_events.extend(yf_events)

    # De-duplicate: same ticker + event_type + date
    seen = set()
    deduped = []
    for e in all_events:
        key = (e["ticker"], e["event_type"], e["date"])
        if key not in seen:
            seen.add(key)
            deduped.append(e)

    # Sort by date
    deduped.sort(key=lambda e: (e["date"], e["ticker"]))

    # Index by ticker
    index: Dict[str, List[Dict]] = {}
    for e in deduped:
        if e["ticker"] not in index:
            index[e["ticker"]] = []
        index[e["ticker"]].append(e)

    # Save to disk
    try:
        with open(config.EVENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2)
        logger.info(f"[Events] Events index saved: {sum(len(v) for v in index.values())} total events for {len(index)} tickers.")
    except Exception as e:
        logger.error(f"[Events] Failed to save events index: {e}")

    return index


def get_events_for_ticker(ticker: str) -> List[Dict]:
    """Returns list of upcoming events for a single ticker from the cached index."""
    if config.EVENTS_FILE.exists():
        try:
            with open(config.EVENTS_FILE, "r", encoding="utf-8") as f:
                index = json.load(f)
            events = index.get(ticker, [])
            # Refresh days_away relative to today
            today = date.today()
            for e in events:
                try:
                    e["days_away"] = (_parse_nse_date(e["date"]) - today).days
                except Exception:
                    pass
            return events
        except Exception as e:
            logger.warning(f"[Events] Could not load events index: {e}")
    return []


def get_upcoming_events(days_window: int = 14) -> List[Dict]:
    """
    Returns all upcoming events across all tickers within the next N days.
    Sorted by date ascending.
    """
    if not config.EVENTS_FILE.exists():
        return []
    try:
        with open(config.EVENTS_FILE, "r", encoding="utf-8") as f:
            index = json.load(f)
        today = date.today()
        all_events = []
        for ticker, events in index.items():
            for e in events:
                evt_date = _parse_nse_date(e.get("date"))
                if evt_date is None:
                    continue
                days_away = (evt_date - today).days
                if -1 <= days_away <= days_window:
                    e_copy = dict(e)
                    e_copy["days_away"] = days_away
                    all_events.append(e_copy)
        all_events.sort(key=lambda e: (e.get("date", ""), e.get("ticker", "")))
        return all_events
    except Exception as e:
        logger.warning(f"[Events] Error loading upcoming events: {e}")
        return []


if __name__ == "__main__":
    logger.info("Building corporate events index...")
    index = build_events_index()
    upcoming = get_upcoming_events(days_window=14)
    print(f"\nUpcoming events in next 14 days: {len(upcoming)}")
    for e in upcoming[:15]:
        print(f"  {e['icon']} {e['ticker']:<16} {e['event_type']:<15} {e['date']}  ({e['days_away']}d away)")
