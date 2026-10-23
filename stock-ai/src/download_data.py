"""
Batched Historical Data Collection Module for Indian NSE Stocks and Market Benchmarks.
Downloads 6 years of daily OHLCV data across the entire NSE equity directory (~2,500 stocks)
in robust, rate-limited bunches with multi-threaded YFinance querying, checkpoint tracking,
exponential backoff retry, and auto-resume capabilities.
"""

import sys
import os
import time
import json
import logging
import urllib.request
import io
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
import yfinance as yf

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

# Reconfigure stdout/stderr for UTF-8 on Windows consoles
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


def load_symbol_aliases() -> Dict[str, List[str]]:
    """Load explicit Yahoo aliases without guessing ticker identity."""
    if not config.SYMBOL_ALIASES_FILE.exists():
        return {}
    try:
        raw = json.loads(config.SYMBOL_ALIASES_FILE.read_text(encoding="utf-8"))
        return {
            str(source): [str(alias) for alias in aliases if alias]
            for source, aliases in raw.items()
            if isinstance(aliases, list)
        }
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Could not load symbol aliases: %s", exc)
        return {}


def write_unavailable_manifest(results: List[Dict]) -> None:
    """Persist failed symbols so alternate providers can target only the gaps."""
    unavailable = [
        {
            "ticker": row["Ticker"],
            "status": "unavailable",
            "reason": "no_verified_yahoo_ohlcv",
            "rows": row.get("Rows", 0),
            "checked_at": datetime.utcnow().isoformat() + "Z",
        }
        for row in results
        if row.get("Status") == "FAILED"
    ]
    config.UNAVAILABLE_SYMBOLS_FILE.write_text(
        json.dumps({"generated_at": datetime.utcnow().isoformat() + "Z", "symbols": unavailable}, indent=2),
        encoding="utf-8",
    )


def fetch_nse_master_directory(force_refresh: bool = False) -> List[str]:
    """
    Downloads official NSE equity master list (EQUITY_L.csv) from NSE Archives.
    Returns list of formatted symbols with '.NS' suffix (e.g. 'RELIANCE.NS').
    """
    master_file = config.NSE_MASTER_FILE
    url = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

    needs_download = force_refresh or not master_file.exists()
    if not needs_download and master_file.exists():
        # Refresh if older than 7 days
        age_days = (time.time() - master_file.stat().st_mtime) / 86400
        if age_days > 7:
            needs_download = True

    if needs_download:
        logger.info("Fetching official NSE master equity directory from NSE archives...")
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_bytes = resp.read()
                master_file.parent.mkdir(parents=True, exist_ok=True)
                with open(master_file, "wb") as f:
                    f.write(raw_bytes)
                logger.info(f"Saved fresh NSE master directory to {master_file}")
        except Exception as e:
            logger.warning(f"Failed to fetch live NSE directory: {e}. Falling back to existing file or config.")

    if master_file.exists():
        try:
            df = pd.read_csv(master_file)
            df.columns = [c.strip() for c in df.columns]
            # Standard equities in India are Series EQ or BE (Trade-to-Trade)
            if "SERIES" in df.columns:
                df = df[df["SERIES"].isin(["EQ", "BE"])]
            symbols = [f"{s.strip()}.NS" for s in df["SYMBOL"].dropna().unique()]
            symbols = sorted(list(set(symbols)))
            logger.info(f"Loaded {len(symbols)} active NSE equities from master directory.")
            return symbols
        except Exception as e:
            logger.error(f"Error parsing NSE master file: {e}")

    return config.STOCK_UNIVERSE


