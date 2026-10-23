"""
Unit tests for Prospective Drift Monitor and Calibration Tracking (M6-06).
"""

import sys
import unittest
from pathlib import Path
import numpy as np

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from src.drift_monitor import calculate_psi, evaluate_prospective_calibration


class TestDriftMonitor(unittest.TestCase):

    def test_psi_identical_distribution(self):
        """PSI on identical distributions should be approximately zero (< 0.05)."""
        np.random.seed(42)
        dist_a = np.random.normal(loc=50.0, scale=10.0, size=1000)
        dist_b = np.random.normal(loc=50.0, scale=10.0, size=1000)

        psi = calculate_psi(dist_a, dist_b, num_buckets=10)
        self.assertLess(psi, 0.05, f"Expected near-zero PSI for identical distributions, got {psi}")

    def test_psi_drifted_distribution(self):
        """PSI on significantly shifted distributions should exceed 0.25 (drift warning)."""
        np.random.seed(42)
        dist_baseline = np.random.normal(loc=50.0, scale=10.0, size=1000)
        dist_shifted = np.random.normal(loc=70.0, scale=10.0, size=1000)

        psi = calculate_psi(dist_baseline, dist_shifted, num_buckets=10)
        self.assertGreater(psi, 0.25, f"Expected PSI > 0.25 for shifted distributions, got {psi}")

    def test_psi_handles_empty_and_nan(self):
        """PSI should handle empty arrays and NaNs safely."""
        empty_arr = np.array([])
        nan_arr = np.array([np.nan, np.nan])
        valid_arr = np.array([1.0, 2.0, 3.0, 4.0, 5.0])

        self.assertEqual(calculate_psi(empty_arr, valid_arr), 0.0)
        self.assertEqual(calculate_psi(nan_arr, valid_arr), 0.0)

    def test_prospective_calibration_perfect_alignment(self):
        """Tests that well-calibrated probabilities produce low ECE and Brier score."""
        probs = np.array([0.8, 0.8, 0.8, 0.8, 0.8, 0.2, 0.2, 0.2, 0.2, 0.2])
        # 4 out of 5 of the 0.8 bin hit 1.0 (80%), 1 out of 5 of the 0.2 bin hits 1.0 (20%)
        outcomes = np.array([1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])

        result = evaluate_prospective_calibration(probs, outcomes, n_bins=5)
        self.assertEqual(result["n_samples"], 10)
        self.assertLessEqual(result["ece"], 0.05)
        self.assertEqual(result["status"], "WELL_CALIBRATED")
        self.assertEqual(result["high_confidence_count"], 5)
        self.assertEqual(result["high_confidence_win_rate"], 0.8)

    def test_prospective_calibration_drift_alert(self):
        """Overconfident model where predicted 90% only wins 10% should trigger DRIFT_ALERT."""
        probs = np.array([0.9] * 10)
        outcomes = np.array([0.0] * 9 + [1.0])  # only 10% hit

        result = evaluate_prospective_calibration(probs, outcomes, n_bins=5)
        self.assertEqual(result["status"], "DRIFT_ALERT")
        self.assertGreater(result["ece"], 0.5)


if __name__ == "__main__":
    unittest.main()
