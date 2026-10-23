"""
Configuration file for Indian NSE Stock AI/ML Prediction & Backtesting System.
Centralizes universe definitions, market benchmarks, date splits, model parameters,
and trading simulation rules.
"""

from pathlib import Path
import os

# ==========================================
# 1. Project Directory Paths
# ==========================================
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MARKET_DIR = DATA_DIR / "market"
SENTIMENT_DIR = DATA_DIR / "sentiment"
SENTIMENT_CACHE_DIR = SENTIMENT_DIR / "cache"
MODELS_DIR = BASE_DIR / "models"
OUTPUTS_DIR = BASE_DIR / "outputs"
# Candidate runs keep processed data, models, and reports separate from served artifacts.
if os.environ.get("AXION_MODEL_RUN_DIR"):
    RUN_DIR = Path(os.environ["AXION_MODEL_RUN_DIR"]).resolve()
    PROCESSED_DIR = RUN_DIR / "processed"
    MODELS_DIR = RUN_DIR / "models"
    OUTPUTS_DIR = RUN_DIR / "outputs"

# New expanded data directories
FUNDAMENTALS_DIR = DATA_DIR / "fundamentals"     # Per-ticker fundamental JSON files
EVENTS_DIR = DATA_DIR / "corporate_events"        # Corporate actions / results calendar
OPTIONS_DIR = DATA_DIR / "options"                # NSE F&O options EOD snapshots
MACRO_DIR = DATA_DIR / "macro"                    # Macro market data (crude, gold, VIX, etc.)

# Ensure all directories exist
for directory in [
    RAW_DIR, PROCESSED_DIR, MARKET_DIR, SENTIMENT_DIR, SENTIMENT_CACHE_DIR,
    MODELS_DIR, OUTPUTS_DIR,
    FUNDAMENTALS_DIR, EVENTS_DIR, OPTIONS_DIR, MACRO_DIR,
]:
    directory.mkdir(parents=True, exist_ok=True)

# File paths
COMBINED_DATASET_PARQUET = PROCESSED_DIR / "combined_dataset.parquet"
COMBINED_DATASET_CSV = PROCESSED_DIR / "combined_dataset.csv"
HISTORICAL_SENTIMENT_FILE = SENTIMENT_DIR / "historical_sentiment.parquet"
MODEL_FILE = MODELS_DIR / "lightgbm_stock_model.pkl"
CALIBRATED_MODEL_FILE = MODELS_DIR / "lightgbm_calibrated.pkl"
METADATA_FILE = MODELS_DIR / "model_metadata.json"
BEST_PARAMS_FILE = MODELS_DIR / "best_params.json"
PREDICTIONS_CSV = OUTPUTS_DIR / "latest_predictions.csv"
DOWNLOAD_CHECKPOINT_FILE = DATA_DIR / "download_checkpoint.json"
UNAVAILABLE_SYMBOLS_FILE = DATA_DIR / "unavailable_symbols.json"
SYMBOL_ALIASES_FILE = DATA_DIR / "symbol_aliases.json"
NSE_MASTER_FILE = DATA_DIR / "nse_equities_master.csv"
NIFTY500_MASTER_FILE = DATA_DIR / "nifty500_master.csv"
NIFTY100_MASTER_FILE = DATA_DIR / "nifty100_master.csv"

# Expanded data file paths
FUNDAMENTALS_SUMMARY_FILE = FUNDAMENTALS_DIR / "fundamentals_summary.json"
EVENTS_FILE = EVENTS_DIR / "events.json"
OPTIONS_FILE = OPTIONS_DIR / "latest_options.json"
MACRO_SNAPSHOT_FILE = MACRO_DIR / "macro_snapshot.json"
FO_ELIGIBLE_FILE = OPTIONS_DIR / "fo_eligible_stocks.json"

# Bunch download settings
DEFAULT_BUNCH_SIZE = 25
DEFAULT_UNIVERSE = "nifty500"
HISTORICAL_LOOKBACK_YEARS = 6

# ==========================================
# Feature Flags
# ==========================================
# Use isotonic-calibrated model for inference and evaluation.
# Set to False to use the raw LightGBM model (pre-calibration).
USE_CALIBRATED_MODEL = True
# Strict verification: synthetic sentiment and simulated institutional flows are deprecated by default.
USE_SYNTHETIC_FEATURES = os.environ.get("AXION_SYNTHETIC_FEATURES", "0") == "1"

