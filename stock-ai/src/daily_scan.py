"""
Automated Daily End-of-Day (EOD) Market Scanner and Watchlist Generator.

Runs after Indian market close (e.g. 4:00 PM IST).
Pipeline:
  1. Synchronizes latest market benchmark & stock candles (optional YFinance fetch).
  2. Pulls real-time financial news headlines and scores LLM/NLP sentiment catalysts.
  3. Computes 71 multi-factor technical, macro, institutional, and sentiment features.
  4. Runs inference using the Calibrated Tri-Model Soft-Voting Ensemble (LGBM+XGB+CatBoost).
  5. Computes Tree SHAP feature attribution (top positive drivers & negative drags).
  6. Calculates exact trade execution levels (Breakout Entry, 1.2x ATR Stop Loss, +2% Target).
  7. Formats and exports:
       - outputs/latest_predictions.json (Live Next.js UI integration)
       - outputs/latest_predictions.csv
       - outputs/daily_watchlist_latest.md (Executive Markdown Watchlist Report)
"""

import sys
import json
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import features, explain, sentiment
from src.download_data import get_universe_tickers, download_in_bunches
from src.predict import load_model_for_inference, prepare_inference_features

# Reconfigure stdout/stderr for UTF-8 on Windows
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


def load_inference_model() -> Tuple[object, List[str], Dict]:
    """Use the same required calibration and feature schema as research inference."""
    return load_model_for_inference()


def refresh_latest_candles(tickers: List[str], cooldown: float = 1.0) -> None:
    """Refreshes the latest day's candles for benchmarks and target universe."""
    logger.info("Checking & refreshing today's EOD candles from market...")
    import yfinance as yf
    yf.set_tz_cache_location(str(config.DATA_DIR / 'provider-cache'))
    # Refresh benchmarks
    benchmark_tickers = list(config.MARKET_INDICES.values())
    download_in_bunches(
        tickers=benchmark_tickers,
        output_dir=config.MARKET_DIR,
        bunch_size=len(benchmark_tickers),
        start_date=config.START_DATE,
        cooldown_delay=cooldown,
        resume=False,
        force=True,
    )
    # Refresh stocks
    download_in_bunches(
        tickers=tickers,
        output_dir=config.RAW_DIR,
        bunch_size=config.DEFAULT_BUNCH_SIZE,
        start_date=config.START_DATE,
        cooldown_delay=cooldown,
        resume=False,
        force=True,
    )


def compute_trade_levels(close: float, atr_pct: float) -> Dict[str, float]:
    """
    Computes precise trade execution parameters based on our backtested strategy:
      - Trigger Entry: Today's Close + 0.25% breakout buffer
      - Target: Trigger Entry * 1.02 (+2.0% profit target)
      - Dynamic Stop Loss: Trigger Entry - (1.2 * ATR)
      - Reward-to-Risk Ratio
    """
    safe_atr_pct = atr_pct if not pd.isna(atr_pct) and atr_pct > 0 else 0.02
    atr_rupees = close * safe_atr_pct

    entry_price = round(close * 1.0025, 2)
    target_price = round(entry_price * (1.0 + config.PROFIT_TARGET_PCT), 2)
    stop_loss_price = round(entry_price - (1.2 * atr_rupees), 2)

    risk_per_share = max(0.05, entry_price - stop_loss_price)
    reward_per_share = max(0.05, target_price - entry_price)
    rr_ratio = round(reward_per_share / risk_per_share, 2)

    return {
        "entry_price": entry_price,
        "stop_loss_price": stop_loss_price,
        "target_price": target_price,
        "risk_rupees": round(risk_per_share, 2),
        "reward_rupees": round(reward_per_share, 2),
        "reward_risk_ratio": rr_ratio,
    }


