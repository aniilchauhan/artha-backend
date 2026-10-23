"""
Swing Probability Calibration Module.
Calibrates raw LightGBM probability scores using Isotonic Regression and Platt Scaling
fitted on chronological held-out validation predictions (separate from training).
Computes Expected Calibration Error (ECE) and reliability metrics across score bins.
Per docs/SWING_TARGET_SPECIFICATION.md.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple
import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss

import sys
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src.swing_dataset import SWING_DATASET_PARQUET, purged_train_test_split
from src.swing_features import SWING_FEATURE_COLUMNS
from src.swing_train import (
    SWING_MODEL_FILE,
    prepare_swing_feature_matrix,
)

logger = logging.getLogger(__name__)

SWING_CALIBRATED_MODEL_FILE = config.MODELS_DIR / "swing_model_calibrated.pkl"
SWING_CALIBRATION_JSON = config.OUTPUTS_DIR / "swing_calibration_report.json"


def compute_expected_calibration_error(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    n_bins: int = 10,
) -> Tuple[float, List[Dict]]:
    """Computes Expected Calibration Error (ECE) and reliability table."""
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    bin_assignments = np.digitize(y_prob, bin_edges) - 1

    total_samples = len(y_true)
    ece = 0.0
    reliability_table = []

    for i in range(n_bins):
        mask = bin_assignments == i
        count = int(np.sum(mask))
        if count == 0:
            reliability_table.append({
                "bin_range": f"{bin_edges[i]:.1f}-{bin_edges[i+1]:.1f}",
                "count": 0,
                "mean_predicted": round(float((bin_edges[i] + bin_edges[i+1]) / 2), 3),
                "empirical_success_rate": None,
                "calibration_gap": 0.0,
            })
            continue

        bin_acc = float(np.mean(y_true[mask]))
        bin_conf = float(np.mean(y_prob[mask]))
        gap = abs(bin_acc - bin_conf)
        ece += (count / total_samples) * gap

        reliability_table.append({
            "bin_range": f"{bin_edges[i]:.1f}-{bin_edges[i+1]:.1f}",
            "count": count,
            "mean_predicted": round(bin_conf, 3),
            "empirical_success_rate": round(bin_acc, 3),
            "calibration_gap": round(gap, 3),
        })

    return round(float(ece), 4), reliability_table


def fit_swing_calibrator(
    clf=None,
    feature_matrix: Optional[pd.DataFrame] = None,
    save_artifacts: bool = True,
) -> Tuple[IsotonicRegression, Dict]:
    """Fits an isotonic regression calibrator on held-out validation predictions."""
    if clf is None:
        if not SWING_MODEL_FILE.exists():
            raise FileNotFoundError(f"Model file {SWING_MODEL_FILE} does not exist.")
        clf = joblib.load(SWING_MODEL_FILE)

    if feature_matrix is None:
        outcomes_df = pd.read_parquet(SWING_DATASET_PARQUET)
        feature_matrix = prepare_swing_feature_matrix(outcomes_df)

    # Use purged validation split strictly for calibration
    _, val_df, test_df = purged_train_test_split(feature_matrix)

    X_val = val_df[SWING_FEATURE_COLUMNS]
    y_val = val_df["label_10pct"].values

    X_test = test_df[SWING_FEATURE_COLUMNS]
    y_test = test_df["label_10pct"].values

    raw_val_probs = clf.predict_proba(X_val)[:, 1]
    raw_val_brier = float(brier_score_loss(y_val, raw_val_probs))
    raw_val_ece, _ = compute_expected_calibration_error(y_val, raw_val_probs)

    # Fit Isotonic Regression
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(raw_val_probs, y_val)

    # Calibrate validation predictions
    cal_val_probs = iso.predict(raw_val_probs)
    cal_val_brier = float(brier_score_loss(y_val, cal_val_probs))
    cal_val_ece, val_reliability = compute_expected_calibration_error(y_val, cal_val_probs)

    # Out-of-sample Test Evaluation
    raw_test_probs = clf.predict_proba(X_test)[:, 1]
    cal_test_probs = iso.predict(raw_test_probs)
    test_brier = float(brier_score_loss(y_test, cal_test_probs))
    test_ece, test_reliability = compute_expected_calibration_error(y_test, cal_test_probs)

    report = {
        "calibration_method": "IsotonicRegression",
        "validation_metrics": {
            "raw_brier_score": round(raw_val_brier, 4),
            "calibrated_brier_score": round(cal_val_brier, 4),
            "raw_ece": round(raw_val_ece, 4),
            "calibrated_ece": round(cal_val_ece, 4),
        },
        "held_out_test_metrics": {
            "calibrated_brier_score": round(test_brier, 4),
            "calibrated_ece": round(test_ece, 4),
            "test_samples": len(y_test),
        },
        "reliability_diagram_test": test_reliability,
    }

    if save_artifacts:
        config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
        config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(iso, SWING_CALIBRATED_MODEL_FILE)
        with open(SWING_CALIBRATION_JSON, "w") as f:
            json.dump(report, f, indent=2)
        logger.info(f"Saved calibrator to {SWING_CALIBRATED_MODEL_FILE} and report to {SWING_CALIBRATION_JSON}")

    return iso, report


if __name__ == "__main__":
    iso, report = fit_swing_calibrator()
    print("\n--- Calibration Completed ---")
    print(f"Validation ECE: {report['validation_metrics']['raw_ece']} -> {report['validation_metrics']['calibrated_ece']}")
    print(f"Test Set ECE: {report['held_out_test_metrics']['calibrated_ece']}")
    print("\nReliability Table (Test Set):")
    for b in report["reliability_diagram_test"]:
        print(f"  Bin {b['bin_range']}: Count={b['count']}, MeanPred={b['mean_predicted']}, ActualRate={b['empirical_success_rate']}")