# ==========================================
# 2. Universe Definition (~50 Liquid NSE Stocks)
# ==========================================
# Selected from the most liquid NIFTY 50 / Large-cap universe with .NS suffix
STOCK_UNIVERSE = [
    # Mega Caps / Energy / Conglomerates
    "RELIANCE.NS",
    "TCS.NS",
    "INFY.NS",
    "HDFCBANK.NS",
    "ICICIBANK.NS",
    "SBIN.NS",
    "BHARTIARTL.NS",
    "LT.NS",
    "SUNPHARMA.NS",
    "VEDL.NS",
    "HAL.NS",
    # Financial Services & Banks
    "KOTAKBANK.NS",
    "AXISBANK.NS",
    "BAJFINANCE.NS",
    "BAJAJFINSV.NS",
    "INDUSINDBK.NS",
    # IT Services
    "WIPRO.NS",
    "HCLTECH.NS",
    "TECHM.NS",
    # FMCG & Consumer
    "HINDUNILVR.NS",
    "ITC.NS",
    "NESTLEIND.NS",
    "BRITANNIA.NS",
    "TATACONSUM.NS",
    "TITAN.NS",
    "ASIANPAINT.NS",
    # Automobile & Transportation
    "MARUTI.NS",
    "M&M.NS",
    "BAJAJ-AUTO.NS",
    "EICHERMOT.NS",
    "HEROMOTOCO.NS",
    # Pharma & Healthcare
    "CIPLA.NS",
    "DRREDDY.NS",
    "APOLLOHOSP.NS",
    "DIVISLAB.NS",
    # Metals & Mining
    "TATASTEEL.NS",
    "JSWSTEEL.NS",
    "HINDALCO.NS",
    "COALINDIA.NS",
    # Oil & Gas / Utilities / Power
    "NTPC.NS",
    "POWERGRID.NS",
    "ONGC.NS",
    "BPCL.NS",
    # Infrastructure & Cement
    "ULTRACEMCO.NS",
    "GRASIM.NS",
    "ADANIPORTS.NS",
    "ADANIENT.NS",
    "BEL.NS",
    "TRENT.NS",
    "SHREECEM.NS",
]


def get_stock_universe(mode: str = "curated") -> list:
    """
    Returns stock universe tickers.
    mode="curated": ~50 most liquid Large-cap NSE stocks.
    mode="full": All 2,500+ listed NSE stocks loaded from nse_2500_stocks_master.csv.
    """
    if mode == "full":
        csv_candidates = [
            BASE_DIR / "nse_2500_stocks_master.csv",
            BASE_DIR.parent / "nse_2500_stocks_master.csv",
            BASE_DIR.parent / "public" / "nse_2500_stocks_master.csv",
        ]
        for p in csv_candidates:
            if p.exists():
                try:
                    import csv
                    tickers = []
                    with open(p, "r", encoding="utf-8") as f:
                        reader = csv.reader(f)
                        header = next(reader, None)
                        for row in reader:
                            if row and len(row) > 0 and row[0].strip():
                                t = row[0].strip()
                                if not t.endswith(".NS") and not t.endswith(".BO"):
                                    t += ".NS"
                                tickers.append(t)
                    if tickers:
                        return tickers
                except Exception as e:
                    pass
    return STOCK_UNIVERSE

# ==========================================
# 3. Market & Sector Indices
# ==========================================
MARKET_INDICES = {
    "NIFTY_50": "^NSEI",
    "INDIA_VIX": "^INDIAVIX",
    "NIFTY_BANK": "^NSEBANK",
    "NIFTY_IT": "^CNXIT",
    "NIFTY_AUTO": "^CNXAUTO",
}

# Sector mapping to link stocks to their primary sector benchmark
SECTOR_MAP = {
    "TCS.NS": "^CNXIT", "INFY.NS": "^CNXIT", "WIPRO.NS": "^CNXIT",
    "HCLTECH.NS": "^CNXIT", "TECHM.NS": "^CNXIT", "LTIM.NS": "^CNXIT",
    "HDFCBANK.NS": "^NSEBANK", "ICICIBANK.NS": "^NSEBANK", "SBIN.NS": "^NSEBANK",
    "KOTAKBANK.NS": "^NSEBANK", "AXISBANK.NS": "^NSEBANK", "INDUSINDBK.NS": "^NSEBANK",
    "TATAMOTORS.NS": "^CNXAUTO", "MARUTI.NS": "^CNXAUTO", "M&M.NS": "^CNXAUTO",
    "BAJAJ-AUTO.NS": "^CNXAUTO", "EICHERMOT.NS": "^CNXAUTO", "HEROMOTOCO.NS": "^CNXAUTO",
}

# Default benchmark if sector index is unavailable or not mapped
DEFAULT_INDEX = "^NSEI"

# ==========================================
# 4. Historical Date Splits (4-Period Chronological Partitioning: M5-05)
# Decouples training, tuning/early-stopping, probability calibration, and untouched holdout.
# ==========================================
START_DATE = "2020-09-01"

