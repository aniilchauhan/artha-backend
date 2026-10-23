"""
Dataset Construction and Chronological Splitting Module.
Combines all individual stock datasets into a unified, chronologically sorted dataset.
Provides strict chronological train, validation, and test splits without look-ahead bias.
"""

import sys
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import features, fii_dii, sentiment
from src.download_data import get_universe_tickers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def process_single_stock(
    ticker: str,
    benchmarks: Dict[str, pd.DataFrame],
    burn_in_bars: int = 50,
) -> Optional[pd.DataFrame]:
    """Processes features for an individual stock safely."""
    safe_filename = ticker.replace("^", "").replace(".", "_") + ".csv"
    raw_file = config.RAW_DIR / safe_filename

    if not raw_file.exists():
        return None

    try:
        raw_df = pd.read_csv(raw_file)
        if len(raw_df) < (burn_in_bars + 10):
            return None

        stock_features_df = features.build_stock_pipeline(
            ticker=ticker,
            raw_df=raw_df,
            benchmarks=benchmarks,
            is_training=True,
        )

        # Drop burn-in rows at the beginning of each stock
        if len(stock_features_df) > burn_in_bars:
            stock_features_df = stock_features_df.iloc[burn_in_bars:].reset_index(drop=True)

        return stock_features_df
    except Exception as e:
        logger.debug(f"Error computing features for {ticker}: {e}")
        return None


def build_combined_dataset(
    tickers: Optional[List[str]] = None,
    universe: str = getattr(config, "DEFAULT_UNIVERSE", "nifty500"),
    save_parquet: bool = True,
    save_csv: bool = False,
    burn_in_bars: int = 50,
    n_jobs: int = -1,
) -> pd.DataFrame:
    """
    Processes each stock in parallel, merges market benchmarks, computes features,
    and stitches them into a unified, chronologically sorted dataset.
    """
    if tickers is None:
        tickers = get_universe_tickers(universe)

    if config.USE_SYNTHETIC_FEATURES:
        fii_dii.generate_synthetic_fii_dii(force_regenerate=False)
        sentiment.generate_historical_sentiment(force_regenerate=False)

    benchmarks = features.load_market_benchmarks()
    logger.info(f"Loaded {len(benchmarks)} market benchmarks: {list(benchmarks.keys())}")
    logger.info(f"Extracting features across {len(tickers)} stocks using parallel execution (n_jobs={n_jobs})...")

    results = joblib.Parallel(n_jobs=n_jobs, prefer="threads", batch_size=10)(
        joblib.delayed(process_single_stock)(ticker, benchmarks, burn_in_bars)
        for ticker in tickers
    )

    dfs = [r for r in results if r is not None and not r.empty]

    if not dfs:
        raise ValueError("No stock data was successfully processed into the combined dataset.")

    logger.info(f"Concatenating {len(dfs)} processed stock datasets...")
    combined = pd.concat(dfs, axis=0, ignore_index=True)

    # Convert Date to datetime and sort strictly chronologically
    combined["Date"] = pd.to_datetime(combined["Date"])
    combined = combined.sort_values(by=["Date", "ticker"]).reset_index(drop=True)

    # Note: Full-dataset median imputation removed to prevent future data leakage.
    # Feature NaNs are preserved here and imputed strictly using training-fold statistics during splitting.
    feature_cols = features.extract_feature_column_names(combined)

    logger.info(
        f"Combined dataset built successfully: {len(combined)} rows, {len(feature_cols)} features across {len(dfs)} stocks (zero full-dataset imputation)."
    )

    if save_parquet:
        config.COMBINED_DATASET_PARQUET.parent.mkdir(parents=True, exist_ok=True)
        combined.to_parquet(config.COMBINED_DATASET_PARQUET, index=False)
        logger.info(f"Saved combined dataset to: {config.COMBINED_DATASET_PARQUET}")

    if save_csv:
        config.COMBINED_DATASET_CSV.parent.mkdir(parents=True, exist_ok=True)
        combined.to_csv(config.COMBINED_DATASET_CSV, index=False)
        logger.info(f"Saved combined dataset CSV to: {config.COMBINED_DATASET_CSV}")

    return combined


def load_combined_dataset() -> pd.DataFrame:
    """Loads existing combined dataset or builds it if not found."""
    if config.COMBINED_DATASET_PARQUET.exists():
        df = pd.read_parquet(config.COMBINED_DATASET_PARQUET)
    elif config.COMBINED_DATASET_CSV.exists():
        df = pd.read_csv(config.COMBINED_DATASET_CSV)
    else:
        logger.info("Combined dataset not found on disk. Building from raw data...")
        df = build_combined_dataset()

    df["Date"] = pd.to_datetime(df["Date"])

    if not config.USE_SYNTHETIC_FEATURES:
        from src.clean_contract import assert_no_synthetic
        assert_no_synthetic(df.columns)

    # Align target dynamically with configured TARGET_MODE (docs/TARGET_SPECIFICATION.md)
    target_mode = getattr(config, "TARGET_MODE", "executable_open")
    if target_mode == "executable_open" and not {"next_open", "next_high", "next_low"}.issubset(df.columns):
        raise ValueError("Cached dataset lacks executable target inputs. Rebuild it from raw data.")
    if target_mode == "executable_open" and "next_open" in df.columns and "next_high" in df.columns and "next_low" in df.columns:
        target_pct = getattr(config, "TARGET_PCT", 0.02)
        stop_pct = getattr(config, "STOP_LOSS_PCT", 0.02)
        clean_hit = (df["next_high"] >= df["next_open"] * (1.0 + target_pct)) & (df["next_low"] > df["next_open"] * (1.0 - stop_pct))
        df["target"] = clean_hit.astype(float)
        # Final row per ticker has no future bar
        last_indices = df.groupby("ticker").tail(1).index
        df.loc[last_indices, "target"] = np.nan

    return df


