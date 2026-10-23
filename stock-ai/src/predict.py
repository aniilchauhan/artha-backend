"""
Daily Prediction Scanner Module for Indian NSE Stocks.
Runs after market close to generate model probabilities for tomorrow's trading session.
Ranks all stocks in the universe, assigns risk labels (Strong Candidate / Watch / Skip),
displays key technical context, and exports predictions to CSV.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

# Add project root to sys.path
# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features, explain, sentiment

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


def load_model_for_inference() -> Tuple[object, List[str], Dict]:
    """
    Loads saved model and feature list for daily inference.
    Prefers calibrated model when config.USE_CALIBRATED_MODEL is True.
    """
    if not config.MODEL_FILE.exists():
        raise FileNotFoundError(
            f"Model not found at {config.MODEL_FILE}. Run src/train.py first."
        )
    if not config.METADATA_FILE.exists():
        raise FileNotFoundError(
            f"Metadata not found at {config.METADATA_FILE}."
        )

    if config.USE_CALIBRATED_MODEL and not config.CALIBRATED_MODEL_FILE.exists():
        raise FileNotFoundError("Configured calibrated model is unavailable; refusing raw probability fallback.")

    # Prefer calibrated model for inference
    if config.USE_CALIBRATED_MODEL and config.CALIBRATED_MODEL_FILE.exists():
        from src.calibrate import load_calibrated_model
        model = load_calibrated_model()
        logger.info("[Inference] Using CALIBRATED model via load_calibrated_model()")
    else:
        model = joblib.load(config.MODEL_FILE)
        logger.info(f"[Inference] Using raw model: {config.MODEL_FILE}")

    with open(config.METADATA_FILE, "r") as f:
        metadata = json.load(f)

    return model, metadata["features"], metadata


def prepare_inference_features(frame, feature_cols, imputation_values):
    """Use the training-fitted medians and exact feature order; reject broken artefacts."""
    if not config.USE_SYNTHETIC_FEATURES:
        from src.clean_contract import assert_no_synthetic
        assert_no_synthetic(feature_cols)
    missing = set(feature_cols) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing inference features: {sorted(missing)}")
    if any(col not in imputation_values or not np.isfinite(imputation_values[col]) for col in feature_cols):
        raise ValueError("Missing or non-finite training imputation values")
    vector = dataset.apply_imputation(frame[feature_cols], imputation_values, feature_cols).astype(np.float32)
    if not np.isfinite(vector.to_numpy()).all():
        raise ValueError("Inference features contain non-finite values")
    return vector


def scan_latest_universe(
    tickers: Optional[List[str]] = None,
    output_csv: Optional[Path] = config.PREDICTIONS_CSV,
    include_live_sentiment: bool = False,
    record_ledger: bool = False,
    intended_session: Optional[str] = None,
) -> pd.DataFrame:
    """
    Executes daily scanner across all universe stocks using data through the latest market close.
    """
    if tickers is None:
        tickers = config.STOCK_UNIVERSE

    model, feature_cols, metadata = load_model_for_inference()
    with open(config.MODELS_DIR / "imputation_values.json", encoding="utf-8") as handle:
        imputation_values = json.load(handle)
    benchmarks = features.load_market_benchmarks()

    logger.info(f"Loaded model trained on {metadata['train_start']} to {metadata['train_end']}")
    logger.info(f"Scanning universe of {len(tickers)} stocks for tomorrow's session...")

    predictions = []

    for ticker in tickers:
        safe_filename = ticker.replace("^", "").replace(".", "_") + ".csv"
        raw_file = config.RAW_DIR / safe_filename

        if not raw_file.exists():
            continue

        raw_df = pd.read_csv(raw_file)
        if len(raw_df) < 50:
            continue

        # Build feature pipeline for the stock (is_training=False ensures NO target or lookahead)
        stock_features_df = features.build_stock_pipeline(
            ticker=ticker,
            raw_df=raw_df,
            benchmarks=benchmarks,
            is_training=False,
        )

        # The latest completed trading day is the very last row (Date T)
        latest_row = stock_features_df.iloc[-1:].copy()
        scan_date = pd.to_datetime(latest_row["Date"].values[0]).strftime("%Y-%m-%d")

        sentiment_res = {"score": 0.0, "label": "Unavailable", "catalyst_headline": "Not fetched",
                         "catalyst_reason": "Offline research run uses cached historical features.", "source_mode": "cached_research"}
        if include_live_sentiment:
            sentiment_res = sentiment.analyze_sentiment(ticker)

            # Inject live sentiment into latest row feature vector if columns exist
            if "sentiment_score" in latest_row.columns:
                latest_row["sentiment_score"] = sentiment_res["score"]
            if "sentiment_buzz" in latest_row.columns:
                latest_row["sentiment_buzz"] = 0.5
            if "sentiment_ma3" in latest_row.columns:
                curr_ma3 = latest_row["sentiment_ma3"].values[0] if not pd.isna(latest_row["sentiment_ma3"].values[0]) else 0.0
                latest_row["sentiment_ma3"] = (curr_ma3 * 0.67) + (sentiment_res["score"] * 0.33)

        # Feature vector for inference (defensively aligned with model's trained features)
        X_latest = prepare_inference_features(latest_row, feature_cols, imputation_values)

        # Predict probability
        prob = float(model.predict_proba(X_latest)[:, 1][0])
        if not np.isfinite(prob) or not 0.0 <= prob <= 1.0:
            raise ValueError(f"Invalid model probability for {ticker}")

        # Compute Tree SHAP feature drivers
        shap_res = explain.explain_prediction_row(model, X_latest, feature_cols=feature_cols)

        # Assign label based on configurable thresholds
        if prob >= config.PREDICTION_THRESHOLDS["strong"]:
            label = "Strong Candidate"
        elif prob >= config.PREDICTION_THRESHOLDS["watch"]:
            label = "Watch"
        else:
            label = "Skip"

        # Technical context indicators
        close_val = float(latest_row["Close"].values[0])
        rsi_val = float(latest_row["rsi_14"].values[0]) if "rsi_14" in latest_row else np.nan
        vol_ratio = float(latest_row["vol_to_sma20"].values[0]) if "vol_to_sma20" in latest_row else np.nan
        ret_1d_val = float(latest_row["ret_1d"].values[0]) if "ret_1d" in latest_row else np.nan
        ret_5d_val = float(latest_row["ret_5d"].values[0]) if "ret_5d" in latest_row else np.nan
        atr_pct_val = float(latest_row["atr_pct"].values[0]) if "atr_pct" in latest_row else np.nan

        # Nifty context
        nifty_trend_val = (
            float(latest_row["nifty_trend"].values[0])
            if "nifty_trend" in latest_row and not pd.isna(latest_row["nifty_trend"].values[0])
            else np.nan
        )

        predictions.append({
            "Date": scan_date,
            "Ticker": ticker,
            "Model Score": round(prob, 4),
            "Label": label,
            "Sentiment Score": round(sentiment_res["score"], 4),
            "Sentiment Label": sentiment_res["label"],
            "Top News Catalyst": sentiment_res["catalyst_headline"],
            "Catalyst Rationale": sentiment_res["catalyst_reason"],
            "Sentiment Engine": sentiment_res["source_mode"],
            "Close (Rs.)": f"Rs. {close_val:,.2f}",
            "Close_Numeric": round(close_val, 2),
            "RSI (14)": round(rsi_val, 1) if not pd.isna(rsi_val) else "N/A",
            "Vol Ratio (20d)": round(vol_ratio, 2) if not pd.isna(vol_ratio) else "N/A",
            "1D Return": f"{ret_1d_val*100:+.2f}%" if not pd.isna(ret_1d_val) else "N/A",
            "5D Return": f"{ret_5d_val*100:+.2f}%" if not pd.isna(ret_5d_val) else "N/A",
            "ATR %": f"{atr_pct_val*100:.2f}%" if not pd.isna(atr_pct_val) else "N/A",
            "Nifty Trend": f"{nifty_trend_val*100:+.2f}%" if not pd.isna(nifty_trend_val) else "N/A",
            "Key SHAP Driver": shap_res["positive_drivers"][0]["description"] if shap_res["positive_drivers"] else "N/A",
            "SHAP Narrative": shap_res["narrative"],
            "positive_drivers": shap_res["positive_drivers"],
            "negative_drags": shap_res["negative_drags"],
        })

    pred_df = pd.DataFrame(predictions)
    pred_df = pred_df.sort_values(by="Model Score", ascending=False).reset_index(drop=True)
    pred_df["Rank"] = range(1, len(pred_df) + 1)

    # Reorder columns
    display_cols = [
        "Rank",
        "Ticker",
        "Model Score",
        "Sentiment Label",
        "Label",
        "Close (Rs.)",
        "RSI (14)",
        "Vol Ratio (20d)",
        "1D Return",
        "5D Return",
        "ATR %",
    ]

    latest_market_date = pred_df["Date"].iloc[0] if len(pred_df) > 0 else "N/A"

    print("\n" + "=" * 85)
    print(f"DAILY PREDICTION SCANNER — NSE STOCKS (DATE: {latest_market_date})")
    print(f"Target: Probability that next day High touches >= +{config.TARGET_PCT*100:.0f}% from next session Open before the stop")
    print("=" * 85)

    strong_df = pred_df[pred_df["Label"] == "Strong Candidate"]
    watch_df = pred_df[pred_df["Label"] == "Watch"]
    skip_df = pred_df[pred_df["Label"] == "Skip"]

    print("\nTOP +2% CANDIDATES (OVERALL UNIVERSE RANKING):")
    print("-" * 85)
    print(pred_df[display_cols].head(10).to_string(index=False))

    if not strong_df.empty:
        print(f"\nSTRONG CANDIDATES (SCORE >= {config.PREDICTION_THRESHOLDS['strong']:.2f}):")
        print("-" * 85)
        print(strong_df[display_cols].to_string(index=False))

    if not watch_df.empty:
        print(f"\nWATCHLIST CANDIDATES ({config.PREDICTION_THRESHOLDS['watch']:.2f} <= SCORE < {config.PREDICTION_THRESHOLDS['strong']:.2f}):")
        print("-" * 85)
        print(watch_df[display_cols].to_string(index=False))

    print(f"\nUNIVERSE CLASSIFICATION BREAKDOWN:")
    print(f"  Strong Candidates: {len(strong_df)} | Watch: {len(watch_df)} | Skip: {len(skip_df)} | Total Universe: {len(pred_df)}")
    print("=" * 85)

    print("\nCRITICAL MODEL USAGE DISCLAIMER:")
    print("  * Model scores are research probabilities indicating relative upside potential.")
    print("  * They are NOT buy recommendations or guaranteed trading advice.")
    print("  * Market risks, gap openings, earnings releases, and black swan events are not fully captured.")
    print("=" * 85)

    # Save to CSV and JSON
    if output_csv:
        output_csv.parent.mkdir(parents=True, exist_ok=True)
        pred_df.to_csv(output_csv, index=False)
        json_path = output_csv.with_suffix(".json")
        pred_df.to_json(json_path, orient="records", indent=4)
        logger.info(f"Saved predictions to {output_csv} and {json_path}")

        # Record only when the caller has supplied the verified future session.
        # The latest input date is already closed and must never be reused.
        if record_ledger and not intended_session:
            logger.warning("[Ledger] Skipping ledger writes: intended_session was not supplied.")
        try:
            from src import ledger
            for _, r in (pred_df.iterrows() if record_ledger and intended_session else []):
                ledger.record_prediction(
                    ticker=r["Ticker"],
                    horizon="next",
                    intended_session=intended_session,
                    reference_price=float(r["Close_Numeric"]),
                    score=float(r["Model Score"]),
                    calibrated_prob=float(r["Model Score"]),
                    entry_condition="market_open",
                    target_pct=config.TARGET_PCT,
                    stop_pct=getattr(config, "STOP_LOSS_PCT", 0.02),
                    target_version=getattr(config, "TARGET_VERSION", "2.0-executable"),
                    positive_drivers=r.get("positive_drivers", []),
                    negative_drags=r.get("negative_drags", []),
                )
            logger.info(f"[Ledger] Successfully appended {len(pred_df)} predictions to immutable ledger.")
        except Exception as ledger_err:
            logger.warning(f"Failed to append to ledger: {ledger_err}")

    return pred_df


if __name__ == "__main__":
    scan_latest_universe()
