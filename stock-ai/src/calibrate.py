"""
Probability Calibration Module for Stock-AI.

Addresses systematic overconfidence in LightGBM probabilities introduced by
class_weight='balanced' training. Uses isotonic regression (non-parametric)
fitted on a dedicated CALIBRATION period to map raw scores to empirical win rates.
This period must be disjoint from training and tuning / early stopping.

Usage:
    python src/calibrate.py

Outputs:
    models/lightgbm_calibrated.pkl     — Calibrator bundle with base-model provenance
    outputs/calibration_comparison.json — Before/After calibration comparison
"""

import sys
import json
import hashlib
import logging
from pathlib import Path
from typing import Dict, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    precision_score,
    roc_auc_score,
)

sys.path.append(str(Path(__file__).resolve().parent.parent))
import config
from src import dataset

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


class CalibratedWrapper:
    """
    Module-level wrapper that applies a post-hoc isotonic or sigmoid calibrator
    over a pre-fitted base model. Defined at module level so joblib can pickle it.
    """
    def __init__(self, base_model, calibrator, cal_type: str):
        self.base_model = base_model
        self.calibrator = calibrator
        self.cal_type = cal_type

    def predict_proba(self, X):
        raw = self.base_model.predict_proba(X)[:, 1]
        if self.cal_type == "isotonic":
            cal_prob = self.calibrator.transform(raw)
        else:
            cal_prob = self.calibrator.predict_proba(raw.reshape(-1, 1))[:, 1]
        return np.column_stack([1 - cal_prob, cal_prob])

    def predict(self, X, threshold: float = 0.5):
        return (self.predict_proba(X)[:, 1] >= threshold).astype(int)

    @property
    def booster_(self):
        return self.base_model.booster_



def load_calibrated_model() -> "CalibratedWrapper":
    """
    Loads the base LightGBM model and calibrator bundle from disk,
    reconstructing a CalibratedWrapper instance.

    This is the canonical way to load the calibrated model from any module.
    Always import this function rather than joblib.load(CALIBRATED_MODEL_FILE) directly.
    """
    if not config.MODEL_FILE.exists():
        raise FileNotFoundError(f"Base model not found: {config.MODEL_FILE}")
    if not config.CALIBRATED_MODEL_FILE.exists():
        raise FileNotFoundError(
            f"Calibrator bundle not found: {config.CALIBRATED_MODEL_FILE}. "
            "Run src/calibrate.py first."
        )
    base_model = joblib.load(config.MODEL_FILE)
    bundle = joblib.load(config.CALIBRATED_MODEL_FILE)
    return CalibratedWrapper(base_model, bundle["calibrator"], bundle["cal_type"])


def _expected_calibration_error(y_true: np.ndarray, y_probs: np.ndarray, n_bins: int = 10) -> float:
    """Computes Expected Calibration Error (ECE) over uniform bins."""
    bin_counts, bin_edges = np.histogram(y_probs, bins=n_bins, range=(0, 1))
    ece = 0.0
    for i in range(n_bins):
        mask = (y_probs >= bin_edges[i]) & (y_probs < bin_edges[i + 1])
        if mask.sum() == 0:
            continue
        bin_acc = y_true[mask].mean()
        bin_conf = y_probs[mask].mean()
        weight = mask.sum() / len(y_true)
        ece += weight * abs(bin_acc - bin_conf)
    return float(ece)


def _threshold_precision_table(y_true: np.ndarray, y_probs: np.ndarray) -> list:
    """Returns precision at each standard evaluation threshold."""
    rows = []
    for thresh in config.EVAL_THRESHOLDS:
        y_pred = (y_probs >= thresh).astype(int)
        n_signals = int(y_pred.sum())
        prec = float(precision_score(y_true, y_pred, zero_division=0)) if n_signals > 0 else 0.0
        rows.append({
            "threshold": thresh,
            "signals": n_signals,
            "precision": round(prec, 4),
        })
    return rows


def _calibration_stats(y_true: np.ndarray, y_probs: np.ndarray, label: str) -> Dict:
    """Computes full calibration diagnostics for a set of probabilities."""
    prob_true, prob_pred = calibration_curve(y_true, y_probs, n_bins=10, strategy="uniform")
    return {
        "label": label,
        "roc_auc": float(roc_auc_score(y_true, y_probs)),
        "pr_auc": float(average_precision_score(y_true, y_probs)),
        "brier_score": float(brier_score_loss(y_true, y_probs)),
        "ece": _expected_calibration_error(y_true, y_probs),
        "threshold_sweep": _threshold_precision_table(y_true, y_probs),
        "calibration_curve": {
            "prob_pred": prob_pred.tolist(),
            "prob_true": prob_true.tolist(),
        },
    }


