"""
Feature Engineering Module for Indian NSE Stocks.
Generates price momentum, technical indicators, volatility, volume, candlestick,
and market-relative features using STRICTLY current-day (Date T) and historical information.
Prevents all look-ahead bias and constructs the +2% next-day high target.
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
import ta

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config


def compute_stock_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes single-stock technical and price features on OHLCV data.
    Strictly uses current row (T) and past rows (< T).
    """
    df = df.copy().sort_values("Date").reset_index(drop=True)

    close = df["Close"]
    open_p = df["Open"]
    high = df["High"]
    low = df["Low"]
    volume = df["Volume"]

    # -------------------------------------------------------------
    # 1. Price Returns / Momentum (1d, 2d, 3d, 5d, 10d, 20d)
    # -------------------------------------------------------------
    df["ret_1d"] = close.pct_change(1)
    df["ret_2d"] = close.pct_change(2)
    df["ret_3d"] = close.pct_change(3)
    df["ret_5d"] = close.pct_change(5)
    df["ret_10d"] = close.pct_change(10)
    df["ret_20d"] = close.pct_change(20)

    # -------------------------------------------------------------
    # 2. Moving Averages (SMA & EMA)
    # -------------------------------------------------------------
    df["sma_5"] = close.rolling(5).mean()
    df["sma_10"] = close.rolling(10).mean()
    df["sma_20"] = close.rolling(20).mean()
    df["sma_50"] = close.rolling(50).mean()

    df["ema_5"] = close.ewm(span=5, adjust=False).mean()
    df["ema_10"] = close.ewm(span=10, adjust=False).mean()
    df["ema_20"] = close.ewm(span=20, adjust=False).mean()
    df["ema_50"] = close.ewm(span=50, adjust=False).mean()

    # -------------------------------------------------------------
    # 3. Relative Price Features
    # -------------------------------------------------------------
    df["close_to_sma20"] = close / (df["sma_20"] + 1e-8) - 1.0
    df["close_to_sma50"] = close / (df["sma_50"] + 1e-8) - 1.0
    df["ema5_to_ema20"] = df["ema_5"] / (df["ema_20"] + 1e-8) - 1.0

    # Distance from 20-day high and 52-week (252-day) high
    rolling_20_high = high.rolling(20).max()
    rolling_252_high = high.rolling(252, min_periods=50).max()
    df["dist_from_20d_high"] = (close - rolling_20_high) / (rolling_20_high + 1e-8)
    df["dist_from_52w_high"] = (close - rolling_252_high) / (rolling_252_high + 1e-8)

    # -------------------------------------------------------------
    # 4. Momentum Indicators (RSI, MACD)
    # -------------------------------------------------------------
    rsi_indicator = ta.momentum.RSIIndicator(close=close, window=14)
    df["rsi_14"] = rsi_indicator.rsi()

    macd_indicator = ta.trend.MACD(close=close, window_fast=12, window_slow=26, window_sign=9)
    df["macd"] = macd_indicator.macd()
    df["macd_signal"] = macd_indicator.macd_signal()
    df["macd_diff"] = macd_indicator.macd_diff()  # Histogram

    # Normalized MACD by close price so it is scale-invariant across stocks
    df["macd_norm"] = df["macd"] / (close + 1e-8)
    df["macd_diff_norm"] = df["macd_diff"] / (close + 1e-8)

    # -------------------------------------------------------------
    # 5. Volatility Indicators (ATR, Rolling Vol, Bollinger Bands)
    # -------------------------------------------------------------
    atr_indicator = ta.volatility.AverageTrueRange(high=high, low=low, close=close, window=14)
    df["atr_14"] = atr_indicator.average_true_range()
    df["atr_pct"] = df["atr_14"] / (close + 1e-8)

    # Daily high-low range percentage
    df["daily_hl_pct"] = (high - low) / (close + 1e-8)

    # Rolling realized volatility (annualized)
    df["vol_5d"] = df["ret_1d"].rolling(5).std() * np.sqrt(252)
    df["vol_10d"] = df["ret_1d"].rolling(10).std() * np.sqrt(252)
    df["vol_20d"] = df["ret_1d"].rolling(20).std() * np.sqrt(252)

    # Bollinger Bands
    bb_indicator = ta.volatility.BollingerBands(close=close, window=20, window_dev=2)
    bb_high = bb_indicator.bollinger_hband()
    bb_low = bb_indicator.bollinger_lband()
    bb_mid = bb_indicator.bollinger_mavg()
    df["bb_position"] = (close - bb_low) / (bb_high - bb_low + 1e-8)  # %B
    df["bb_width"] = (bb_high - bb_low) / (bb_mid + 1e-8)

    # Volatility Contraction Pattern (VCP - Mark Minervini)
    atr_5 = ta.volatility.AverageTrueRange(high=high, low=low, close=close, window=5).average_true_range()
    atr_20 = ta.volatility.AverageTrueRange(high=high, low=low, close=close, window=20).average_true_range()
    df["vcp_contraction_ratio"] = atr_5 / (atr_20 + 1e-8)
    df["vcp_compression_flag"] = (df["vcp_contraction_ratio"] < 0.75).astype(float)

    # -------------------------------------------------------------
    # 6. Volume Dynamics
    # -------------------------------------------------------------
    vol_sma5 = volume.rolling(5).mean()
    vol_sma20 = volume.rolling(20).mean()
    df["vol_pct_change"] = volume.pct_change(1)
    df["vol_to_sma5"] = volume / (vol_sma5 + 1e-8)
    df["vol_to_sma20"] = volume / (vol_sma20 + 1e-8)
    df["vol_trend_5_20"] = vol_sma5 / (vol_sma20 + 1e-8) - 1.0

    # -------------------------------------------------------------
    # 6b. Book Masters Quantitative Predictive Signals
    # -------------------------------------------------------------
    # 1. Stan Weinstein 30-Week (150-Day) Moving Average & 4-Stage Signals
    df["sma_150"] = close.rolling(150, min_periods=30).mean()
    df["sma_200"] = close.rolling(200, min_periods=40).mean()
    df["close_to_sma150"] = close / (df["sma_150"] + 1e-8) - 1.0
    df["close_to_sma200"] = close / (df["sma_200"] + 1e-8) - 1.0
    sma150_slope = (df["sma_150"] - df["sma_150"].shift(20)) / (df["sma_150"].shift(20) + 1e-8)
    df["weinstein_stage2_advance"] = ((close > df["sma_150"]) & (sma150_slope > 0.005)).astype(float)
    df["weinstein_stage4_decline"] = ((close < df["sma_150"]) & (sma150_slope < -0.005)).astype(float)

    # 2. William O'Neil CAN SLIM Pivot & Volume Surge Signals
    vol_sma50 = volume.rolling(50, min_periods=10).mean()
    df["canslim_volume_expansion"] = volume / (vol_sma50 + 1e-8)
    rolling_252_low = low.rolling(252, min_periods=50).min()
    df["dist_from_52w_low"] = (close - rolling_252_low) / (rolling_252_low + 1e-8)
    df["canslim_breakout_setup"] = ((df["dist_from_52w_high"] >= -0.15) & (df["canslim_volume_expansion"] >= 1.5)).astype(float)

    # 3. Mark Minervini SEPA Trend Template Indicator
    df["minervini_trend_template"] = (
        (close > df["sma_50"]) &
        (df["sma_50"] > df["sma_150"]) &
        (df["sma_150"] > df["sma_200"]) &
        (df["dist_from_52w_low"] >= 0.30) &
        (df["dist_from_52w_high"] >= -0.25)
    ).astype(float)

    # -------------------------------------------------------------
    # 7. Candlestick Features
    # -------------------------------------------------------------
    candle_range = high - low + 1e-8
    df["candle_body_pct"] = (close - open_p).abs() / candle_range
    df["upper_wick_pct"] = (high - np.maximum(open_p, close)) / candle_range
    df["lower_wick_pct"] = (np.minimum(open_p, close) - low) / candle_range
    df["gap_pct"] = (open_p - close.shift(1)) / (close.shift(1) + 1e-8)
    df["close_location"] = (close - low) / candle_range

    # -------------------------------------------------------------
    # 8. Ichimoku Cloud
    # -------------------------------------------------------------
    tenkan_high = high.rolling(9).max()
    tenkan_low = low.rolling(9).min()
    df["ichi_tenkan"] = (tenkan_high + tenkan_low) / 2

    kijun_high = high.rolling(26).max()
    kijun_low = low.rolling(26).min()
    df["ichi_kijun"] = (kijun_high + kijun_low) / 2

    df["ichi_span_a"] = (df["ichi_tenkan"] + df["ichi_kijun"]) / 2

    span_b_high = high.rolling(52).max()
    span_b_low = low.rolling(52).min()
    df["ichi_span_b"] = (span_b_high + span_b_low) / 2

    cloud_top = df[["ichi_span_a", "ichi_span_b"]].max(axis=1)
    cloud_bottom = df[["ichi_span_a", "ichi_span_b"]].min(axis=1)
    df["ichi_cloud_position"] = np.where(close > cloud_top, 1.0,
                                 np.where(close < cloud_bottom, -1.0, 0.0))
    df["ichi_cloud_dist"] = (close - cloud_top) / (close + 1e-8)

    # -------------------------------------------------------------
    # 9. OBV (On Balance Volume) + Slope
    # -------------------------------------------------------------
    obv_series = []
    obv_val = 0.0
    for i in range(len(df)):
        if i == 0:
            obv_series.append(0.0)
            continue
        if close.iloc[i] > close.iloc[i - 1]:
            obv_val += volume.iloc[i]
        elif close.iloc[i] < close.iloc[i - 1]:
            obv_val -= volume.iloc[i]
        obv_series.append(obv_val)
    df["obv"] = obv_series
    df["obv_norm"] = df["obv"] / (volume.rolling(20).mean() * 20 + 1e-8)
    df["obv_slope_5d"] = df["obv"].diff(5) / (volume.rolling(20).mean() * 5 + 1e-8)

    # -------------------------------------------------------------
    # 10. ADX (Average Directional Index) — Trend Strength
    # -------------------------------------------------------------
    adx_indicator = ta.trend.ADXIndicator(high=high, low=low, close=close, window=14)
    df["adx_14"] = adx_indicator.adx()
    df["adx_pos_di"] = adx_indicator.adx_pos()
    df["adx_neg_di"] = adx_indicator.adx_neg()
    df["adx_di_spread"] = df["adx_pos_di"] - df["adx_neg_di"]

    # -------------------------------------------------------------
    # 11. Williams %R (Overbought / Oversold)
    # -------------------------------------------------------------
    willr_indicator = ta.momentum.WilliamsRIndicator(high=high, low=low, close=close, lbp=14)
    df["willr_14"] = willr_indicator.williams_r()

    # -------------------------------------------------------------
    # 12. MFI (Money Flow Index) — Volume-Weighted RSI
    # -------------------------------------------------------------
    mfi_indicator = ta.volume.MFIIndicator(high=high, low=low, close=close, volume=volume, window=14)
    df["mfi_14"] = mfi_indicator.money_flow_index()

    # -------------------------------------------------------------
    # 13. Pivot Points (Standard — from previous session OHLC)
    # -------------------------------------------------------------
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    prev_close = close.shift(1)
    pivot = (prev_high + prev_low + prev_close) / 3
    df["pivot"] = pivot
    df["pivot_r1"] = 2 * pivot - prev_low
    df["pivot_s1"] = 2 * pivot - prev_high
    df["pivot_r2"] = pivot + (prev_high - prev_low)
    df["pivot_s2"] = pivot - (prev_high - prev_low)
    df["close_to_pivot"] = (close - pivot) / (close + 1e-8)
    df["close_to_r1"] = (close - df["pivot_r1"]) / (close + 1e-8)
    df["close_to_s1"] = (close - df["pivot_s1"]) / (close + 1e-8)

    # -------------------------------------------------------------
    # 14. Rate of Change (ROC) — Momentum
    # -------------------------------------------------------------
    df["roc_5"] = close.pct_change(5) * 100
    df["roc_10"] = close.pct_change(10) * 100

    # -------------------------------------------------------------
    # 15. Chaikin Money Flow (CMF) & Institutional Accumulation
    # -------------------------------------------------------------
    mf_multiplier = ((close - low) - (high - close)) / candle_range
    mf_volume = mf_multiplier * volume
    df["cmf_20"] = mf_volume.rolling(20, min_periods=5).sum() / (volume.rolling(20, min_periods=5).sum() + 1e-8)
    df["adl_norm"] = mf_volume.cumsum() / (volume.rolling(50, min_periods=10).mean() * 50 + 1e-8)
    df["adl_slope_10d"] = df["adl_norm"].diff(10)

    return df



