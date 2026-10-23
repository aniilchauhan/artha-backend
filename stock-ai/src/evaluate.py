"""
Model Evaluation and Probability Calibration Module.
Evaluates the trained model on out-of-sample test data across multiple metrics,
runs a granular probability threshold sweep (0.50 to 0.80), and checks probability calibration.
"""

import sys
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset, features

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def load_model_and_metadata() -> Tuple[object, Dict]:
    """
    Loads trained model and its metadata from disk.
    When config.USE_CALIBRATED_MODEL is True, loads the isotonic-calibrated
    wrapper. Falls back to raw model if calibrated file is not yet available.
    """
    if not config.MODEL_FILE.exists():
        raise FileNotFoundError(f"Model file not found at {config.MODEL_FILE}. Please run src/train.py first.")
    if not config.METADATA_FILE.exists():
        raise FileNotFoundError(f"Metadata file not found at {config.METADATA_FILE}.")

    # Prefer calibrated model for evaluation when available
    if config.USE_CALIBRATED_MODEL and config.CALIBRATED_MODEL_FILE.exists():
        from src.calibrate import load_calibrated_model
        model = load_calibrated_model()
        logger.info("Loaded CALIBRATED model via load_calibrated_model()")
    else:
        model = joblib.load(config.MODEL_FILE)
        if config.USE_CALIBRATED_MODEL:
            logger.warning(
                "USE_CALIBRATED_MODEL=True but calibrated model not found. "
                "Run src/calibrate.py first. Falling back to raw model."
            )
        else:
            logger.info(f"Loaded raw LightGBM model from: {config.MODEL_FILE}")

    with open(config.METADATA_FILE, "r") as f:
        metadata = json.load(f)

    return model, metadata


def evaluate_threshold_sweep(
    y_true: np.ndarray, y_probs: np.ndarray, thresholds: List[float] = config.EVAL_THRESHOLDS
) -> pd.DataFrame:
    """
    Evaluates classification performance across user-specified probability thresholds.
    Shows signals generated, precision (empirical win rate), recall, F1, and accuracy.
    """
    total_samples = len(y_true)
    total_positives = int((y_true == 1).sum())
    results = []

    for thresh in thresholds:
        y_pred = (y_probs >= thresh).astype(int)
        signals = int(y_pred.sum())
        signal_rate = (signals / total_samples) * 100.0 if total_samples > 0 else 0.0

        if signals > 0:
            prec = precision_score(y_true, y_pred, zero_division=0)
            rec = recall_score(y_true, y_pred, zero_division=0)
            f1 = f1_score(y_true, y_pred, zero_division=0)
            true_pos = int(((y_pred == 1) & (y_true == 1)).sum())
            false_pos = int(((y_pred == 1) & (y_true == 0)).sum())
        else:
            prec, rec, f1, true_pos, false_pos = 0.0, 0.0, 0.0, 0, 0

        results.append({
            "Threshold": thresh,
            "Signals": signals,
            "Signal Rate (%)": round(signal_rate, 2),
            "True Pos (Wins)": true_pos,
            "False Pos (Losses)": false_pos,
            "Precision / Win Rate": round(prec, 4),
            "Recall": round(rec, 4),
            "F1 Score": round(f1, 4),
        })

    return pd.DataFrame(results)


def plot_and_evaluate_calibration(
    y_true: np.ndarray, y_probs: np.ndarray, output_path: Path
) -> Dict:
    """
    Calculates calibration stats and plots empirical calibration curve vs ideal diagonal.
    Addresses: 'Do NOT automatically call a probability such as 0.75 a 75% real-world chance
    unless calibration supports that interpretation.'
    """
    brier = brier_score_loss(y_true, y_probs)

    # Scikit-learn calibration curve
    prob_true, prob_pred = calibration_curve(y_true, y_probs, n_bins=10, strategy="uniform")

    # Expected Calibration Error (ECE)
    bin_counts, _ = np.histogram(y_probs, bins=10, range=(0, 1))
    valid_bins = bin_counts > 0
    weights = bin_counts[valid_bins] / len(y_true)
    ece = np.sum(weights * np.abs(prob_true - prob_pred))

    # Plotting
    plt.figure(figsize=(8, 6))
    plt.plot([0, 1], [0, 1], "k--", label="Perfectly Calibrated (Ideal)")
    plt.plot(prob_pred, prob_true, "s-", color="#1f77b4", label=f"LightGBM (Brier: {brier:.4f})")
    plt.title("Probability Calibration Curve (Out-of-Sample Test Data)", fontsize=13, fontweight="bold")
    plt.xlabel("Mean Predicted Probability", fontsize=11)
    plt.ylabel("Observed Fraction of Positives (Empirical Win Rate)", fontsize=11)
    plt.grid(True, linestyle=":", alpha=0.6)
    plt.legend(loc="upper left")
    plt.tight_layout()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150)
    plt.close()
    logger.info(f"Calibration curve plot saved to: {output_path}")

    calibration_table = pd.DataFrame({
        "Mean Predicted Prob": prob_pred,
        "Empirical Fraction Pos": prob_true,
    })

    return {
        "brier_score": float(brier),
        "expected_calibration_error": float(ece),
        "calibration_table": calibration_table.to_dict(orient="records"),
    }