def fetch_nifty500_directory(force_refresh: bool = False) -> List[str]:
    """Downloads official Nifty 500 stock directory from NSE Archives."""
    master_file = config.NIFTY500_MASTER_FILE
    url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"

    needs_download = force_refresh or not master_file.exists()
    if needs_download:
        logger.info("Fetching official Nifty 500 directory from NSE archives...")
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_bytes = resp.read()
                master_file.parent.mkdir(parents=True, exist_ok=True)
                with open(master_file, "wb") as f:
                    f.write(raw_bytes)
        except Exception as e:
            logger.warning(f"Failed to fetch Nifty 500 directory: {e}")

    if master_file.exists():
        try:
            df = pd.read_csv(master_file)
            df.columns = [c.strip() for c in df.columns]
            symbols = [f"{s.strip()}.NS" for s in df["Symbol"].dropna().unique()]
            return sorted(list(set(symbols)))
        except Exception as e:
            logger.error(f"Error parsing Nifty 500 file: {e}")

    return config.STOCK_UNIVERSE


def fetch_nifty100_directory(force_refresh: bool = False) -> List[str]:
    """Downloads official Nifty 100 stock directory from NSE Archives."""
    master_file = getattr(config, "NIFTY100_MASTER_FILE", config.DATA_DIR / "nifty100_master.csv")
    url = "https://archives.nseindia.com/content/indices/ind_nifty100list.csv"

    needs_download = force_refresh or not master_file.exists()
    if needs_download:
        logger.info("Fetching official Nifty 100 directory from NSE archives...")
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_bytes = resp.read()
                master_file.parent.mkdir(parents=True, exist_ok=True)
                with open(master_file, "wb") as f:
                    f.write(raw_bytes)
        except Exception as e:
            logger.warning(f"Failed to fetch Nifty 100 directory: {e}")

    if master_file.exists():
        try:
            df = pd.read_csv(master_file)
            df.columns = [c.strip() for c in df.columns]
            symbols = [f"{s.strip()}.NS" for s in df["Symbol"].dropna().unique()]
            return sorted(list(set(symbols)))
        except Exception as e:
            logger.error(f"Error parsing Nifty 100 file: {e}")

    return config.STOCK_UNIVERSE[:100]


def get_universe_tickers(universe_name: str = "nifty500") -> List[str]:
    """Returns ticker list based on selected universe option."""
    univ = universe_name.lower().strip()
    if univ in ["nifty500", "500"]:
        return fetch_nifty500_directory()
    elif univ in ["nifty100", "100"]:
        return fetch_nifty100_directory()
    elif univ in ["core50", "50"]:
        return config.STOCK_UNIVERSE
    elif univ in ["all", "nse_all", "full"]:
        return fetch_nse_master_directory()
    else:
        logger.warning(f"Unknown universe '{universe_name}', defaulting to NIFTY 500.")
        return fetch_nifty500_directory()


def load_checkpoint(checkpoint_file: Path = config.DOWNLOAD_CHECKPOINT_FILE) -> Dict:
    """Loads the download checkpoint JSON file if it exists."""
    if checkpoint_file.exists():
        try:
            with open(checkpoint_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading checkpoint file: {e}")
    return {
        "start_date": config.START_DATE,
        "completed_tickers": [],
        "failed_tickers": [],
        "completed_bunches": [],
        "last_updated": None,
    }


def save_checkpoint(
    checkpoint: Dict, checkpoint_file: Path = config.DOWNLOAD_CHECKPOINT_FILE
) -> None:
    """Saves download progress to checkpoint JSON file."""
    try:
        checkpoint["last_updated"] = datetime.now().isoformat()
        checkpoint_file.parent.mkdir(parents=True, exist_ok=True)
        with open(checkpoint_file, "w", encoding="utf-8") as f:
            json.dump(checkpoint, f, indent=2)
    except Exception as e:
        logger.warning(f"Error saving checkpoint file: {e}")


def clean_stock_df(raw_df: pd.DataFrame) -> Optional[pd.DataFrame]:
    """Standardizes column names, datatypes, drops NaNs/zeros, and deduplicates."""
    if raw_df is None or raw_df.empty:
        return None

    df = raw_df.copy()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]

    if "Date" not in df.columns:
        df = df.reset_index()

    rename_map = {
        "Date": "Date",
        "Open": "Open",
        "High": "High",
        "Low": "Low",
        "Close": "Close",
        "Adj Close": "Adj Close",
        "Volume": "Volume",
    }
    df = df.rename(columns=rename_map)

    required_cols = ["Date", "Open", "High", "Low", "Close", "Volume"]
    if not all(col in df.columns for col in required_cols):
        return None

    df = df[required_cols].copy()
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)

    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df = df[df["Close"] > 0]
    df = df.drop_duplicates(subset=["Date"]).sort_values("Date").reset_index(drop=True)

    return df if len(df) > 0 else None