def compute_train_imputation_values(
    train_df: pd.DataFrame, feature_cols: Optional[List[str]] = None
) -> Dict[str, float]:
    """
    Computes median feature values strictly from the training split.
    Prevents any look-ahead leakage from validation or testing observations.
    """
    if feature_cols is None:
        feature_cols = features.extract_feature_column_names(train_df)

    impute_dict: Dict[str, float] = {}
    for col in feature_cols:
        if col in train_df.columns:
            val = train_df[col].median()
            impute_dict[col] = float(0.0 if pd.isna(val) else val)
    return impute_dict


def apply_imputation(
    df: pd.DataFrame,
    impute_dict: Dict[str, float],
    feature_cols: Optional[List[str]] = None,
) -> pd.DataFrame:
    """
    Applies training-fitted imputation medians to target DataFrame partitions.
    """
    df = df.copy()
    if feature_cols is None:
        feature_cols = [c for c in impute_dict.keys() if c in df.columns]

    for col in feature_cols:
        if col in impute_dict and col in df.columns:
            if df[col].isna().any():
                df[col] = df[col].fillna(impute_dict[col])
    return df


def get_chronological_splits(
    df: Optional[pd.DataFrame] = None,
    train_start: str = config.TRAIN_START,
    train_end: str = config.TRAIN_END,
    val_start: str = config.VAL_START,
    val_end: str = config.VAL_END,
    test_start: str = config.TEST_START,
    test_end: str = config.TEST_END,
    drop_unlabeled: bool = True,
    apply_train_imputation: bool = True,
    drop_boundary_leaks: bool = True,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Splits the combined dataset chronologically into Train, Validation, and Test sets.
    Applies training-fitted preprocessing strictly within the training window.
    Never uses random train_test_split.
    """
    if df is None:
        df = load_combined_dataset()

    # If drop_unlabeled, drop rows where target is NaN (e.g. final bar where future is unknown)
    if drop_unlabeled:
        df = df.dropna(subset=["target"]).copy()

    # Chronological masks
    train_mask = (df["Date"] >= train_start) & (df["Date"] <= train_end)
    val_mask = (df["Date"] >= val_start) & (df["Date"] <= val_end)
    test_mask = (df["Date"] >= test_start) & (df["Date"] <= test_end)

    train_df = df[train_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    val_df = df[val_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    test_df = df[test_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)

    # Prevent target look-ahead leakage across boundary partitions
    if drop_boundary_leaks and not val_df.empty and not train_df.empty:
        min_val_date = val_df["Date"].min()
        train_df = train_df[train_df["Date"] < min_val_date].reset_index(drop=True)
        # Drop the final trading day of training whose shift(-1) target reaches into val_start prices
        max_train_date = train_df["Date"].max()
        train_df = train_df[train_df["Date"] < max_train_date].reset_index(drop=True)

    if drop_boundary_leaks and not test_df.empty and not val_df.empty:
        min_test_date = test_df["Date"].min()
        val_df = val_df[val_df["Date"] < min_test_date].reset_index(drop=True)
        # Drop the final trading day of validation whose shift(-1) target reaches into test_start prices
        max_val_date = val_df["Date"].max()
        val_df = val_df[val_df["Date"] < max_val_date].reset_index(drop=True)

    # Apply training-fitted imputation
    if apply_train_imputation and not train_df.empty:
        feature_cols = features.extract_feature_column_names(train_df)
        impute_dict = compute_train_imputation_values(train_df, feature_cols)
        train_df = apply_imputation(train_df, impute_dict, feature_cols)
        if not val_df.empty:
            val_df = apply_imputation(val_df, impute_dict, feature_cols)
        if not test_df.empty:
            test_df = apply_imputation(test_df, impute_dict, feature_cols)

        # Persist learned imputation medians for inference parity
        impute_file = config.MODELS_DIR / "imputation_values.json"
        try:
            with open(impute_file, "w") as f:
                import json
                json.dump(impute_dict, f, indent=2)
        except Exception as e:
            logger.debug(f"Could not persist imputation values: {e}")

    print("\n" + "=" * 75)
    print("CHRONOLOGICAL DATASET SPLIT SUMMARY (TEMPORALLY ISOLATED)")
    print("=" * 75)

    splits = [
        ("TRAIN", train_df, train_start, train_end),
        ("VAL", val_df, val_start, val_end),
        ("TEST", test_df, test_start, test_end),
    ]

    for name, s_df, start, end in splits:
        total_rows = len(s_df)
        if total_rows > 0:
            pos_count = int(s_df["target"].sum())
            pos_pct = (pos_count / total_rows) * 100.0
            neg_count = total_rows - pos_count
            imbalance_ratio = neg_count / max(pos_count, 1)
            first_d = s_df["Date"].min().strftime("%Y-%m-%d")
            last_d = s_df["Date"].max().strftime("%Y-%m-%d")
            print(
                f"{name:<5} | Span: {first_d} -> {last_d} | Rows: {total_rows:<7} | "
                f"Pos (+2% Target): {pos_count:<6} ({pos_pct:5.2f}%) | "
                f"Class Imbalance: {imbalance_ratio:.2f}:1"
            )
        else:
            print(f"{name:<5} | Target span: {start} -> {end} | Rows: 0 (EMPTY)")

    print("=" * 75)

    return train_df, val_df, test_df


def get_four_period_splits(
    df: Optional[pd.DataFrame] = None,
    train_start: str = config.TRAIN_START,
    train_end: str = config.TRAIN_END,
    tuning_start: str = config.TUNING_START,
    tuning_end: str = config.TUNING_END,
    calibration_start: str = config.CALIBRATION_START,
    calibration_end: str = config.CALIBRATION_END,
    untouched_test_start: str = config.UNTOUCHED_TEST_START,
    untouched_test_end: str = config.UNTOUCHED_TEST_END,
    drop_unlabeled: bool = True,
    apply_train_imputation: bool = True,
    drop_boundary_leaks: bool = True,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Splits the combined dataset chronologically into 4 strict partitions (M5-05):
    1. Training: Core feature learning and base tree structure.
    2. Tuning / Early Stopping: Hyperparameter evaluation and iteration caps.
    3. Calibration: Probability calibration (Isotonic/Platt), disjoint from tuning.
    4. Untouched Test: Virgin prospective holdout evaluation.
    """
    if df is None:
        df = load_combined_dataset()

    if drop_unlabeled:
        df = df.dropna(subset=["target"]).copy()

    train_mask = (df["Date"] >= train_start) & (df["Date"] <= train_end)
    tuning_mask = (df["Date"] >= tuning_start) & (df["Date"] <= tuning_end)
    cal_mask = (df["Date"] >= calibration_start) & (df["Date"] <= calibration_end)
    test_mask = (df["Date"] >= untouched_test_start) & (df["Date"] <= untouched_test_end)

    train_df = df[train_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    tuning_df = df[tuning_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    cal_df = df[cal_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)
    test_df = df[test_mask].sort_values(by=["Date", "ticker"]).reset_index(drop=True)

    # Drop boundary leaks between consecutive chronological partitions
    if drop_boundary_leaks:
        partitions = [train_df, tuning_df, cal_df, test_df]
        for i in range(len(partitions) - 1):
            curr_p = partitions[i]
            next_p = partitions[i + 1]
            if not curr_p.empty and not next_p.empty:
                min_next_date = next_p["Date"].min()
                curr_p = curr_p[curr_p["Date"] < min_next_date].reset_index(drop=True)
                max_curr_date = curr_p["Date"].max()
                curr_p = curr_p[curr_p["Date"] < max_curr_date].reset_index(drop=True)
                partitions[i] = curr_p
        train_df, tuning_df, cal_df, test_df = partitions

    # Apply training-fitted imputation
    if apply_train_imputation and not train_df.empty:
        feature_cols = features.extract_feature_column_names(train_df)
        impute_dict = compute_train_imputation_values(train_df, feature_cols)
        train_df = apply_imputation(train_df, impute_dict, feature_cols)
        if not tuning_df.empty:
            tuning_df = apply_imputation(tuning_df, impute_dict, feature_cols)
        if not cal_df.empty:
            cal_df = apply_imputation(cal_df, impute_dict, feature_cols)
        if not test_df.empty:
            test_df = apply_imputation(test_df, impute_dict, feature_cols)

    return train_df, tuning_df, cal_df, test_df


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Build features and chronological splits.")
    parser.add_argument(
        "--universe",
        type=str,
        default=getattr(config, "DEFAULT_UNIVERSE", "nifty500"),
        choices=["nifty500", "nifty100", "core50", "all"],
        help="Universe for dataset construction",
    )
    parser.add_argument("--burn-in", type=int, default=50, help="Burn-in warmup candles to drop")
    parser.add_argument("--save-csv", action="store_true", help="Also save raw CSV (warning: large)")
    args = parser.parse_args()

    print("\n" + "=" * 75)
    print(f"BUILDING COMBINED DATASET & CHRONOLOGICAL SPLITS (UNIVERSE: {args.universe.upper()})")
    print("=" * 75)
    combined_df = build_combined_dataset(
        universe=args.universe,
        save_parquet=True,
        save_csv=args.save_csv,
        burn_in_bars=args.burn_in,
    )
    train_df, val_df, test_df = get_chronological_splits(combined_df)