def load_market_benchmarks() -> Dict[str, pd.DataFrame]:
    """
    Loads and prepares benchmark indices (NIFTY 50, INDIA VIX, Sector indices).
    Computes benchmark return and trend features.
    """
    benchmarks = {}

    for name, symbol in config.MARKET_INDICES.items():
        safe_sym = symbol.replace("^", "").replace(".", "_") + ".csv"
        file_path = config.MARKET_DIR / safe_sym

        if not file_path.exists():
            continue

        m_df = pd.read_csv(file_path)
        m_df["Date"] = pd.to_datetime(m_df["Date"])
        m_df = m_df.sort_values("Date").reset_index(drop=True)

        prefix = "nifty" if "NIFTY_50" in name else name.lower()

        if "VIX" in name:
            m_df[f"{prefix}_level"] = m_df["Close"]
            m_df[f"{prefix}_change_1d"] = m_df["Close"].pct_change(1)
            m_df[f"{prefix}_change_5d"] = m_df["Close"].pct_change(5)
            cols = ["Date", f"{prefix}_level", f"{prefix}_change_1d", f"{prefix}_change_5d"]
        else:
            m_df[f"{prefix}_close"] = m_df["Close"]
            m_df[f"{prefix}_ret_1d"] = m_df["Close"].pct_change(1)
            m_df[f"{prefix}_ret_5d"] = m_df["Close"].pct_change(5)
            m_df[f"{prefix}_ret_20d"] = m_df["Close"].pct_change(20)
            m_df[f"{prefix}_sma50"] = m_df["Close"].rolling(50).mean()
            m_df[f"{prefix}_trend"] = m_df["Close"] / (m_df[f"{prefix}_sma50"] + 1e-8) - 1.0
            cols = [
                "Date",
                f"{prefix}_close",
                f"{prefix}_ret_1d",
                f"{prefix}_ret_5d",
                f"{prefix}_ret_20d",
                f"{prefix}_trend",
            ]

        benchmarks[symbol] = m_df[cols].copy()

    # Load FII/DII only for legacy research runs; clean candidates exclude it.
    fii_path = config.MARKET_DIR / "FIIDII.csv"
    if config.USE_SYNTHETIC_FEATURES and fii_path.exists():
        fii_df = pd.read_csv(fii_path)
        fii_df["Date"] = pd.to_datetime(fii_df["Date"])
        fii_df = fii_df.sort_values("Date").reset_index(drop=True)
        # Shift 1 day to ensure we strictly use previous day's FII flow if running right at market close.
        # Alternatively, assume we run at 7PM and use current day's. We will use current day's + 5d trend.
        fii_df["inst_net"] = fii_df["fii_net"] + fii_df["dii_net"]
        fii_df["fii_trend_5d"] = fii_df["fii_net"].rolling(5).mean()
        fii_cols = ["Date", "fii_net", "dii_net", "inst_net", "fii_trend_5d"]
        benchmarks["FIIDII"] = fii_df[fii_cols].copy()

    # Load Sentiment Data
    if config.USE_SYNTHETIC_FEATURES and config.HISTORICAL_SENTIMENT_FILE.exists():
        try:
            sent_df = pd.read_parquet(config.HISTORICAL_SENTIMENT_FILE)
        except Exception:
            sent_df = pd.read_csv(config.HISTORICAL_SENTIMENT_FILE.with_suffix(".csv"))
        sent_df["Date"] = pd.to_datetime(sent_df["Date"])
        benchmarks["SENTIMENT"] = sent_df

    return benchmarks