def download_single_bunch(
    bunch_idx: int,
    total_bunches: int,
    tickers: List[str],
    output_dir: Path,
    start_date: str = config.START_DATE,
    end_date: Optional[str] = None,
    max_retries: int = 3,
) -> Dict[str, Dict]:
    """
    Downloads a bunch of tickers in parallel using yfinance multi-ticker download.
    Falls back to individual downloads if batch misses any stock.
    """
    results: Dict[str, Dict] = {}
    output_dir.mkdir(parents=True, exist_ok=True)

    print("\n" + "-" * 75)
    print(f"BUNCH {bunch_idx}/{total_bunches} [{len(tickers)} Stocks]: {tickers[0]} ... {tickers[-1]}")
    print("-" * 75)

    downloaded_data = None
    for attempt in range(1, max_retries + 1):
        try:
            downloaded_data = yf.download(
                tickers,
                start=start_date,
                end=end_date,
                group_by="ticker",
                threads=True,
                progress=False,
                auto_adjust=False,
            )
            if downloaded_data is not None and not downloaded_data.empty:
                break
        except Exception as e:
            backoff_sec = 2.0 * attempt
            logger.warning(f"  [Bunch {bunch_idx}] Attempt {attempt} error: {e}. Backing off {backoff_sec}s...")
            time.sleep(backoff_sec)

    succ_cnt = 0
    fail_cnt = 0

    aliases = load_symbol_aliases()
    for ticker in tickers:
        safe_filename = ticker.replace("^", "").replace(".", "_") + ".csv"
        out_file = output_dir / safe_filename
        clean_df = None

        if downloaded_data is not None and not downloaded_data.empty:
            try:
                if len(tickers) == 1:
                    clean_df = clean_stock_df(downloaded_data)
                elif ticker in downloaded_data.columns.levels[0]:
                    sub_raw = downloaded_data[ticker].dropna(how="all").copy()
                    clean_df = clean_stock_df(sub_raw)
            except Exception:
                pass

        # Individual fetch fallback if batch download missed it.
        if clean_df is None or len(clean_df) < 50:
            candidates = [ticker, *aliases.get(ticker, [])]
            for candidate in candidates:
                try:
                    single_raw = yf.download(
                        candidate,
                        start=start_date,
                        end=end_date,
                        progress=False,
                        auto_adjust=False,
                        threads=False,
                    )
                    candidate_df = clean_stock_df(single_raw)
                    if candidate_df is not None and len(candidate_df) >= 50:
                        clean_df = candidate_df
                        break
                except Exception:
                    continue

        if clean_df is not None and len(clean_df) >= 50:
            clean_df.to_csv(out_file, index=False)
            first_d = clean_df["Date"].min().strftime("%Y-%m-%d")
            last_d = clean_df["Date"].max().strftime("%Y-%m-%d")
            row_cnt = len(clean_df)

            results[ticker] = {
                "Ticker": ticker,
                "Status": "SUCCESS",
                "Rows": row_cnt,
                "First Date": first_d,
                "Last Date": last_d,
            }
            succ_cnt += 1
        else:
            results[ticker] = {
                "Ticker": ticker,
                "Status": "FAILED",
                "Rows": 0,
                "First Date": "N/A",
                "Last Date": "N/A",
            }
            fail_cnt += 1

    print(f"  Bunch {bunch_idx} Results: {succ_cnt} Succeeded, {fail_cnt} Failed.")
    return results


