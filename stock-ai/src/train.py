"""
Model Training Module for Indian NSE Stock Market AI/ML System.
Trains LightGBM classifier with chronological train/validation sets, class imbalance handling,
early stopping, feature importance analysis, and metadata persistence.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier, early_stopping, log_evaluation
try:
    import xgboost as xgb
except ImportError:
    xgb = None

try:
    import catboost as cb
except ImportError:
    cb = None

from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features, ensemble

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def prepare_training_arrays(
    train_df: pd.DataFrame, val_df: pd.DataFrame, feature_cols: Optional[List[str]] = None
) -> Tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series, List[str]]:
    """
    Extracts feature matrix X and target vector y for train and validation splits.
    Strictly verifies no future leakage.
    """
    if feature_cols is None:
        feature_cols = features.extract_feature_column_names(train_df)

    # Leakage check assertion
    forbidden = {"next_high", "next_open", "next_low", "next_close", "target"}
    for f in feature_cols:
        if f in forbidden:
            raise ValueError(f"CRITICAL LEAKAGE DETECTED: {f} is present in feature_cols!")

    X_train = train_df[feature_cols].astype(np.float32)
    y_train = train_df["target"].astype(int)

    X_val = val_df[feature_cols].astype(np.float32)
    y_val = val_df["target"].astype(int)

    return X_train, y_train, X_val, y_val, feature_cols

def train_model(
    train_df: Optional[pd.DataFrame] = None,
    val_df: Optional[pd.DataFrame] = None,
    params: Optional[Dict] = None,
    save_artifacts: bool = True,
) -> Tuple[LGBMClassifier, Dict, List[str]]:
    """
    Trains a LightGBM classifier with early stopping and imbalance handling.
    """
    if train_df is None or val_df is None:
        combined = dataset.load_combined_dataset()
        train_df, val_df, _ = dataset.get_chronological_splits(combined)

    if params is None:
        # Auto-load Optuna best params if available (Phase 2)
        if config.BEST_PARAMS_FILE.exists():
            with open(config.BEST_PARAMS_FILE, "r") as f:
                params = json.load(f)
            logger.info(f"Loaded best hyperparameters from: {config.BEST_PARAMS_FILE}")
        else:
            params = config.LGBM_PARAMS.copy()
            logger.info("Using default LGBM_PARAMS from config.py (run src/tune.py for optimized params)")

    X_train, y_train, X_val, y_val, feature_cols = prepare_training_arrays(train_df, val_df)

    # Class imbalance handling
    pos_count = (y_train == 1).sum()
    neg_count = (y_train == 0).sum()
    scale_pos_weight = neg_count / max(pos_count, 1)

    logger.info(
        f"Training set: {len(X_train)} rows | Pos: {pos_count} ({pos_count/len(X_train)*100:.2f}%) | "
        f"Neg: {neg_count} | scale_pos_weight: {scale_pos_weight:.2f}"
    )
    logger.info(
        f"Validation set: {len(X_val)} rows | Pos: {(y_val==1).sum()} ({(y_val==1).sum()/len(X_val)*100:.2f}%)"
    )

    # Setup classifier
    model_params = params.copy()
    if getattr(config, "IMBALANCE_METHOD", "balanced") == "scale_pos_weight":
        model_params.pop("class_weight", None)
        model_params["scale_pos_weight"] = scale_pos_weight
    elif getattr(config, "IMBALANCE_METHOD", "balanced") == "balanced":
        model_params.pop("scale_pos_weight", None)
        model_params["class_weight"] = "balanced"

    print("\n" + "=" * 70)
    print("STEP 7: TRAINING ENSEMBLE CLASSIFIER (LGBM + XGB + CatBoost)")
    print("=" * 70)

    # 1. Train LightGBM
    logger.info("Fitting LightGBM model...")
    lgb_model = LGBMClassifier(**model_params)
    lgb_model.fit(
        X_train, y_train,
        eval_set=[(X_train, y_train), (X_val, y_val)],
        eval_names=["train", "val"],
        callbacks=[early_stopping(stopping_rounds=40, verbose=False), log_evaluation(period=0)]
    )

    # 2. Train XGBoost
    if xgb is not None:
        logger.info("Fitting XGBoost model...")
        xgb_params = {
            'n_estimators': model_params.get('n_estimators', 500),
            'learning_rate': model_params.get('learning_rate', 0.03),
            'max_depth': model_params.get('max_depth', 6),
            'subsample': model_params.get('subsample', 0.8),
            'colsample_bytree': model_params.get('colsample_bytree', 0.8),
            'random_state': 42,
            'n_jobs': -1,
            'eval_metric': 'logloss'
        }
        if config.IMBALANCE_METHOD == "scale_pos_weight":
            xgb_params['scale_pos_weight'] = scale_pos_weight
            
        xgb_model = xgb.XGBClassifier(**xgb_params, early_stopping_rounds=40)
        xgb_model.fit(
            X_train, y_train,
            eval_set=[(X_train, y_train), (X_val, y_val)],
            verbose=False
        )
    else:
        logger.info("XGBoost not available; using LightGBM as fallback estimator...")
        xgb_model = lgb_model

    # 3. Train CatBoost
    if cb is not None:
        logger.info("Fitting CatBoost model...")
        cb_params = {
            'iterations': model_params.get('n_estimators', 500),
            'learning_rate': model_params.get('learning_rate', 0.03),
            'depth': min(model_params.get('max_depth', 6), 8), # CatBoost max_depth max is 16, but 8 is safe and fast
            'random_seed': 42,
            'thread_count': -1,
            'verbose': False,
            'allow_writing_files': False,
        }
        if config.IMBALANCE_METHOD == "scale_pos_weight":
            cb_params['scale_pos_weight'] = scale_pos_weight
            
        cb_model = cb.CatBoostClassifier(**cb_params, early_stopping_rounds=40)
        cb_model.fit(
            X_train, y_train,
            eval_set=(X_val, y_val),
            verbose=False
        )
    else:
        logger.info("CatBoost not available; using LightGBM as fallback estimator...")
        cb_model = lgb_model

    # Calculate individual validation performance to determine ensemble weights
    lgb_val_probs = lgb_model.predict_proba(X_val)[:, 1]
    xgb_val_probs = xgb_model.predict_proba(X_val)[:, 1]
    cb_val_probs = cb_model.predict_proba(X_val)[:, 1]

    lgb_auc = max(0.50, float(roc_auc_score(y_val, lgb_val_probs)))
    xgb_auc = max(0.50, float(roc_auc_score(y_val, xgb_val_probs)))
    cb_auc = max(0.50, float(roc_auc_score(y_val, cb_val_probs)))

    # Quadratic weight allocation above 0.50 baseline
    w_lgb = max(0.05, (lgb_auc - 0.45) ** 2)
    w_xgb = max(0.05, (xgb_auc - 0.45) ** 2)
    w_cb = max(0.05, (cb_auc - 0.45) ** 2)
    ensemble_weights = (w_lgb, w_xgb, w_cb)
    logger.info(f"Dynamic Ensemble Weights: LGB={w_lgb:.3f} (AUC {lgb_auc:.4f}), XGB={w_xgb:.3f} (AUC {xgb_auc:.4f}), CB={w_cb:.3f} (AUC {cb_auc:.4f})")

    # Combine models with uncertainty-aware weighted voting
    model = ensemble.EnsembleModel(lgb_model, xgb_model, cb_model, weights=ensemble_weights)

    best_iteration = getattr(lgb_model, "best_iteration_", model_params.get('n_estimators', 500))
    xgb_iter = getattr(xgb_model, "best_iteration", "N/A")
    cb_iter = getattr(cb_model, "best_iteration_", "N/A")
    logger.info(f"Training completed. LightGBM Best Iter: {best_iteration}, XGBoost Iter: {xgb_iter}, CatBoost Iter: {cb_iter}")

    # Evaluate validation predictions
    val_probs = model.predict_proba(X_val)[:, 1]
    val_preds = (val_probs >= 0.50).astype(int)

    val_metrics = {
        "val_roc_auc": float(roc_auc_score(y_val, val_probs)),
        "val_pr_auc": float(average_precision_score(y_val, val_probs)),
        "val_accuracy": float(accuracy_score(y_val, val_preds)),
        "val_precision_at_0_5": float(precision_score(y_val, val_preds, zero_division=0)),
        "val_recall_at_0_5": float(recall_score(y_val, val_preds, zero_division=0)),
        "val_f1_at_0_5": float(f1_score(y_val, val_preds, zero_division=0)),
        "best_iteration": int(best_iteration),
        "train_rows": int(len(X_train)),
        "val_rows": int(len(X_val)),
        "train_pos_rate": float(pos_count / len(X_train)),
        "val_pos_rate": float((y_val == 1).sum() / len(X_val)),
    }

    print("\n" + "=" * 70)
    print("VALIDATION PERFORMANCE SUMMARY")
    print("=" * 70)
    print(f"ROC-AUC Score        : {val_metrics['val_roc_auc']:.4f}")
    print(f"PR-AUC (Avg Precision): {val_metrics['val_pr_auc']:.4f} (Baseline: {val_metrics['val_pos_rate']:.4f})")
    print(f"Precision @ 0.50     : {val_metrics['val_precision_at_0_5']:.4f}")
    print(f"Recall @ 0.50        : {val_metrics['val_recall_at_0_5']:.4f}")
    print(f"F1 Score @ 0.50      : {val_metrics['val_f1_at_0_5']:.4f}")
    print("=" * 70)

    # Feature Importance
    importance_gain = model.booster_.feature_importance(importance_type="gain")
    importance_split = model.booster_.feature_importance(importance_type="split")

    importance_df = pd.DataFrame({
        "feature": feature_cols,
        "importance_gain": importance_gain,
        "importance_split": importance_split,
    }).sort_values("importance_gain", ascending=False).reset_index(drop=True)

    print("\nTOP 20 MOST INFLUENTIAL FEATURES (BY GAIN):")
    print("-" * 65)
    for i, row in importance_df.head(20).iterrows():
        print(f"{i+1:2d}. {row['feature']:<25} | Gain: {row['importance_gain']:10.1f} | Splits: {row['importance_split']:5d}")
    print("-" * 65)

    # Metadata assembly
    metadata = {
        "model_type": "Heterogeneous Ensemble (LGBM+XGB+CatBoost)",
        "features": feature_cols,
        "num_features": len(feature_cols),
        "params": model_params,
        "train_start": config.TRAIN_START,
        "train_end": config.TRAIN_END,
        "val_start": config.VAL_START,
        "val_end": config.VAL_END,
        "target_definition": f"Executable Open +2% Target ({getattr(config, 'TARGET_MODE', 'executable_open')}): Next Day High >= Open * (1 + {config.TARGET_PCT}) before Low <= Open * (1 - {getattr(config, 'STOP_LOSS_PCT', 0.02)})",
        "target_version": getattr(config, "TARGET_VERSION", "2.0-executable"),
        "metrics": val_metrics,
        "top_features": importance_df.head(20).to_dict(orient="records"),
    }

    if save_artifacts:
        config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, config.MODEL_FILE)
        logger.info(f"Saved trained model to: {config.MODEL_FILE}")

        with open(config.METADATA_FILE, "w") as f:
            json.dump(metadata, f, indent=4)
        logger.info(f"Saved model metadata to: {config.METADATA_FILE}")

        # Save feature importance CSV for reference
        importance_df.to_csv(config.MODELS_DIR / "feature_importance.csv", index=False)

        # Auto-run calibration if flag is enabled
        if config.USE_CALIBRATED_MODEL:
            try:
                logger.info("USE_CALIBRATED_MODEL=True — running isotonic calibration post-training...")
                from src.calibrate import run_calibration
                run_calibration(method="isotonic")
            except Exception as calib_err:
                logger.warning(f"Calibration step failed (non-fatal): {calib_err}")

    return model, metadata, feature_cols


if __name__ == "__main__":
    train_model()