def merge_market_features(
    stock_df: pd.DataFrame, ticker: str, benchmarks: Dict[str, pd.DataFrame]
) -> pd.DataFrame:
    """
    Merges market benchmark and sector features onto stock DataFrame strictly by trading Date.
    Missing dates forward-filled safely up to 2 trading days.
    """
    df = stock_df.copy()
    df["Date"] = pd.to_datetime(df["Date"])

    # 1. Merge NIFTY 50
    nifty_sym = config.DEFAULT_INDEX
    if nifty_sym in benchmarks:
        nifty_df = benchmarks[nifty_sym]
        df = pd.merge(df, nifty_df, on="Date", how="left")
        if "ret_1d" in df.columns and "nifty_ret_1d" in df.columns:
            df["stock_vs_nifty_1d"] = df["ret_1d"] - df["nifty_ret_1d"]
            df["stock_vs_nifty_5d"] = df["ret_5d"] - df["nifty_ret_5d"]

    # 2. Merge India VIX
    vix_sym = config.MARKET_INDICES.get("INDIA_VIX", "^INDIAVIX")
    if vix_sym in benchmarks:
        vix_df = benchmarks[vix_sym]
        df = pd.merge(df, vix_df, on="Date", how="left")

    # 3. Merge Sector Benchmarks (Bank, IT, Auto)
    for sec_key, sec_sym in config.MARKET_INDICES.items():
        if sec_sym not in [nifty_sym, vix_sym] and sec_sym in benchmarks:
            sec_df = benchmarks[sec_sym]
            df = pd.merge(df, sec_df, on="Date", how="left")

    # 4. Merge FII/DII Data
    if config.USE_SYNTHETIC_FEATURES and "FIIDII" in benchmarks:
        fii_df = benchmarks["FIIDII"]
        df = pd.merge(df, fii_df, on="Date", how="left")

    # 5. Merge optional sentiment features
    if config.USE_SYNTHETIC_FEATURES and "SENTIMENT" in benchmarks:
        sent_df = benchmarks["SENTIMENT"]
        stock_sent = sent_df[sent_df["ticker"] == ticker][
            ["Date", "sentiment_score", "sentiment_buzz", "sentiment_ma3"]
        ]
        if not stock_sent.empty:
            df = pd.merge(df, stock_sent, on="Date", how="left")
        else:
            df["sentiment_score"] = 0.0
            df["sentiment_buzz"] = 0.2
            df["sentiment_ma3"] = 0.0
    elif config.USE_SYNTHETIC_FEATURES:
        df["sentiment_score"] = 0.0
        df["sentiment_buzz"] = 0.2
        df["sentiment_ma3"] = 0.0

    if config.USE_SYNTHETIC_FEATURES:
        df["sentiment_score"] = df["sentiment_score"].fillna(0.0)
        df["sentiment_buzz"] = df["sentiment_buzz"].fillna(0.2)
        df["sentiment_ma3"] = df["sentiment_ma3"].fillna(0.0)

    # Relative return vs assigned sector (or fallback to Nifty)
    sector_sym = config.SECTOR_MAP.get(ticker, nifty_sym)
    if sector_sym in benchmarks and "ret_1d" in df.columns:
        sec_df = benchmarks[sector_sym]
        sec_ret_1d_col = [c for c in sec_df.columns if "ret_1d" in c]
        sec_ret_5d_col = [c for c in sec_df.columns if "ret_5d" in c]
        sec_ret_20d_col = [c for c in sec_df.columns if "ret_20d" in c]
        
        if sec_ret_1d_col and sec_ret_1d_col[0] in df.columns:
            df["stock_vs_sector_1d"] = df["ret_1d"] - df[sec_ret_1d_col[0]]
        else:
            df["stock_vs_sector_1d"] = df.get("stock_vs_nifty_1d", 0.0)

        if sec_ret_5d_col and sec_ret_5d_col[0] in df.columns and "ret_5d" in df.columns:
            df["stock_vs_sector_5d"] = df["ret_5d"] - df[sec_ret_5d_col[0]]
        else:
            df["stock_vs_sector_5d"] = df.get("stock_vs_nifty_5d", 0.0)

        if sec_ret_20d_col and sec_ret_20d_col[0] in df.columns and "ret_20d" in df.columns:
            df["stock_vs_sector_10d"] = df["ret_20d"] - df[sec_ret_20d_col[0]]
        else:
            df["stock_vs_sector_10d"] = df.get("ret_20d", 0.0) - df.get("nifty_ret_20d", 0.0)
    else:
        df["stock_vs_sector_1d"] = df.get("stock_vs_nifty_1d", 0.0)
        df["stock_vs_sector_5d"] = df.get("stock_vs_nifty_5d", 0.0)
        df["stock_vs_sector_10d"] = df.get("ret_20d", 0.0) - df.get("nifty_ret_20d", 0.0)

    # Mansfield Relative Strength (MRS) vs NIFTY 50
    if "nifty_close" in df.columns and "Close" in df.columns:
        rs_ratio = df["Close"] / (df["nifty_close"] + 1e-8)
        rs_sma20 = rs_ratio.rolling(20, min_periods=5).mean()
        df["mansfield_rs_20d"] = (rs_ratio / (rs_sma20 + 1e-8) - 1.0) * 100.0
        df["mansfield_rs_slope_10d"] = df["mansfield_rs_20d"].diff(10)

    # Forward fill market features safely for non-trading calendar misalignments (up to 2 days)
    market_cols = [
        c
        for c in df.columns
        if any(
            k in c
            for k in [
                "nifty",
                "vix",
                "sector",
                "stock_vs_",
                "fii_",
                "dii_",
                "inst_",
                "sentiment_",
            ]
        )
    ]
    df[market_cols] = df[market_cols].ffill(limit=2)

    return df