def download_in_bunches(
    tickers: List[str],
    output_dir: Path,
    bunch_size: int = config.DEFAULT_BUNCH_SIZE,
    start_date: str = config.START_DATE,
    end_date: Optional[str] = None,
    cooldown_delay: float = 2.0,
    target_bunch: Optional[int] = None,
    resume: bool = False,
    force: bool = False,
) -> pd.DataFrame:
    """Coordinates downloading the universe in structured bunches with checkpointing."""
    checkpoint = load_checkpoint()
    completed_set = set(checkpoint.get("completed_tickers", []))
    failed_set = set(checkpoint.get("failed_tickers", []))

    bunches = [tickers[i : i + bunch_size] for i in range(0, len(tickers), bunch_size)]
    total_bunches = len(bunches)

    all_results: List[Dict] = []
    total_tickers_count = len(tickers)

    print("\n" + "=" * 75)
    print(f"BATCHED 6-YEAR DATA COLLECTION (START DATE: {start_date})")
    print(f"Total Tickers: {total_tickers_count} | Bunch Size: {bunch_size} | Total Bunches: {total_bunches}")
    print(f"Target Bunch Filter: {target_bunch if target_bunch else 'ALL'}")
    print(f"Resume Mode: {resume} | Cooldown Delay: {cooldown_delay}s")
    print("=" * 75)

    start_time = time.time()

    for b_idx, bunch_tickers in enumerate(bunches, start=1):
        if target_bunch is not None and b_idx != target_bunch:
            continue

        # If resume mode is active, check which tickers already have verified data
        if resume and not force:
            pending_tickers = []
            for t in bunch_tickers:
                safe_fn = t.replace("^", "").replace(".", "_") + ".csv"
                f_path = output_dir / safe_fn
                if f_path.exists() and t in completed_set:
                    try:
                        df_check = pd.read_csv(f_path)
                        if len(df_check) >= 200:
                            all_results.append({
                                "Ticker": t,
                                "Status": "CACHED",
                                "Rows": len(df_check),
                                "First Date": str(df_check["Date"].iloc[0])[:10],
                                "Last Date": str(df_check["Date"].iloc[-1])[:10],
                            })
                            continue
                    except Exception:
                        pass
                pending_tickers.append(t)

            if not pending_tickers:
                logger.info(f"Bunch {b_idx}/{total_bunches} already cached — skipping.")
                continue
            active_tickers = pending_tickers
        else:
            active_tickers = bunch_tickers

        bunch_res = download_single_bunch(
            bunch_idx=b_idx,
            total_bunches=total_bunches,
            tickers=active_tickers,
            output_dir=output_dir,
            start_date=start_date,
            end_date=end_date,
        )

        for t, r in bunch_res.items():
            all_results.append(r)
            if r["Status"] == "SUCCESS":
                completed_set.add(t)
                if t in failed_set:
                    failed_set.remove(t)
            else:
                failed_set.add(t)

        checkpoint["completed_tickers"] = sorted(list(completed_set))
        checkpoint["failed_tickers"] = sorted(list(failed_set))
        if b_idx not in checkpoint.get("completed_bunches", []):
            checkpoint.setdefault("completed_bunches", []).append(b_idx)
        save_checkpoint(checkpoint)

        elapsed = time.time() - start_time
        pct_done = (len(completed_set) / max(1, total_tickers_count)) * 100
        print(
            f"  [Progress] Completed: {len(completed_set)}/{total_tickers_count} ({pct_done:.1f}%) | Elapsed: {elapsed/60:.1f}m"
        )

        # Cooldown between bunches
        if b_idx < total_bunches and (target_bunch is None):
            time.sleep(cooldown_delay)

    summary_df = pd.DataFrame(all_results)
    write_unavailable_manifest(all_results)
    return summary_df


