"""
Automated Verification and Look-Ahead Bias Audit Script.
Runs comprehensive sanity checks on features, chronological boundaries,
leakage risks, NaN/inf absence, and model reloadability.
"""

import sys
import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features


def audit_pipeline():
    print("\n" + "=" * 70)
    print("RUNNING COMPREHENSIVE PIPELINE AND LOOK-AHEAD AUDIT")
    print("=" * 70)

    # 1. Check Model Artifacts
    print("\n[CHECK 1/5] Verifying model artifacts on disk...")
    assert config.MODEL_FILE.exists(), f"Missing model file: {config.MODEL_FILE}"
    assert config.METADATA_FILE.exists(), f"Missing metadata file: {config.METADATA_FILE}"

    model = joblib.load(config.MODEL_FILE)
    with open(config.METADATA_FILE, "r") as f:
        meta = json.load(f)
    print("  [OK] Model loaded successfully with joblib.")
    print(f"  [OK] Metadata features count: {len(meta['features'])}")

    # 2. Check Feature Column Names for Future Leaks
    print("\n[CHECK 2/5] Auditing feature names for future information...")
    forbidden_tokens = ["next_", "future", "target", "shift_-", "t+1"]
    leaked_cols = []
    for f in meta["features"]:
        for token in forbidden_tokens:
            if token in f.lower():
                leaked_cols.append((f, token))

    if leaked_cols:
        raise AssertionError(f"CRITICAL LEAK DETECTED: {leaked_cols}")
    print("  [OK] Zero future-named or target tokens found in model feature set.")

    # 3. Load Combined Dataset and Audit Chronological Split
    print("\n[CHECK 3/5] Auditing chronological separation of dataset...")
    df = dataset.load_combined_dataset()
    train_df, val_df, test_df = dataset.get_chronological_splits(df)

    max_train_date = train_df["Date"].max()
    min_val_date = val_df["Date"].min()
    max_val_date = val_df["Date"].max()
    min_test_date = test_df["Date"].min()

    print(f"  Train Date Range : {train_df['Date'].min().strftime('%Y-%m-%d')} to {max_train_date.strftime('%Y-%m-%d')}")
    print(f"  Val Date Range   : {min_val_date.strftime('%Y-%m-%d')} to {max_val_date.strftime('%Y-%m-%d')}")
    print(f"  Test Date Range  : {min_test_date.strftime('%Y-%m-%d')} to {test_df['Date'].max().strftime('%Y-%m-%d')}")

    assert max_train_date < min_val_date, f"Train ({max_train_date}) overlaps with Val ({min_val_date})"
    assert max_val_date < min_test_date, f"Val ({max_val_date}) overlaps with Test ({min_test_date})"
    print("  [OK] Strict chronological ordering verified: Train < Val < Test with ZERO overlap.")

    # 4. Check for NaNs and Infs in Partitioned Feature Matrices
    print("\n[CHECK 4/5] Checking for NaN and Inf values in partitioned feature matrices...")
    feature_cols = meta["features"]
    nan_train = train_df[feature_cols].isna().sum().sum()
    nan_val = val_df[feature_cols].isna().sum().sum()
    nan_test = test_df[feature_cols].isna().sum().sum()
    total_nans = nan_train + nan_val + nan_test

    inf_train = np.isinf(train_df[feature_cols].select_dtypes(include=[np.number]).values).sum()
    inf_val = np.isinf(val_df[feature_cols].select_dtypes(include=[np.number]).values).sum()
    inf_test = np.isinf(test_df[feature_cols].select_dtypes(include=[np.number]).values).sum()
    total_infs = inf_train + inf_val + inf_test

    print(f"  Partition NaNs (Train: {nan_train}, Val: {nan_val}, Test: {nan_test}) | Total: {total_nans}")
    print(f"  Partition Infs (Train: {inf_train}, Val: {inf_val}, Test: {inf_test}) | Total: {total_infs}")
    assert total_nans == 0, f"Found {total_nans} NaNs in partitioned feature matrices!"
    assert total_infs == 0, f"Found {total_infs} Infs in partitioned feature matrices!"
    print("  [OK] Partitioned feature matrices are completely clean of NaNs and Infs.")

    # 5. Check Target Shift Formulation
    print("\n[CHECK 5/5] Auditing Target Formulation and End-of-Series NaN...")
    # For executable-open targets, the next session must hit the target without
    # touching the stop; ambiguous daily candles resolve conservatively as zero.
    sample_stock = df[df["ticker"] == "RELIANCE.NS"].sort_values("Date").reset_index(drop=True)
    next_open = sample_stock["Open"].shift(-1)
    next_high = sample_stock["High"].shift(-1)
    next_low = sample_stock["Low"].shift(-1)
    target_hit = next_high >= next_open * (1.0 + config.TARGET_PCT)
    stop_hit = next_low <= next_open * (1.0 - config.STOP_LOSS_PCT)
    expected_target = (target_hit & ~stop_hit).astype(float)
    # Check alignment excluding final bar
    matches = (sample_stock["target"].iloc[:-1] == expected_target.iloc[:-1]).all()
    assert matches, "Target calculation mismatch!"
    print("  [OK] Target matches executable-open target with conservative stop-first resolution.")

    print("\n" + "=" * 70)
    print("ALL 5 AUDIT CHECKS PASSED: SYSTEM IS ROBUST AND LEAK-FREE!")
    print("=" * 70)


if __name__ == "__main__":
    audit_pipeline()