def add_target_definition(
    df: pd.DataFrame,
    target_pct: float = config.TARGET_PCT,
    target_mode: str = getattr(config, "TARGET_MODE", "executable_open"),
    stop_pct: float = getattr(config, "STOP_LOSS_PCT", 0.02),
) -> pd.DataFrame:
    """
    Constructs the Binary Classification Target.
    Under target_mode == 'executable_open' (docs/TARGET_SPECIFICATION.md):
      Target = 1 if next day's High >= Open * (1 + target_pct) AND next day's Low > Open * (1 - stop_pct)
      Target = 0 otherwise (including ambiguous candles where both target and stop are touched).
    Under target_mode == 'legacy_close':
      Target = 1 if next day's High >= today's Close * (1 + target_pct)
    """
    df = df.copy()

    next_day_open = df["Open"].shift(-1)
    next_day_high = df["High"].shift(-1)
    next_day_low = df["Low"].shift(-1)
    next_day_close = df["Close"].shift(-1)

    # Legacy close-to-high benchmark
    threshold_close = df["Close"] * (1.0 + target_pct)
    df["target_legacy"] = (next_day_high >= threshold_close).astype(float)

    if target_mode == "executable_open":
        threshold_open_target = next_day_open * (1.0 + target_pct)
        threshold_open_stop = next_day_open * (1.0 - stop_pct)

        clean_hit = (next_day_high >= threshold_open_target) & (next_day_low > threshold_open_stop)
        ambiguous = (next_day_high >= threshold_open_target) & (next_day_low <= threshold_open_stop)

        # Conservative stop_first rule: clean_hit is 1.0, ambiguous is 0.0
        df["target"] = clean_hit.astype(float)
        df["target_clean_hit"] = clean_hit.astype(float)
        df["target_ambiguous"] = ambiguous.astype(float)
    else:
        df["target"] = (next_day_high >= threshold_close).astype(float)

    # Next day OHLC for trading simulation backtest (NOT features)
    df["next_open"] = next_day_open
    df["next_high"] = next_day_high
    df["next_low"] = next_day_low
    df["next_close"] = next_day_close

    # Set last row target and next-day values to NaN (strictly unknown)
    last_idx = df.index[-1]
    df.loc[last_idx, ["target", "target_legacy", "next_open", "next_high", "next_low", "next_close"]] = np.nan
    if "target_clean_hit" in df.columns:
        df.loc[last_idx, ["target_clean_hit", "target_ambiguous"]] = np.nan

    return df