def generate_executive_watchlist_markdown(
    scan_date: str,
    predictions: List[Dict],
    universe_name: str,
    output_path: Path,
) -> str:
    """Generates an executive-ready Markdown report with ranked tiers, rationale, and catalysts."""
    strong_cands = [p for p in predictions if p["Label"] == "Strong Candidate"]
    watch_cands = [p for p in predictions if p["Label"] == "Watch"]
    skip_count = len([p for p in predictions if p["Label"] == "Skip"])

    nifty_context = predictions[0].get("Nifty Trend", "N/A") if predictions else "N/A"

    lines = [
        f"# NSE Stock AI Daily Market Watchlist ({scan_date})",
        "",
        f"> **Generated at**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')} | **Universe**: {universe_name.upper()} ({len(predictions)} Stocks Evaluated)",
        "> **Model**: Saved model inference. Scores and optional news context require artifact validation before serving.",
        "",
        "---",
        "",
        "## Executive Summary & Market Context",
        "",
        f"- **Benchmark Nifty 50 Trend**: `{nifty_context}`",
        f"- **Strong Candidates (Model Score >= {config.PREDICTION_THRESHOLDS['strong']:.2f})**: **{len(strong_cands)} Setups**",
        f"- **Watchlist Setups (Model Score >= {config.PREDICTION_THRESHOLDS['watch']:.2f})**: **{len(watch_cands)} Setups**",
        f"- **Neutral / Skip Filtered Out**: **{skip_count} Stocks**",
        "",
        "---",
        "",
    ]

    # Section 1: Strong Candidates Table
    lines.append("## Tier 1: Strong Candidates by Model Score")
    lines.append("")
    if strong_cands:
        lines.append("| Rank | Ticker | Close | Entry Trigger | Target (+2%) | Stop Loss (1.2x ATR) | R:R | Model Score | Sentiment | News Catalyst |")
        lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
        for p in strong_cands:
            t = p["trade_levels"]
            lines.append(
                f"| #{p['Rank']} | **{p['Ticker']}** | {p['Close (Rs.)']} | **Rs. {t['entry_price']:,.2f}** | Rs. {t['target_price']:,.2f} | Rs. {t['stop_loss_price']:,.2f} | {t['reward_risk_ratio']}:1 | **{(p['Model Score']*100):.1f}%** | `{p['Sentiment Label']}` | {p['Top News Catalyst'][:60]}... |"
            )
        lines.append("")
        lines.append("### Setup Rationale & SHAP Drivers")
        for p in strong_cands:
            lines.append(f"#### **{p['Ticker']}** — Score: {(p['Model Score']*100):.1f}% ({p['Sentiment Label']})")
            lines.append(f"- **Primary Quantitative Drivers**: `{p['Key SHAP Driver']}`")
            lines.append(f"- **SHAP Narrative**: {p['SHAP Narrative']}")
            lines.append(f"- **Live Catalyst**: *\"{p['Top News Catalyst']}\"*")
            lines.append(f"- **Catalyst Reason**: {p['Catalyst Rationale']}")
            lines.append("")
    else:
        lines.append("*No setups met the configured strong-candidate score threshold.*")
        lines.append("")

    lines.append("---")
    lines.append("")

    # Section 2: Watchlist Setups Table
    lines.append("## Tier 2: Watchlist Candidates by Model Score")
    lines.append("")
    if watch_cands:
        lines.append("| Rank | Ticker | Close | Entry Trigger | Target (+2%) | Stop Loss | Model Score | Sentiment | Key SHAP Driver |")
        lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
        for p in watch_cands[:15]:
            t = p["trade_levels"]
            lines.append(
                f"| #{p['Rank']} | **{p['Ticker']}** | {p['Close (Rs.)']} | Rs. {t['entry_price']:,.2f} | Rs. {t['target_price']:,.2f} | Rs. {t['stop_loss_price']:,.2f} | {(p['Model Score']*100):.1f}% | `{p['Sentiment Label']}` | `{p['Key SHAP Driver']}` |"
            )
        lines.append("")
    else:
        lines.append("*No setups met the configured watchlist score band.*")
        lines.append("")

    lines.append("---")
    lines.append("")

    # Section 3: Top Relative Strength Leaders (Overall Ranking)
    lines.append("## Top Relative Strength Leaders (Overall Universe Ranking)")
    lines.append("Even during defensive or consolidation regimes, these stocks exhibit the highest relative upside momentum and institutional flow:")
    lines.append("")
    lines.append("| Rank | Ticker | Close | Model Score | RSI (14) | Vol Ratio | 1D Return | Sentiment | Top News Catalyst | Key SHAP Driver |")
    lines.append("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |")
    for p in predictions[:5]:
        cat_preview = p['Top News Catalyst'][:45] + "..." if p['Top News Catalyst'] else "N/A"
        lines.append(
            f"| #{p['Rank']} | **{p['Ticker']}** | {p['Close (Rs.)']} | **{(p['Model Score']*100):.1f}%** | {p['RSI (14)']} | {p['Vol Ratio (20d)']} | {p['1D Return']} | `{p['Sentiment Label']}` | {cat_preview} | `{p['Key SHAP Driver']}` |"
        )
    lines.append("")
    lines.append("---")
    lines.append("")

    # Section 4: Execution Rules & Risk Disclaimer
    lines.append("## Strict Execution Rules")
    lines.append("1. **Breakout Trigger Only**: Do NOT buy at the open. Place a BUY STOP-LIMIT order at the specified `Entry Trigger` price.")
    lines.append("2. **Dynamic Risk Control**: Place immediate Hard Stop Loss at the `Stop Loss` level. Never hold overnight if stop is hit.")
    lines.append("3. **Profit Target**: Exit 100% position when price touches `Target (+2%)` or square off at 3:20 PM IST.")
    lines.append("")
    lines.append("> [!WARNING]")
    lines.append("> **Research status**: A model score is not a validated win rate. News context is separate from model inference. The illustrative breakout levels are not evidence of performance for that execution strategy.")

    report_content = "\n".join(lines)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    # Also save as latest
    latest_path = output_path.parent / "daily_watchlist_latest.md"
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    logger.info(f"Saved executive daily watchlist to {output_path} and {latest_path}")
    return report_content