def run_full_evaluation():
    """
    Executes full evaluation on out-of-sample Test split.
    """
    print("\n" + "=" * 70)
    print("STEP 8: MODEL EVALUATION ON OUT-OF-SAMPLE TEST DATA")
    model_variant = "CALIBRATED (Isotonic)" if (config.USE_CALIBRATED_MODEL and config.CALIBRATED_MODEL_FILE.exists()) else "RAW LightGBM"
    print(f"Model Variant    : {model_variant}")
    print("=" * 70)

    model, metadata = load_model_and_metadata()
    feature_cols = metadata["features"]

    # Load dataset & chronological splits
    combined = dataset.load_combined_dataset()
    _, _, test_df = dataset.get_chronological_splits(combined)

    if test_df.empty:
        raise ValueError("Test split is empty. Verify date settings in config.py.")

    X_test = test_df[feature_cols].astype(np.float32)
    y_test = test_df["target"].astype(int).values

    test_samples = len(y_test)
    test_positives = int(y_test.sum())
    baseline_win_rate = test_positives / test_samples

    # Model inference
    y_probs = model.predict_proba(X_test)[:, 1]
    y_pred_50 = (y_probs >= 0.50).astype(int)

    # Core Metrics
    roc_auc = roc_auc_score(y_test, y_probs)
    pr_auc = average_precision_score(y_test, y_probs)
    cm = confusion_matrix(y_test, y_pred_50)

    print(f"\nTest Date Range      : {test_df['Date'].min().strftime('%Y-%m-%d')} to {test_df['Date'].max().strftime('%Y-%m-%d')}")
    print(f"Total Test Samples   : {test_samples:,}")
    print(f"Positive Class Rate  : {test_positives:,} ({baseline_win_rate*100:.2f}%)")
    print("-" * 50)
    print(f"ROC-AUC Score        : {roc_auc:.4f}")
    print(f"PR-AUC (Avg Prec)    : {pr_auc:.4f} (vs Random Baseline: {baseline_win_rate:.4f})")
    print(f"Accuracy @ 0.50      : {accuracy_score(y_test, y_pred_50):.4f}")
    print(f"Precision @ 0.50     : {precision_score(y_test, y_pred_50, zero_division=0):.4f}")
    print(f"Recall @ 0.50        : {recall_score(y_test, y_pred_50, zero_division=0):.4f}")
    print(f"F1 Score @ 0.50      : {f1_score(y_test, y_pred_50, zero_division=0):.4f}")
    print(f"Confusion Matrix     : TN={cm[0,0]}, FP={cm[0,1]}, FN={cm[1,0]}, TP={cm[1,1]}")

    # Threshold Sweep Table
    print("\n" + "=" * 80)
    print("PROBABILITY THRESHOLD SWEEP (OUT-OF-SAMPLE TEST SET)")
    print("=" * 80)
    sweep_df = evaluate_threshold_sweep(y_test, y_probs, config.EVAL_THRESHOLDS)
    print(sweep_df.to_string(index=False))
    print("=" * 80)

    # Probability Calibration
    calib_plot_path = config.OUTPUTS_DIR / "calibration_curve.png"
    calib_results = plot_and_evaluate_calibration(y_test, y_probs, calib_plot_path)

    print("\nPROBABILITY CALIBRATION ANALYSIS:")
    print(f"Brier Score Loss     : {calib_results['brier_score']:.4f}")
    print(f"Expected Calib Error : {calib_results['expected_calibration_error']:.4f}")
    print("\nCalibration Bins (Predicted Prob vs Empirical Win Rate):")
    for row in calib_results["calibration_table"]:
        print(f"  P(Predicted) ~ {row['Mean Predicted Prob']:.2f}  -->  Observed Win Rate: {row['Empirical Fraction Pos']:.2%}")

    print("\nCALIBRATION INTERPRETATION NOTE:")
    print("  * Because the model is trained with class imbalance balancing ('balanced' weighting),")
    print("    raw probabilities are scaled relative to balanced priors.")
    print("  * A higher score reflects a monotonically higher relative probability of touching +2%,")
    print("    and actual empirical precision at higher thresholds is tracked in the table above.")

    # Save results to outputs
    eval_report = {
        "test_start": test_df["Date"].min().strftime("%Y-%m-%d"),
        "test_end": test_df["Date"].max().strftime("%Y-%m-%d"),
        "samples": test_samples,
        "positive_rate": baseline_win_rate,
        "roc_auc": float(roc_auc),
        "pr_auc": float(pr_auc),
        "threshold_sweep": sweep_df.to_dict(orient="records"),
        "calibration": calib_results,
    }
    with open(config.OUTPUTS_DIR / "evaluation_report.json", "w") as f:
        json.dump(eval_report, f, indent=4)
    sweep_df.to_csv(config.OUTPUTS_DIR / "threshold_sweep.csv", index=False)
    logger.info("Saved evaluation report and threshold sweep CSV to outputs/")

    return eval_report


if __name__ == "__main__":
    run_full_evaluation()
