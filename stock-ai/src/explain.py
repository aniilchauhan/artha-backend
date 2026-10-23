"""
Tree SHAP Explainability Engine for Indian NSE Stock AI System.
Computes exact feature attributions using LightGBM's native C++ Tree SHAP engine
(pred_contrib=True), providing fast, dependency-free interpretability for daily predictions.
"""

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config


# Friendly descriptions for top quantitative features
FEATURE_DESCRIPTIONS = {
    "atr_pct": "High Average True Range (% of price) indicating strong volatility expansion",
    "india_vix_level": "Elevated India VIX regime providing broader market swing room",
    "daily_hl_pct": "Wide intra-day high-low range showing active liquidity",
    "nifty_ret_1d": "Bullish 1-day benchmark momentum in NIFTY 50",
    "nifty_ret_5d": "5-day upward market trend",
    "nifty_ret_20d": "20-day sustained market momentum",
    "india_vix_change_1d": "Sharp daily spike/expansion in India VIX fear index",
    "nifty_trend": "Nifty trading comfortably above its 50-day moving average",
    "vol_20d": "Elevated 20-day historical realized volatility",
    "vol_to_sma20": "Significant volume surge relative to its 20-day average volume",
    "gap_pct": "Favorable overnight gap structure",
    "close_location": "Close located near the daily high of the candle",
    "rsi_14": "14-day RSI momentum profile",
    "bb_width": "Bollinger Band volatility expansion",
    "stock_vs_nifty_1d": "Stock outperforming the NIFTY 50 benchmark on 1-day basis",
    "stock_vs_sector_1d": "Stock showing alpha over its sector benchmark",
    "ret_1d": "Recent 1-day price return momentum",
    "ret_3d": "Recent 3-day short-term momentum",
    "ret_5d": "5-day weekly price momentum",
    "dist_from_20d_high": "Proximity to the recent 20-day swing high",
    "dist_from_52w_high": "Proximity to the 52-week breakout zone",
}


def explain_prediction_row(
    model,
    X_row: pd.DataFrame,
    feature_cols: Optional[List[str]] = None,
    top_pos: int = 3,
    top_neg: int = 2,
) -> Dict:
    """
    Computes exact Tree SHAP feature attributions for a single stock observation.
    Returns base value, top positive driver features, and top negative drag features.
    """
    if feature_cols is None:
        feature_cols = model.booster_.feature_name()

    # Ensure X_row is aligned with feature_cols
    X_arr = X_row.reindex(columns=feature_cols, fill_value=0.0).astype(np.float32).values

    # Native LightGBM Tree SHAP (pred_contrib=True returns array of shape (1, num_features + 1))
    # The last element is the expected base value
    contribs = model.booster_.predict(X_arr, pred_contrib=True)[0]

    feature_contribs = contribs[:-1]
    base_value = float(contribs[-1])

    # Map contributions to feature names
    contrib_series = pd.Series(feature_contribs, index=feature_cols)

    # Sort positive and negative drivers
    positive_drivers = contrib_series[contrib_series > 0].sort_values(ascending=False).head(top_pos)
    negative_drags = contrib_series[contrib_series < 0].sort_values(ascending=True).head(top_neg)

    pos_list = [
        {
            "feature": feat,
            "shap_value": round(float(val), 4),
            "feature_val": round(float(X_row[feat].values[0]), 4) if feat in X_row else 0.0,
            "description": FEATURE_DESCRIPTIONS.get(feat, feat),
        }
        for feat, val in positive_drivers.items()
    ]

    neg_list = [
        {
            "feature": feat,
            "shap_value": round(float(val), 4),
            "feature_val": round(float(X_row[feat].values[0]), 4) if feat in X_row else 0.0,
            "description": FEATURE_DESCRIPTIONS.get(feat, feat),
        }
        for feat, val in negative_drags.items()
    ]

    # Narrative generation
    pos_str = ", ".join([f"{p['feature']} (+{p['shap_value']:.2f})" for p in pos_list]) if pos_list else "None"
    neg_str = ", ".join([f"{n['feature']} ({n['shap_value']:.2f})" for n in neg_list]) if neg_list else "None"
    narrative = f"Drivers: {pos_str} | Drags: {neg_str}"

    return {
        "base_value": round(base_value, 4),
        "total_shap_sum": round(float(contrib_series.sum()), 4),
        "positive_drivers": pos_list,
        "negative_drags": neg_list,
        "narrative": narrative,
    }


def explain_dataset(
    model,
    X_df: pd.DataFrame,
    feature_cols: List[str],
) -> pd.DataFrame:
    """
    Computes exact Tree SHAP values across an entire dataframe of candidates.
    Returns a dataframe of SHAP values matching X_df's index.
    """
    X_arr = X_df.reindex(columns=feature_cols, fill_value=0.0).astype(np.float32).values
    contribs = model.booster_.predict(X_arr, pred_contrib=True)
    shap_df = pd.DataFrame(contribs[:, :-1], columns=feature_cols, index=X_df.index)
    return shap_df