def download_all(
    universe: str = getattr(config, "DEFAULT_UNIVERSE", "nifty500"),
    bunch_size: int = config.DEFAULT_BUNCH_SIZE,
    target_bunch: Optional[int] = None,
    resume: bool = True,
    force: bool = False,
    cooldown: float = 2.0,
    start_date: str = config.START_DATE,
    include_benchmarks: bool = True,
) -> pd.DataFrame:
    """Orchestrates downloading benchmarks and specified stock universe in bunches."""
    frames = []

    # 1. Download Market Benchmarks
    if include_benchmarks and (target_bunch is None or target_bunch == 1):
        print("\n>>> DOWNLOADING MARKET BENCHMARKS (NIFTY 50, VIX, SECTOR INDICES)...")
        benchmark_tickers = list(config.MARKET_INDICES.values())
        bm_df = download_in_bunches(
            tickers=benchmark_tickers,
            output_dir=config.MARKET_DIR,
            bunch_size=len(benchmark_tickers),
            start_date=start_date,
            cooldown_delay=1.0,
            resume=resume,
            force=force,
        )
        frames.append(bm_df)

    # 2. Get Universe Tickers
    target_tickers = get_universe_tickers(universe)
    print(f"\n>>> Selected Universe: '{universe.upper()}' ({len(target_tickers)} total stocks)")

    # 3. Download Universe in Bunches
    stock_df = download_in_bunches(
        tickers=target_tickers,
        output_dir=config.RAW_DIR,
        bunch_size=bunch_size,
        start_date=start_date,
        cooldown_delay=cooldown,
        target_bunch=target_bunch,
        resume=resume,
        force=force,
    )
    frames.append(stock_df)

    total_summary = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    print("\n" + "=" * 75)
    print("HISTORICAL 6-YEAR DATA COLLECTION REPORT")
    print("=" * 75)
    if not total_summary.empty:
        success_cnt = (total_summary["Status"].isin(["SUCCESS", "CACHED"])).sum()
        failed_cnt = (total_summary["Status"] == "FAILED").sum()
        print(f"Total Tickers: {len(total_summary)} | Completed/Cached: {success_cnt} | Failed: {failed_cnt}")
        print("=" * 75)

    return total_summary


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Download 6 years of historical stock data across Indian NSE equities in bunches."
    )
    parser.add_argument(
        "--universe",
        type=str,
        default=getattr(config, "DEFAULT_UNIVERSE", "nifty500"),
        choices=["nifty500", "nifty100", "core50", "all"],
        help="Stock universe: 'nifty500' (501 stocks), 'nifty100' (100 stocks), 'core50' (50 stocks), or 'all' (~2,500 NSE equities)",
    )
    parser.add_argument(
        "--bunch-size",
        type=int,
        default=config.DEFAULT_BUNCH_SIZE,
        help="Number of stocks per bunch (default: 25)",
    )
    parser.add_argument(
        "--bunch",
        type=int,
        default=None,
        help="Specific bunch number to download (1-indexed)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Cooldown delay in seconds between bunches (default: 2.0)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        default=True,
        help="Resume download from checkpoint (skipping already verified stocks)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download of all stocks even if cached",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=config.START_DATE,
        help=f"Historical start date (default: {config.START_DATE})",
    )
    parser.add_argument(
        "--skip-benchmarks",
        action="store_true",
        help="Skip downloading market index benchmarks",
    )

    args = parser.parse_args()

    download_all(
        universe=args.universe,
        bunch_size=args.bunch_size,
        target_bunch=args.bunch,
        resume=args.resume and not args.force,
        force=args.force,
        cooldown=args.delay,
        start_date=args.start_date,
        include_benchmarks=not args.skip_benchmarks,
    )