def fit_explicit_calibrator(base_model, calibration_x, calibration_y, method="sigmoid"):
    """Fit only the explicitly supplied partition; no dataset reads or writes.

    The caller must enforce temporal disjointness from fitting/selection partitions.
    This API is used by the isolated clean comparison runner.
    """
    labels = np.asarray(calibration_y)
    if len(labels) < 40 or set(np.unique(labels)) != {0, 1} or min(np.bincount(labels.astype(int))) < 10:
        raise ValueError("Calibration needs at least 40 observations and 10 of each class")
    if method not in {"sigmoid", "isotonic"}:
        raise ValueError("Unsupported calibration method")
    raw = np.asarray(base_model.predict_proba(calibration_x))[:, 1]
    if len(raw) != len(labels) or not np.isfinite(raw).all() or ((raw < 0) | (raw > 1)).any():
        raise ValueError("Invalid calibration probabilities")
    if method == "isotonic":
        calibrator = IsotonicRegression(out_of_bounds="clip").fit(raw, labels)
    else:
        calibrator = LogisticRegression(random_state=42).fit(raw.reshape(-1, 1), labels)
    return CalibratedWrapper(base_model, calibrator, method)


def validate_calibration_contract(metadata: Dict) -> Dict:
    """Require base-model fitting dates to leave calibration entirely unused.

    The metadata's legacy ``val_*`` names identify tuning / early stopping.
    Validation is pure: it performs no model or dataset loads and no writes.
    """
    def date_value(value, label):
        try:
            parsed = pd.Timestamp(value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f"Invalid calibration contract date: {label}={value!r}") from exc
        if pd.isna(parsed) or parsed.tzinfo is not None:
            raise ValueError(f"Invalid calibration contract date: {label}={value!r}")
        return parsed

    configured = {
        "train_start": date_value(config.TRAIN_START, "TRAIN_START"),
        "train_end": date_value(config.TRAIN_END, "TRAIN_END"),
        "val_start": date_value(config.TUNING_START, "TUNING_START"),
        "val_end": date_value(config.TUNING_END, "TUNING_END"),
        "calibration_start": date_value(config.CALIBRATION_START, "CALIBRATION_START"),
        "calibration_end": date_value(config.CALIBRATION_END, "CALIBRATION_END"),
        "test_start": date_value(config.UNTOUCHED_TEST_START, "UNTOUCHED_TEST_START"),
        "test_end": date_value(config.UNTOUCHED_TEST_END, "UNTOUCHED_TEST_END"),
    }
    if not (
        configured["train_start"] <= configured["train_end"]
        < configured["val_start"] <= configured["val_end"]
        < configured["calibration_start"] <= configured["calibration_end"]
        < configured["test_start"] <= configured["test_end"]
    ):
        raise ValueError("Training, tuning, calibration, and test windows must be chronologically disjoint")

    actual = {}
    for field in ("train_start", "train_end", "val_start", "val_end"):
        if not isinstance(metadata, dict) or field not in metadata:
            raise ValueError(
                f"Base-model metadata is missing {field}; calibration isolation cannot be verified. "
                "Retrain with the configured training and tuning windows."
            )
        actual[field] = date_value(metadata[field], f"metadata.{field}")

    for field in ("train_end", "val_end"):
        if actual[field] >= configured["calibration_start"]:
            raise ValueError(
                f"Base model {field}={metadata[field]} overlaps the dedicated calibration period "
                f"starting {config.CALIBRATION_START}. Retrain with tuning ending "
                f"{config.TUNING_END} before fitting a calibrator."
            )
    for field, value in actual.items():
        if value != configured[field]:
            raise ValueError(
                f"Base model {field}={metadata[field]} does not match the configured "
                f"training / tuning window ({configured[field].date().isoformat()}). "
                "Retrain with the configured windows before calibration."
            )

    return {
        "train_window": {
            "start": configured["train_start"].date().isoformat(),
            "end": configured["train_end"].date().isoformat(),
        },
        "tuning_window": {
            "start": configured["val_start"].date().isoformat(),
            "end": configured["val_end"].date().isoformat(),
        },
        "calibration_window": {
            "start": configured["calibration_start"].date().isoformat(),
            "end": configured["calibration_end"].date().isoformat(),
        },
        "test_window": {
            "start": configured["test_start"].date().isoformat(),
            "end": configured["test_end"].date().isoformat(),
        },
    }


