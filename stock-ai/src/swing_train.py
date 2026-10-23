"""
Swing Prediction Model Training & Baselines Evaluation Module.
Implements:
1. Baseline 1: Historical empirical event frequency.
2. Baseline 2: Simple technical breakout rule.
3. Baseline 3: Ridge/Logistic classifier.
4. Candidate Model: LightGBM GBDT trained with purged chronological walk-forward splits.
Metadata and provenance tracking per docs/SWING_TARGET_SPECIFICATION.md.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Tuple
import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.swing_dataset import (
    SWING_DATASET_PARQUET,
    build_swing_outcome_dataset,
    purged_train_test_split,
)
from src.swing_features import (
    SWING_FEATURE_COLUMNS,
    compute_swing_features_for_stock,
)

logger = logging.getLogger(__name__)

SWING_MODEL_FILE = config.MODELS_DIR / "swing_lgbm_model.pkl"
SWING_METADATA_FILE = config.MODELS_DIR / "swing_model_metadata.json"


def prepare_swing_feature_matrix(
    outcomes_df: pd.DataFrame,
    raw_dir: Path = config.RAW_DIR,
) -> pd.DataFrame:
    """Merges swing setup records with point-in-time swing features computed at signal date."""
    market_nifty_file = config.MARKET_DIR / "NSEI.csv"
    market_vix_file = config.MARKET_DIR / "INDIAVIX.csv"

    nifty_df = pd.read_csv(market_nifty_file) if market_nifty_file.exists() else None
    vix_df = pd.read_csv(market_vix_file) if market_vix_file.exists() else None

    # Filter to triggered setups (exclude NO_ENTRY and large gaps)
    active_df = outcomes_df[~outcomes_df["outcome"].isin(["NO_ENTRY", "SKIPPED_GAP_TOO_LARGE"])].copy()
    if active_df.empty:
        return pd.DataFrame()

    feature_records = []
    # Group by symbol to compute features once per symbol
    for symbol, group in active_df.groupby("symbol"):
        safe_filename = symbol.replace("^", "").replace(".", "_") + ".csv"
        file_path = raw_dir / safe_filename
        if not file_path.exists():
            continue

        raw_stock = pd.read_csv(file_path)
        feat_stock = compute_swing_features_for_stock(raw_stock, nifty_df=nifty_df, vix_df=vix_df)
        feat_stock["Date"] = pd.to_datetime(feat_stock["Date"])

        # Merge on signal_date == Date
        group_merged = pd.merge(
            group,
            feat_stock[["Date"] + SWING_FEATURE_COLUMNS],
            left_on="signal_date",
            right_on="Date",
            how="inner",
        )
        if not group_merged.empty:
            feature_records.append(group_merged)

    if not feature_records:
        return pd.DataFrame()

    full_matrix = pd.concat(feature_records, ignore_index=True)
    full_matrix = full_matrix.sort_values("signal_date").reset_index(drop=True)
    return full_matrix


def evaluate_baselines(
    y_train: np.ndarray,
    y_val: np.ndarray,
    X_train: pd.DataFrame,
    X_val: pd.DataFrame,
) -> Dict:
    """Evaluates Baseline 1 (Frequency), Baseline 2 (Technical Rule), and Baseline 3 (Logistic)."""
    # Baseline 1: Empirical Frequency
    p_train = float(y_train.mean())
    y_pred_base1 = np.full_like(y_val, p_train, dtype=float)
    brier_base1 = brier_score_loss(y_val, y_pred_base1)

    # Baseline 2: Technical Rule (Volume Surge > 1.5 and BB Squeeze < 1.0)
    cond = (X_val["Vol_Surge_Ratio"] > 1.5) & (X_val["BB_Squeeze_Ratio"] < 1.0)
    y_pred_base2 = np.where(cond, 0.70, 0.30)
    brier_base2 = brier_score_loss(y_val, y_pred_base2)
    auc_base2 = roc_auc_score(y_val, y_pred_base2) if len(np.unique(y_val)) > 1 else 0.5

    # Baseline 3: Standardized Logistic Regression
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train.fillna(0))
    X_val_scaled = scaler.transform(X_val.fillna(0))
    lr = LogisticRegression(max_iter=1000, random_state=42)
    lr.fit(X_train_scaled, y_train)
    y_pred_base3 = lr.predict_proba(X_val_scaled)[:, 1]
    brier_base3 = brier_score_loss(y_val, y_pred_base3)
    auc_base3 = roc_auc_score(y_val, y_pred_base3) if len(np.unique(y_val)) > 1 else 0.5

    return {
        "Baseline_1_Empirical_Frequency": {
            "train_prior": round(p_train, 4),
            "val_brier_score": round(float(brier_base1), 4),
        },
        "Baseline_2_Technical_Rule": {
            "val_auc": round(float(auc_base2), 4),
            "val_brier_score": round(float(brier_base2), 4),
        },
        "Baseline_3_Logistic_Regression": {
            "val_auc": round(float(auc_base3), 4),
            "val_brier_score": round(float(brier_base3), 4),
        },
    }


def train_swing_model(
    feature_matrix: Optional[pd.DataFrame] = None,
    save_artifacts: bool = True,
) -> Tuple[lgb.LGBMClassifier, Dict]:
    """Trains the 20-session swing prediction LightGBM model with purged walk-forward splits."""
    if feature_matrix is None:
        if SWING_DATASET_PARQUET.exists():
            outcomes_df = pd.read_parquet(SWING_DATASET_PARQUET)
        else:
            outcomes_df = build_swing_outcome_dataset()
        feature_matrix = prepare_swing_feature_matrix(outcomes_df)

    if feature_matrix.empty:
        raise ValueError("Feature matrix is empty. Ensure raw data and swing dataset exist.")

    # Chronological purged splits
    train_df, val_df, test_df = purged_train_test_split(feature_matrix)

    X_train = train_df[SWING_FEATURE_COLUMNS]
    y_train = train_df["label_10pct"].values

    X_val = val_df[SWING_FEATURE_COLUMNS]
    y_val = val_df["label_10pct"].values

    X_test = test_df[SWING_FEATURE_COLUMNS]
    y_test = test_df["label_10pct"].values

    logger.info(f"Training dataset: N={len(X_train)} (Positive rate: {y_train.mean():.3f})")
    logger.info(f"Validation dataset: N={len(X_val)} (Positive rate: {y_val.mean():.3f})")
    logger.info(f"Test dataset: N={len(X_test)} (Positive rate: {y_test.mean():.3f})")

    # Evaluate Baselines
    baseline_metrics = evaluate_baselines(y_train, y_val, X_train, X_val)

    # Train LightGBM Candidate
    clf_lgb = lgb.LGBMClassifier(
        n_estimators=300,
        learning_rate=0.03,
        num_leaves=24,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        class_weight="balanced",
        verbose=-1,
    )
    clf_lgb.fit(X_train, y_train)

    # Train HistGradientBoosting Candidate
    clf_hgb = HistGradientBoostingClassifier(
        max_iter=250,
        learning_rate=0.03,
        max_leaf_nodes=24,
        max_depth=5,
        l2_regularization=0.1,
        class_weight="balanced",
        random_state=42,
    )
    clf_hgb.fit(X_train, y_train)

    # Heterogeneous Soft-Voting Ensemble
    ensemble = VotingClassifier(
        estimators=[("lgb", clf_lgb), ("hgb", clf_hgb)],
        voting="soft",
    )
    ensemble.fit(X_train, y_train)

    # Validation Predictions & Evaluation
    lgb_preds_prob = clf_lgb.predict_proba(X_val)[:, 1]
    hgb_preds_prob = clf_hgb.predict_proba(X_val)[:, 1]
    val_preds_prob = ensemble.predict_proba(X_val)[:, 1]

    val_auc_lgb = float(roc_auc_score(y_val, lgb_preds_prob)) if len(np.unique(y_val)) > 1 else 0.5
    val_auc_hgb = float(roc_auc_score(y_val, hgb_preds_prob)) if len(np.unique(y_val)) > 1 else 0.5
    val_auc = float(roc_auc_score(y_val, val_preds_prob)) if len(np.unique(y_val)) > 1 else 0.5

    val_brier_lgb = float(brier_score_loss(y_val, lgb_preds_prob))
    val_brier_hgb = float(brier_score_loss(y_val, hgb_preds_prob))
    val_brier = float(brier_score_loss(y_val, val_preds_prob))
    val_logloss = float(log_loss(y_val, val_preds_prob))

    # Feature Importances (from LightGBM estimator)
    importances = dict(zip(SWING_FEATURE_COLUMNS, [round(float(x), 2) for x in clf_lgb.feature_importances_]))
    sorted_importances = dict(sorted(importances.items(), key=lambda item: item[1], reverse=True))

    metadata = {
        "model_name": "Calibrated_Ensemble_LightGBM_HistGB_20d",
        "target_specification": "docs/SWING_TARGET_SPECIFICATION.md",
        "horizon_days": 20,
        "target_move_pct": 0.10,
        "samples_train": len(X_train),
        "samples_val": len(X_val),
        "samples_test": len(X_test),
        "train_positive_rate": round(float(y_train.mean()), 4),
        "val_positive_rate": round(float(y_val.mean()), 4),
        "validation_metrics": {
            "roc_auc": round(val_auc, 4),
            "brier_score": round(val_brier, 4),
            "log_loss": round(val_logloss, 4),
            "individual_models": {
                "lightgbm": {
                    "roc_auc": round(val_auc_lgb, 4),
                    "brier_score": round(val_brier_lgb, 4),
                },
                "hist_gradient_boosting": {
                    "roc_auc": round(val_auc_hgb, 4),
                    "brier_score": round(val_brier_hgb, 4),
                },
            },
        },
        "baseline_comparison": baseline_metrics,
        "feature_importances": sorted_importances,
    }

    if save_artifacts:
        config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(ensemble, SWING_MODEL_FILE)
        with open(SWING_METADATA_FILE, "w") as f:
            json.dump(metadata, f, indent=2)
        logger.info(f"Saved ensemble swing model to {SWING_MODEL_FILE} and metadata to {SWING_METADATA_FILE}")

    return ensemble, metadata


if __name__ == "__main__":
    clf, meta = train_swing_model()
    print("\n--- Swing Model Training Completed ---")
    print(f"Validation ROC-AUC: {meta['validation_metrics']['roc_auc']}")
    print(f"Validation Brier Score: {meta['validation_metrics']['brier_score']}")
    print("\nBaseline Comparison:")
    print(json.dumps(meta["baseline_comparison"], indent=2))
    print("\nTop 5 Predictive Features:")
    for k, v in list(meta["feature_importances"].items())[:5]:
        print(f"  {k}: {v}")