# Period 1: Training (Core feature learning & initial tree growth)
TRAIN_START = "2020-09-01"
TRAIN_END = "2023-12-31"

# Period 2: Tuning / Validation (Hyperparameter search & early stopping iterations)
TUNING_START = "2024-01-01"
TUNING_END = "2024-12-31"
VAL_START = TUNING_START
VAL_END = TUNING_END

# Period 3: Calibration (Isotonic / sigmoid calibration; strictly disjoint from tuning)
CALIBRATION_START = "2025-01-01"
CALIBRATION_END = "2025-06-30"

# Period 4: Untouched Holdout Test (Virgin prospective evaluation; zero tuning exposure)
UNTOUCHED_TEST_START = "2025-07-01"
UNTOUCHED_TEST_END = "2026-12-31"
TEST_START = UNTOUCHED_TEST_START
TEST_END = UNTOUCHED_TEST_END

# ==========================================
# 5. Prediction Target Definition (docs/TARGET_SPECIFICATION.md)
# ==========================================
TARGET_PCT = 0.02  # +2.0%
TARGET_MODE = "executable_open"  # "executable_open" (Open -> High >= 2% before Stop) | "legacy_close"
TARGET_VERSION = "2.0-executable"

# ==========================================
# 6. Realistic Trading Simulation Parameters
# ==========================================
PROFIT_TARGET_PCT = 0.02      # +2.0% profit target from entry
STOP_LOSS_PCT = 0.02          # -2.0% stop loss from entry (1:1 risk-reward per TARGET_SPECIFICATION.md)
TRANSACTION_COST_PCT = 0.0010  # 0.10% round-trip (brokerage + STT + exchange + GST)
SLIPPAGE_PCT = 0.0005          # 0.05% estimated execution slippage

# Intraday conflict rule when both Target and Stop are within the daily candle:
# "stop_first": conservative (assumes stop hit first)
# "target_first": aggressive (assumes target hit first)
# "ambiguous_skip": excludes ambiguous trades
AMBIGUOUS_CANDLE_RULE = "stop_first"

# ==========================================
# 7. Model Hyperparameters (LightGBM)
# ==========================================
LGBM_PARAMS = {
    "n_estimators": 500,
    "learning_rate": 0.03,
    "num_leaves": 31,
    "max_depth": 6,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": 42,
    "n_jobs": -1,
    "importance_type": "gain",
    "verbose": -1,
}

# Imbalance handling: "balanced", "scale_pos_weight", or None
IMBALANCE_METHOD = "balanced"

# ==========================================
# 8. Evaluation & Prediction Thresholds
# ==========================================
EVAL_THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]

PREDICTION_THRESHOLDS = {
    "strong": 0.25,  # "Strong Candidate" if probability >= 0.25
    "watch": 0.18,   # "Watch" if 0.18 <= probability < 0.25
                     # "Skip" if probability < 0.18
}

# ==========================================
# 9. Walk-Forward Backtesting Configuration
# ==========================================
WF_INITIAL_TRAIN_DAYS = 750   # ~3 years of trading days
WF_STEP_DAYS = 63             # ~1 quarter (3 months)
WF_RETRAIN = True             # Retrain model at every walk-forward step

# Portfolio-level backtest assumptions. Each selected position receives one fixed
# slot as a fraction of current equity; unused slots remain in cash.
BACKTEST_INITIAL_CAPITAL = 100_000.0  # INR
BACKTEST_MAX_POSITIONS = 10
BACKTEST_MIN_SESSIONS_FOR_PROMOTION = 60
BACKTEST_MIN_TRADES_FOR_PROMOTION = 100
BACKTEST_MAX_DRAWDOWN_FOR_PROMOTION = 0.08
BACKTEST_MIN_SESSIONS_FOR_PROMOTION = 60
BACKTEST_MIN_TRADES_FOR_PROMOTION = 100
BACKTEST_MAX_DRAWDOWN_FOR_PROMOTION = 0.08

# ==========================================
# 10. Preprocessing & Synthetic Data Provenance
# ==========================================
# DATA INTEGRITY NOTICE:
# - FII/DII Data: src/fii_dii.py uses synthetic historical institutional flows for macro trend features.
# - Sentiment Data: src/sentiment.py uses synthetic news scoring for historical backtesting.
# - Preprocessing Policy: Zero future information leakage. Imputation medians are fitted strictly on
#   the training window and applied to validation/test partitions.
# - Artifact Provenance: Existing binary model artifacts in models/ require retraining under this leak-free pipeline.
PREPROCESSING_VERSION = "2.0-temporal-isolated"
MODEL_PROVENANCE_STATUS = "VERIFIED_TEMPORAL_ISOLATED"
LAST_AUDIT_DATE = "2026-10-08"