def run_daily_scan(
    universe: str = "core50",
    refresh_data: bool = False,
    min_score: float = 0.0,
    top_n: Optional[int] = None,
    fast: bool = False,
) -> List[Dict]:
    """
    Executes the end-of-day market scanning pipeline.
    """
    tickers = get_universe_tickers(universe)
    if top_n:
        tickers = tickers[:top_n]

    logger.info("=" * 75)
    logger.info(f"STARTING DAILY EOD MARKET SCAN (UNIVERSE: {universe.upper()}, {len(tickers)} STOCKS)")
    logger.info("=" * 75)

    if refresh_data:
        refresh_latest_candles(tickers)

    model, feature_cols, _metadata = load_inference_model()
    with open(config.MODELS_DIR / "imputation_values.json", encoding="utf-8") as handle:
        imputation_values = json.load(handle)
    # Reject incomplete preprocessing artifacts before scanning or replacing outputs.
    prepare_inference_features(pd.DataFrame(columns=feature_cols), feature_cols, imputation_values)
    benchmarks = features.load_market_benchmarks()
    model_hash = hashlib.sha256(config.MODEL_FILE.read_bytes()).hexdigest()
    if (_metadata.get('target_version') != '2.0-executable'
            or _metadata.get('preprocessing_version') != '2.0-temporal-isolated'
            or _metadata.get('model_sha256') != model_hash):
        raise ValueError('Model metadata does not match the compatible inference model')

    predictions = []
    scan_date = datetime.now().strftime("%Y-%m-%d")

    for idx, ticker in enumerate(tickers, start=1):
        safe_fn = ticker.replace("^", "").replace(".", "_") + ".csv"
        raw_file = config.RAW_DIR / safe_fn

        if not raw_file.exists():
            continue

        try:
            raw_df = pd.read_csv(raw_file)
            if len(raw_df) < 50:
                continue

            stock_features_df = features.build_stock_pipeline(
                ticker=ticker,
                raw_df=raw_df,
                benchmarks=benchmarks,
                is_training=False,
            )

            latest_row = stock_features_df.iloc[-1:].copy()
            scan_date = pd.to_datetime(latest_row["Date"].values[0]).strftime("%Y-%m-%d")
            today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
            input_date = datetime.strptime(scan_date, '%Y-%m-%d').date()
            if not 0 <= (today - input_date).days <= 4:
                raise ValueError(f'Stale or future input candles: {scan_date}')
            if datetime.now(timezone.utc) < datetime.strptime(scan_date + 'T15:30:00+0530', '%Y-%m-%dT%H:%M:%S%z'):
                raise ValueError('Daily input candle is not complete before market close')

            # Full-universe runs can score without network enrichment.
            sentiment_res = (
                {"score": 0.0, "label": "Unavailable", "catalyst_headline": "Not requested",
                 "catalyst_reason": "Fast scan omitted live sentiment enrichment.", "source_mode": "not_requested"}
                if fast else sentiment.analyze_sentiment(ticker)
            )

            # News is display-only context: the fitted model was not trained on
            # these live LLM/lexicon scores or a fabricated constant buzz value.
            X_latest = prepare_inference_features(latest_row, feature_cols, imputation_values)

            # Predict calibrated probability
            prob = float(model.predict_proba(X_latest)[:, 1][0])
            if not np.isfinite(prob) or not 0.0 <= prob <= 1.0:
                raise ValueError(f"Invalid model probability for {ticker}")

            # SHAP is optional enrichment and is omitted by fast full-universe scans.
            shap_res = (
                {"positive_drivers": [], "negative_drags": [], "narrative": "Not generated in fast scan mode."}
                if fast else explain.explain_prediction_row(model, X_latest, feature_cols=feature_cols)
            )

            # Label assignment
            if prob >= config.PREDICTION_THRESHOLDS["strong"]:
                label = "Strong Candidate"
            elif prob >= config.PREDICTION_THRESHOLDS["watch"]:
                label = "Watch"
            else:
                label = "Skip"

            close_val = float(latest_row["Close"].values[0])
            rsi_val = float(latest_row["rsi_14"].values[0]) if "rsi_14" in latest_row else np.nan
            vol_ratio = float(latest_row["vol_to_sma20"].values[0]) if "vol_to_sma20" in latest_row else np.nan
            ret_1d_val = float(latest_row["ret_1d"].values[0]) if "ret_1d" in latest_row else np.nan
            ret_5d_val = float(latest_row["ret_5d"].values[0]) if "ret_5d" in latest_row else np.nan
            atr_pct_val = float(latest_row["atr_pct"].values[0]) if "atr_pct" in latest_row else np.nan
            nifty_trend_val = (
                float(latest_row["nifty_trend"].values[0])
                if "nifty_trend" in latest_row and not pd.isna(latest_row["nifty_trend"].values[0])
                else np.nan
            )

            # Calculate trade levels
            trade_levels = compute_trade_levels(close_val, atr_pct_val)

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
                "trade_levels": trade_levels,
                "Sector": config.SECTOR_MAP.get(ticker, "^NSEI").replace("^", "").replace("CNX", "").replace("NSE", ""),
            })
        except Exception as e:
            logger.warning(f"Skipping {ticker}: {e}")

        if idx % 100 == 0:
            logger.info(f"Processed {idx}/{len(tickers)} symbols; predictions={len(predictions)}")

    if not predictions:
        raise ValueError("No valid prediction rows; preserving existing scanner outputs")

    # Sort descending by model score
    predictions = sorted(predictions, key=lambda x: x["Model Score"], reverse=True)
    for idx, p in enumerate(predictions, start=1):
        p["Rank"] = idx

    # Filter by min_score if requested
    if min_score > 0:
        predictions = [p for p in predictions if p["Model Score"] >= min_score]

    # Save outputs
    config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. JSON
    with open(config.OUTPUTS_DIR / "latest_predictions.json", "w", encoding="utf-8") as f:
        json.dump(predictions, f, indent=2)

    # 2. CSV
    df_export = pd.DataFrame(predictions)
    df_export.to_csv(config.OUTPUTS_DIR / "latest_predictions.csv", index=False)

    # Publish inference provenance without inventing a new accuracy evaluation.
    manifest_path = config.OUTPUTS_DIR / 'provenance.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {
        key: _metadata[key] for key in ('target_version', 'preprocessing_version',
        'model_sha256', 'dataset_sha256', 'limitations') if key in _metadata
    }
    manifest.setdefault('artifacts', {})
    manifest.setdefault('artifact_metadata', {})
    for filename in ('latest_predictions.json', 'latest_predictions.csv'):
        manifest['artifacts'][filename] = hashlib.sha256((config.OUTPUTS_DIR / filename).read_bytes()).hexdigest()
        manifest['artifact_metadata'][filename] = {
            'data_cutoff': min(p['Date'] for p in predictions),
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'universe': universe,
            'accuracy_status': 'research_candidate',
        }
    manifest['calibrated_model_sha256'] = hashlib.sha256(config.CALIBRATED_MODEL_FILE.read_bytes()).hexdigest()
    manifest_tmp = manifest_path.with_suffix('.tmp')
    manifest_tmp.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    manifest_tmp.replace(manifest_path)

    # 3. Markdown Executive Watchlist Report
    report_file = config.OUTPUTS_DIR / f"daily_watchlist_{scan_date}.md"
    generate_executive_watchlist_markdown(scan_date, predictions, universe, report_file)

    logger.info("=" * 75)
    logger.info(f"DAILY SCAN COMPLETE: {len(predictions)} stocks evaluated.")
    logger.info(f"Strong Setups: {len([p for p in predictions if p['Label'] == 'Strong Candidate'])}")
    logger.info(f"Watchlist: {len([p for p in predictions if p['Label'] == 'Watch'])}")
    logger.info("=" * 75)

    return predictions


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run Automated Daily EOD Market Scanner.")
    parser.add_argument(
        "--universe",
        type=str,
        default="core50",
        choices=["core50", "nifty500", "nifty100", "all"],
        help="Universe to scan (default: core50; use all for the full NSE directory)",
    )
    parser.add_argument("--refresh-data", action="store_true", help="Download today's latest EOD candle before scanning")
    parser.add_argument("--min-score", type=float, default=0.0, help="Minimum probability threshold to include")
    parser.add_argument("--top-n", type=int, default=None, help="Limit scan to top N stocks in universe")
    parser.add_argument("--fast", action="store_true", help="Skip live sentiment and SHAP enrichment for large universes")
    args = parser.parse_args()

    run_daily_scan(
        universe=args.universe,
        refresh_data=args.refresh_data,
        min_score=args.min_score,
        top_n=args.top_n,
        fast=args.fast,
    )