def add_intraday_target_definition(df: pd.DataFrame, target_pct: float = config.TARGET_PCT) -> pd.DataFrame:
    """
    Constructs the Intraday Opportunity Target:
      target_intraday = 1 if next day's High >= next day's Open * (1 + target_pct)
      target_intraday = 0 otherwise

    Distinguishes genuine intraday upside momentum from overnight gaps.
    """
    df = df.copy()
    next_day_high = df["High"].shift(-1)
    next_day_open = df["Open"].shift(-1)
    threshold_price = next_day_open * (1.0 + target_pct)

    df["target_intraday"] = (next_day_high >= threshold_price).astype(float)
    df.loc[df.index[-1], "target_intraday"] = np.nan
    return df


def extract_feature_column_names(df: pd.DataFrame) -> List[str]:
    """
    Returns the strict list of model features, excluding metadata, raw OHLCV,
    and future targets.
    """
    if not config.USE_SYNTHETIC_FEATURES:
        from src.clean_contract import assert_no_synthetic
        assert_no_synthetic(df.columns)
    excluded_columns = {
        "Date",
        "ticker",
        "Open",
        "High",
        "Low",
        "Close",
        "Adj Close",
        "Volume",
        "target",
        "target_legacy",
        "target_clean_hit",
        "target_ambiguous",
        "target_intraday",
        "next_open",
        "next_high",
        "next_low",
        "next_close",
    }
    feature_cols = [col for col in df.columns if col not in excluded_columns]
    return sorted(feature_cols)


def build_stock_pipeline(
    ticker: str,
    raw_df: pd.DataFrame,
    benchmarks: Dict[str, pd.DataFrame],
    is_training: bool = True,
) -> pd.DataFrame:
    """
    End-to-end feature pipeline for a single stock:
    1. Single stock technicals (using current/past data only)
    2. Merge benchmark/market data
    3. Add target & simulation columns (if training)
    4. Clean NaNs and inf values
    """
    df = compute_stock_features(raw_df)
    df = merge_market_features(df, ticker, benchmarks)
    df["ticker"] = ticker

    if is_training:
        df = add_target_definition(df, config.TARGET_PCT)

    # Clean infinite values
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan)

    return df