def run_calibration(method: str = "isotonic") -> Tuple[object, Dict]:
    """
    Fits an isotonic (or sigmoid) calibrator on the dedicated calibration period.
    Evaluates both raw and calibrated probabilities on the TEST set.

    Args:
        method: 'isotonic' (recommended, non-parametric) or 'sigmoid' (Platt scaling).

    Returns:
        calibrated_model: CalibratedWrapper fitted on the calibration split
        comparison_report: Dict with before/after diagnostics
    """
    print("\n" + "=" * 70)
    print(f"PHASE 1: {method.upper()} PROBABILITY CALIBRATION")
    print("=" * 70)

    if method not in {"sigmoid", "isotonic"}:
        raise ValueError("Unsupported calibration method")

    # Reject legacy fitting windows before loading any model/data or writing artifacts.
    with open(config.METADATA_FILE, "r") as f:
        metadata = json.load(f)
    temporal_contract = validate_calibration_contract(metadata)
    feature_cols = metadata["features"]

    # --- Load base model ---
    if not config.MODEL_FILE.exists():
        raise FileNotFoundError(
            f"Base model not found: {config.MODEL_FILE}. Run src/train.py first."
        )
    base_model = joblib.load(config.MODEL_FILE)
    logger.info(f"Loaded base LightGBM model from: {config.MODEL_FILE}")
    model_hasher = hashlib.sha256()
    with open(config.MODEL_FILE, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            model_hasher.update(chunk)
    base_model_sha256 = model_hasher.hexdigest()

    # --- Load dataset splits ---
    combined = dataset.load_combined_dataset()
    _, _, calibration_df, test_df = dataset.get_four_period_splits(combined)

    if calibration_df.empty:
        raise ValueError("Calibration split is empty. Check date config.")
    if test_df.empty:
        raise ValueError("Test split is empty. Check date config.")

    calibration_window = {
        "start": pd.Timestamp(calibration_df["Date"].min()).date().isoformat(),
        "end": pd.Timestamp(calibration_df["Date"].max()).date().isoformat(),
    }
    X_calibration = calibration_df[feature_cols].astype(np.float32)
    y_calibration = calibration_df["target"].astype(int).values
    X_test = test_df[feature_cols].astype(np.float32)
    y_test = test_df["target"].astype(int).values

    # --- Raw model diagnostics (pre-calibration baseline) ---
    logger.info("Computing raw (pre-calibration) test probabilities...")
    raw_test_probs = base_model.predict_proba(X_test)[:, 1]
    before_stats = _calibration_stats(y_test, raw_test_probs, label="Raw LightGBM (Before)")

    print(f"\n[BEFORE CALIBRATION] Test Set Diagnostics:")
    print(f"  ROC-AUC       : {before_stats['roc_auc']:.4f}")
    print(f"  PR-AUC        : {before_stats['pr_auc']:.4f}")
    print(f"  Brier Score   : {before_stats['brier_score']:.4f}  (lower is better)")
    print(f"  ECE           : {before_stats['ece']:.4f}  (lower is better, 0 = perfect)")
    print(f"\n  Precision Sweep:")
    for row in before_stats["threshold_sweep"]:
        print(f"    @ {row['threshold']:.2f}  -> {row['precision']*100:.1f}% win rate  ({row['signals']} signals)")

    # Fit on the calibration partition only; tuning was used by the base model.
    logger.info(f"Fitting {method} calibrator on calibration period ({len(X_calibration)} rows)...")
    calibrated_model = fit_explicit_calibrator(
        base_model, X_calibration, y_calibration, method=method,
    )
    calibrator = calibrated_model.calibrator
    _calibrator_type = calibrated_model.cal_type
    logger.info("Calibration fitting complete.")

    # --- Calibrated probabilities on test set ---
    cal_test_probs = calibrated_model.predict_proba(X_test)[:, 1]
    after_stats = _calibration_stats(y_test, cal_test_probs, label=f"Calibrated ({method})")

    print(f"\n[AFTER {method.upper()} CALIBRATION] Test Set Diagnostics:")
    print(f"  ROC-AUC       : {after_stats['roc_auc']:.4f}")
    print(f"  PR-AUC        : {after_stats['pr_auc']:.4f}")
    print(f"  Brier Score   : {after_stats['brier_score']:.4f}  (lower is better)")
    print(f"  ECE           : {after_stats['ece']:.4f}  (lower is better, 0 = perfect)")
    print(f"\n  Precision Sweep:")
    for row in after_stats["threshold_sweep"]:
        before_prec = next(
            (r["precision"] for r in before_stats["threshold_sweep"] if r["threshold"] == row["threshold"]), 0.0
        )
        delta = row["precision"] - before_prec
        arrow = f"[+{delta*100:.1f}pp]" if delta > 0.001 else (f"[-{abs(delta)*100:.1f}pp]" if delta < -0.001 else "[same]")
        print(f"    @ {row['threshold']:.2f}  -> {row['precision']*100:.1f}% win rate  ({row['signals']} signals)  {arrow}")

    # --- Save calibrated model components ---
    # Save the calibrator and its type separately so CalibratedWrapper can be
    # reconstructed at load time (avoids pickle module-path issues).
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    config.OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    calibration_provenance = {
        "base_model_sha256": base_model_sha256,
        "calibration_window": calibration_window,
        "calibration_samples_used_for_fitting": int(len(X_calibration)),
        "temporal_contract": temporal_contract,
    }
    calibrator_bundle = {
        "calibrator": calibrator,
        "cal_type": _calibrator_type,
        "method": method,
        **calibration_provenance,
        "calibration_provenance": calibration_provenance,
    }
    joblib.dump(calibrator_bundle, config.CALIBRATED_MODEL_FILE)
    logger.info(f"Saved calibrator bundle to: {config.CALIBRATED_MODEL_FILE}")

    # --- Plot comparison calibration curve ---
    _plot_calibration_comparison(
        y_test=y_test,
        raw_probs=raw_test_probs,
        cal_probs=cal_test_probs,
        before_stats=before_stats,
        after_stats=after_stats,
        method=method,
    )

    # --- Save comparison report ---
    comparison_report = {
        "calibration_method": method,
        # Legacy field retained for readers; fitting now uses dedicated calibration rows.
        "val_samples_used_for_fitting": int(len(X_calibration)),
        **calibration_provenance,
        "calibration_provenance": calibration_provenance,
        "test_samples_evaluated": int(len(X_test)),
        "test_positive_rate": float(y_test.mean()),
        "before": before_stats,
        "after": after_stats,
    }
    report_path = config.OUTPUTS_DIR / "calibration_comparison.json"
    with open(report_path, "w") as f:
        json.dump(comparison_report, f, indent=4)
    logger.info(f"Saved calibration comparison report to: {report_path}")

    print("\n" + "=" * 70)
    print(f"[DONE] Phase 1 Complete. Calibrated model saved: {config.CALIBRATED_MODEL_FILE}")
    print(f"  Brier Score improvement : {before_stats['brier_score']:.4f} -> {after_stats['brier_score']:.4f}")
    print(f"  ECE improvement         : {before_stats['ece']:.4f} -> {after_stats['ece']:.4f}")
    print("=" * 70)

    return calibrated_model, comparison_report


def _plot_calibration_comparison(
    y_test: np.ndarray,
    raw_probs: np.ndarray,
    cal_probs: np.ndarray,
    before_stats: Dict,
    after_stats: Dict,
    method: str,
) -> None:
    """Plots side-by-side calibration curves for before and after comparison."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle("Probability Calibration: Before vs After Isotonic Correction", fontsize=14, fontweight="bold")

    for ax, probs, stats, title_suffix in [
        (axes[0], raw_probs, before_stats, "Raw LightGBM"),
        (axes[1], cal_probs, after_stats, f"After {method.title()} Calibration"),
    ]:
        pb = stats["calibration_curve"]["prob_pred"]
        pt = stats["calibration_curve"]["prob_true"]
        ax.plot([0, 1], [0, 1], "k--", lw=1.5, label="Perfect Calibration")
        ax.plot(pb, pt, "o-", color="#1f77b4", lw=2, ms=6,
                label=f"Model  (Brier: {stats['brier_score']:.3f},  ECE: {stats['ece']:.3f})")
        ax.set_title(title_suffix, fontsize=12)
        ax.set_xlabel("Mean Predicted Probability")
        ax.set_ylabel("Empirical Win Rate (Fraction Positive)")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.grid(True, linestyle=":", alpha=0.6)
        ax.legend(loc="upper left", fontsize=9)

    plt.tight_layout()
    out_path = config.OUTPUTS_DIR / "calibration_comparison.png"
    plt.savefig(out_path, dpi=150)
    plt.close()
    logger.info(f"Calibration comparison chart saved to: {out_path}")


if __name__ == "__main__":
    run_calibration(method="isotonic")
