"""
Multi-Session Swing Feature Engineering Module.
Computes technical, structural, consolidation, participation, and market context
features specifically designed for 10% multi-session swing setups in NSE cash equities.
Strict point-in-time calculation with zero future leakage.
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config

logger = logging.getLogger(__name__)


def compute_swing_features_for_stock(
    df: pd.DataFrame,
    nifty_df: Optional[pd.DataFrame] = None,
    vix_df: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Extracts multi-session swing feature vectors from a single stock's OHLCV history.
    """
    df = df.copy()
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.sort_values("Date").reset_index(drop=True)

    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # 1. Moving Averages & Slopes (Trend)
    df["EMA_20"] = df["Close"].ewm(span=20, adjust=False).mean()
    df["EMA_50"] = df["Close"].ewm(span=50, adjust=False).mean()
    df["EMA_200"] = df["Close"].ewm(span=200, adjust=False).mean()

    df["Slope_EMA_20"] = (df["EMA_20"] - df["EMA_20"].shift(5)) / df["EMA_20"].shift(5)
    df["Slope_EMA_50"] = (df["EMA_50"] - df["EMA_50"].shift(10)) / df["EMA_50"].shift(10)
    df["Dist_EMA_20"] = (df["Close"] - df["EMA_20"]) / df["EMA_20"]
    df["Dist_EMA_50"] = (df["Close"] - df["EMA_50"]) / df["EMA_50"]
    df["Dist_EMA_200"] = (df["Close"] - df["EMA_200"]) / df["EMA_200"]
    df["MA_Alignment"] = ((df["EMA_20"] > df["EMA_50"]) & (df["EMA_50"] > df["EMA_200"])).astype(float)

    # 2. Consolidation & Resistance Distance
    df["High_20d"] = df["High"].rolling(window=20).max()
    df["Low_20d"] = df["Low"].rolling(window=20).min()
    df["Dist_To_Resistance_20d"] = (df["High_20d"] - df["Close"]) / df["Close"]
    df["Consolidation_Range_20d"] = (df["High_20d"] - df["Low_20d"]) / df["Close"]

    # Bollinger Bands (20d, 2 std) & Squeeze Ratio
    df["BB_Mid"] = df["Close"].rolling(window=20).mean()
    df["BB_Std"] = df["Close"].rolling(window=20).std()
    df["BB_Upper"] = df["BB_Mid"] + 2.0 * df["BB_Std"]
    df["BB_Lower"] = df["BB_Mid"] - 2.0 * df["BB_Std"]
    df["BB_Width"] = (df["BB_Upper"] - df["BB_Lower"]) / df["BB_Mid"]
    df["BB_Width_SMA_60"] = df["BB_Width"].rolling(window=60).mean()
    df["BB_Squeeze_Ratio"] = df["BB_Width"] / (df["BB_Width_SMA_60"] + 1e-8)

    # 3. Volatility (ATR & Historical Volatility)
    high_low = df["High"] - df["Low"]
    high_close = (df["High"] - df["Close"].shift(1)).abs()
    low_close = (df["Low"] - df["Close"].shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df["ATR_14"] = tr.rolling(window=14).mean()
    df["ATR_Pct"] = df["ATR_14"] / df["Close"]
    df["Hist_Vol_20d"] = df["Close"].pct_change().rolling(window=20).std() * np.sqrt(252)

    # 4. Participation & Volume Dynamics
    df["Vol_SMA_20"] = df["Volume"].rolling(window=20).mean()
    df["Vol_Surge_Ratio"] = df["Volume"] / (df["Vol_SMA_20"] + 1e-8)
    turnover = df["Close"] * df["Volume"]
    df["Turnover_SMA_20"] = turnover.rolling(window=20).mean()
    df["Turnover_Surge_Ratio"] = turnover / (df["Turnover_SMA_20"] + 1e-8)

    # On-Balance Volume (OBV) Slope
    obv_change = np.where(df["Close"] > df["Close"].shift(1), df["Volume"],
                 np.where(df["Close"] < df["Close"].shift(1), -df["Volume"], 0))
    df["OBV"] = pd.Series(obv_change, index=df.index).cumsum()
    df["OBV_Slope_20d"] = (df["OBV"] - df["OBV"].shift(20)) / (df["OBV"].shift(20).abs() + 1e-8)

    # Chaikin Money Flow (CMF 20) - Institutional Accumulation vs Distribution
    hl_spread = df["High"] - df["Low"]
    mf_multiplier = np.where(
        hl_spread > 0,
        ((df["Close"] - df["Low"]) - (df["High"] - df["Close"])) / (hl_spread + 1e-8),
        0.0,
    )
    mf_volume = mf_multiplier * df["Volume"]
    sum_mfv_20 = pd.Series(mf_volume, index=df.index).rolling(window=20).sum()
    sum_vol_20 = df["Volume"].rolling(window=20).sum()
    df["CMF_20"] = sum_mfv_20 / (sum_vol_20 + 1e-8)

    # Volume Price Trend (VPT) Slope - Institutional Flow Velocity
    vpt_change = df["Volume"] * (df["Close"].pct_change())
    df["VPT"] = pd.Series(vpt_change, index=df.index).fillna(0).cumsum()
    df["VPT_Slope_20d"] = (df["VPT"] - df["VPT"].shift(20)) / (df["VPT"].shift(20).abs() + 1e-8)

    # Volume Churn Ratio (High volume with narrow price progress)
    daily_range_pct = (df["High"] - df["Low"]) / (df["Close"] + 1e-8)
    vol_to_range = (df["Volume"] / (df["Vol_SMA_20"] + 1e-8)) / (daily_range_pct / (df["ATR_Pct"] + 1e-8) + 1e-8)
    df["Vol_Churn_Ratio_20d"] = vol_to_range.rolling(window=20).mean()

    # 5. Momentum Oscillators
    # RSI (14)
    delta = df["Close"].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / (loss + 1e-8)
    df["RSI_14"] = 100 - (100 / (1 + rs))

    # MACD (12, 26, 9)
    ema_12 = df["Close"].ewm(span=12, adjust=False).mean()
    ema_26 = df["Close"].ewm(span=26, adjust=False).mean()
    df["MACD_Line"] = ema_12 - ema_26
    df["MACD_Signal"] = df["MACD_Line"].ewm(span=9, adjust=False).mean()
    df["MACD_Hist"] = df["MACD_Line"] - df["MACD_Signal"]

    # 6. Relative Strength vs Benchmark (Nifty 50)
    if nifty_df is not None and not nifty_df.empty:
        nifty = nifty_df.copy()
        nifty["Date"] = pd.to_datetime(nifty["Date"])
        nifty = nifty.sort_values("Date").rename(columns={"Close": "Nifty_Close"})
        df = pd.merge(df, nifty[["Date", "Nifty_Close"]], on="Date", how="left")
        df["Nifty_Close"] = df["Nifty_Close"].ffill()
        df["Return_20d_Stock"] = df["Close"].pct_change(20)
        df["Return_20d_Nifty"] = df["Nifty_Close"].pct_change(20)
        df["Rel_Strength_20d"] = df["Return_20d_Stock"] - df["Return_20d_Nifty"]
    else:
        df["Rel_Strength_20d"] = 0.0

    # 7. Market Context (India VIX)
    if vix_df is not None and not vix_df.empty:
        vix = vix_df.copy()
        vix["Date"] = pd.to_datetime(vix["Date"])
        vix = vix.sort_values("Date").rename(columns={"Close": "VIX_Close"})
        df = pd.merge(df, vix[["Date", "VIX_Close"]], on="Date", how="left")
        df["VIX_Close"] = df["VIX_Close"].ffill()
        df["VIX_Trend_20d"] = df["VIX_Close"].pct_change(20)
    else:
        df["VIX_Close"] = 15.0
        df["VIX_Trend_20d"] = 0.0

    # 8. Corporate Earnings & Event Risk Proximity Flag
    # Indian quarterly reporting cycles cluster in Jan, Apr, Jul, Oct (days 12 to 31)
    month = df["Date"].dt.month
    day = df["Date"].dt.day
    is_earnings_season = month.isin([1, 4, 7, 10]) & (day >= 12)
    is_earnings_late = month.isin([2, 5, 8, 11]) & (day <= 15)
    df["Event_Risk_Window"] = (is_earnings_season | is_earnings_late).astype(float)

    feature_cols = [
        "Slope_EMA_20", "Slope_EMA_50", "Dist_EMA_20", "Dist_EMA_50", "Dist_EMA_200",
        "MA_Alignment", "Dist_To_Resistance_20d", "Consolidation_Range_20d",
        "BB_Width", "BB_Squeeze_Ratio", "ATR_Pct", "Hist_Vol_20d",
        "Vol_Surge_Ratio", "Turnover_Surge_Ratio", "OBV_Slope_20d",
        "CMF_20", "VPT_Slope_20d", "Vol_Churn_Ratio_20d",
        "RSI_14", "MACD_Hist", "Rel_Strength_20d", "VIX_Close", "VIX_Trend_20d",
        "Event_Risk_Window"
    ]

    keep_cols = ["Date", "Open", "High", "Low", "Close", "Volume"] + feature_cols
    return df[keep_cols]


SWING_FEATURE_COLUMNS = [
    "Slope_EMA_20", "Slope_EMA_50", "Dist_EMA_20", "Dist_EMA_50", "Dist_EMA_200",
    "MA_Alignment", "Dist_To_Resistance_20d", "Consolidation_Range_20d",
    "BB_Width", "BB_Squeeze_Ratio", "ATR_Pct", "Hist_Vol_20d",
    "Vol_Surge_Ratio", "Turnover_Surge_Ratio", "OBV_Slope_20d",
    "CMF_20", "VPT_Slope_20d", "Vol_Churn_Ratio_20d",
    "RSI_14", "MACD_Hist", "Rel_Strength_20d", "VIX_Close", "VIX_Trend_20d",
    "Event_Risk_Window"
]
