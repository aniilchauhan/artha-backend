"""
Two-Way Short Breakdown Engine.
Detects institutional distribution, 20-day support breakdown setups,
and produces executable MIS Short and ATM Put Option (PE) recommendations
to monetize bearish market regimes and red market days.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

# Path setup
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.options_engine import calculate_option_recommendation

logger = logging.getLogger(__name__)


def compute_breakdown_levels(
    df: pd.DataFrame,
    ticker: str,
    buffer_pct: float = 0.0025,
    target_pct: float = 0.020,
    atr_stop_multiplier: float = 1.2,
) -> Optional[Dict]:
    """
    Computes precise Short Breakdown execution levels from historical OHLCV:
      - Support Price: 20-day rolling lowest price
      - Short Entry Trigger: Support Price * (1 - buffer_pct)
      - Downside Target: Entry Price * (1 - target_pct)
      - Protective Stop Loss: Entry Price + (atr_stop_multiplier * ATR)
    """
    if df is None or len(df) < 25:
        return None

    df = df.copy()
    close = float(df["Close"].iloc[-1])
    volume = float(df["Volume"].iloc[-1])

    # 20-day low support
    support_20d = float(df["Low"].iloc[-21:-1].min())
    avg_vol_20d = float(df["Volume"].iloc[-21:-1].mean())
    vol_ratio = round(volume / max(1.0, avg_vol_20d), 2)

    # ATR(14)
    tr = np.maximum(
        df["High"] - df["Low"],
        np.maximum(
            (df["High"] - df["Close"].shift(1)).abs(),
            (df["Low"] - df["Close"].shift(1)).abs(),
        ),
    )
    atr = float(tr.rolling(14).mean().iloc[-1])
    if np.isnan(atr) or atr <= 0:
        atr = close * 0.015

    # RSI(14)
    delta = df["Close"].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi_series = 100 - (100 / (1 + rs))
    rsi = float(rsi_series.iloc[-1]) if not np.isnan(rsi_series.iloc[-1]) else 50.0

    # Chaikin Money Flow (CMF 20)
    mfv = (((df["Close"] - df["Low"]) - (df["High"] - df["Close"])) / (df["High"] - df["Low"]).replace(0, np.nan)) * df["Volume"]
    cmf_series = mfv.rolling(20).sum() / df["Volume"].rolling(20).sum().replace(0, np.nan)
    cmf = float(cmf_series.iloc[-1]) if not np.isnan(cmf_series.iloc[-1]) else 0.0

    # Short entry trigger (broken support)
    entry_trigger = round(support_20d * (1.0 - buffer_pct), 2)
    downside_target = round(entry_trigger * (1.0 - target_pct), 2)
    stop_loss = round(entry_trigger + (atr_stop_multiplier * atr), 2)

    risk_per_share = round(stop_loss - entry_trigger, 2)
    reward_per_share = round(entry_trigger - downside_target, 2)
    rr_ratio = round(reward_per_share / max(0.01, risk_per_share), 2)

    # Quality breakdown criteria
    dist_from_support_pct = (close - support_20d) / support_20d

    # Score breakdown conviction (0.0 to 1.0)
    conviction = 0.50
    if dist_from_support_pct <= 0.01:
        conviction += 0.15
    if cmf < -0.05:
        conviction += 0.15
    if vol_ratio > 1.1:
        conviction += 0.10
    if rsi < 45:
        conviction += 0.10

    conviction = min(0.95, round(conviction, 2))

    # Calculate Put Option Recommendation
    options_rec = calculate_option_recommendation(
        ticker=ticker,
        underlying_price=close,
        direction="SHORT",
        target_stock_pct=target_pct,
        capital_budget=25000.0,
    )

    return {
        "ticker": ticker,
        "direction": "SHORT",
        "close": round(close, 2),
        "support_20d": round(support_20d, 2),
        "entry_price": entry_trigger,
        "target_price": downside_target,
        "stop_loss_price": stop_loss,
        "risk_rupees": risk_per_share,
        "reward_rupees": reward_per_share,
        "reward_risk_ratio": rr_ratio,
        "rsi_14": round(rsi, 1),
        "cmf_20": round(cmf, 3),
        "volume_ratio": vol_ratio,
        "conviction": conviction,
        "optionsRecommendation": options_rec,
    }


def scan_breakdowns(
    data_dir: Optional[Path] = None,
    min_conviction: float = 0.60,
    limit: int = 5,
) -> List[Dict]:
    """Scans liquid F&O stock CSVs for short/put breakdown setups."""
    data_path = data_dir or config.RAW_DIR
    if not data_path.exists():
        logger.warning(f"Data directory {data_path} does not exist.")
        return []

    breakdowns = []
    # Prioritize liquid F&O STOCK_UNIVERSE
    target_tickers = [s.replace(".NS", "_NS") for s in config.STOCK_UNIVERSE]
    csv_files = [data_path / f"{t}.csv" for t in target_tickers if (data_path / f"{t}.csv").exists()]
    if not csv_files:
        csv_files = list(data_path.glob("*.csv"))[:100]

    for csv_file in csv_files:
        raw_ticker = csv_file.stem
        clean_ticker = raw_ticker.replace("_NS", ".NS")
        if any(skip in clean_ticker for skip in ["^NSEI", "NIFTY50", "NSEI", "INDIAVIX", "^NSEBANK"]):
            continue
        try:
            df = pd.read_csv(csv_file)
            if df.empty or "Close" not in df.columns:
                continue
            setup = compute_breakdown_levels(df, clean_ticker)
            if setup and setup["conviction"] >= min_conviction:
                breakdowns.append(setup)
        except Exception as e:
            logger.debug(f"Error processing {clean_ticker} for breakdown: {e}")

    # Sort descending by conviction score
    breakdowns.sort(key=lambda x: (x["conviction"], x["reward_risk_ratio"]), reverse=True)
    return breakdowns[:limit]


def export_breakdowns(
    output_files: Optional[List[Path]] = None,
    limit: int = 5,
) -> List[Dict]:
    """Generates breakdown opportunities and writes to JSON files for API consumption."""
    results = scan_breakdowns(limit=limit)
    destinations = output_files or [
        config.OUTPUTS_DIR / "latest_breakdowns.json",
        Path(__file__).resolve().parent.parent.parent / "data" / "stock-ai" / "latest_breakdowns.json",
    ]
    for dest in destinations:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        logger.info(f"Exported {len(results)} breakdown setups to {dest}")
    return results


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    results = export_breakdowns()
    print(f"Exported {len(results)} high-conviction breakdown / Put opportunities:")
    print(json.dumps(results[:3], indent=2))
