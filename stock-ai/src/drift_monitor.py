"""
Axion Prospective Drift Monitor and Calibration Tracking Module (M6-06).
Monitors:
1. Population Stability Index (PSI) for key technical features across prospective sessions.
2. Expected Calibration Error (ECE) and Brier Score drift between training and prospective predictions.
3. Signal count stability and coverage tracking.
"""

from typing import Any, Dict, List, Optional, Tuple
import numpy as np


def calculate_psi(
    expected: np.ndarray,
    actual: np.ndarray,
    num_buckets: int = 10,
    epsilon: float = 1e-4,
) -> float:
    """
    Computes Population Stability Index (PSI) between baseline (expected) and prospective (actual).
    PSI < 0.1: Stable / No Drift
    0.1 <= PSI < 0.25: Moderate Drift
    PSI >= 0.25: Significant Drift Warning
    """
    expected = expected[~np.isnan(expected)]
    actual = actual[~np.isnan(actual)]

    if len(expected) == 0 or len(actual) == 0:
        return 0.0

    percentiles = np.linspace(0, 100, num_buckets + 1)
    bin_edges = np.percentile(expected, percentiles)
    bin_edges[0] -= 1e-5
    bin_edges[-1] += 1e-5

    # Count occurrences in each bucket
    expected_counts, _ = np.histogram(expected, bins=bin_edges)
    actual_counts, _ = np.histogram(actual, bins=bin_edges)

    # Convert to fractions
    expected_pct = expected_counts / max(len(expected), 1)
    actual_pct = actual_counts / max(len(actual), 1)

    # Avoid zero division with epsilon
    expected_pct = np.clip(expected_pct, epsilon, 1.0)
    actual_pct = np.clip(actual_pct, epsilon, 1.0)

    # Re-normalize
    expected_pct /= expected_pct.sum()
    actual_pct /= actual_pct.sum()

    # Calculate PSI
    psi_val = np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct))
    return float(max(0.0, psi_val))


def evaluate_prospective_calibration(
    probabilities: np.ndarray,
    outcomes: np.ndarray,
    n_bins: int = 5,
) -> Dict[str, Any]:
    """
    Evaluates probability calibration on prospective shadow observations.
    Calculates Brier Score and Expected Calibration Error (ECE).
    """
    if len(probabilities) == 0 or len(outcomes) == 0 or len(probabilities) != len(outcomes):
        return {
            "n_samples": 0,
            "brier_score": None,
            "ece": None,
            "status": "INSUFFICIENT_SAMPLES",
        }

    probs = np.clip(probabilities.astype(float), 0.0, 1.0)
    y_true = np.clip(outcomes.astype(float), 0.0, 1.0)

    # Brier score
    brier = float(np.mean((probs - y_true) ** 2))

    # Expected Calibration Error (ECE)
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    bin_details = []

    for i in range(n_bins):
        bin_mask = (probs >= bin_edges[i]) & (probs < bin_edges[i + 1] if i < n_bins - 1 else probs <= bin_edges[i + 1])
        bin_count = int(np.sum(bin_mask))
        if bin_count > 0:
            bin_acc = float(np.mean(y_true[bin_mask]))
            bin_conf = float(np.mean(probs[bin_mask]))
            bin_diff = abs(bin_acc - bin_conf)
            ece += (bin_count / len(probs)) * bin_diff
            bin_details.append({
                "bin_range": f"{bin_edges[i]:.2f}-{bin_edges[i+1]:.2f}",
                "count": bin_count,
                "accuracy": round(bin_acc, 4),
                "confidence": round(bin_conf, 4),
                "calibration_error": round(bin_diff, 4),
            })

    # High confidence subset (prob >= 0.70)
    high_conf_mask = probs >= 0.70
    high_conf_win_rate = float(np.mean(y_true[high_conf_mask])) if np.sum(high_conf_mask) > 0 else None

    return {
        "n_samples": len(probs),
        "brier_score": round(brier, 4),
        "ece": round(ece, 4),
        "high_confidence_count": int(np.sum(high_conf_mask)),
        "high_confidence_win_rate": round(high_conf_win_rate, 4) if high_conf_win_rate is not None else None,
        "bins": bin_details,
        "status": "WELL_CALIBRATED" if ece <= 0.05 else "MODERATE_DRIFT" if ece <= 0.10 else "DRIFT_ALERT",
    }
