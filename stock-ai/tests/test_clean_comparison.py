import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd

from src.clean_contract import (
    PRICE_FEATURES,
    MARKET_FEATURES,
    assert_no_synthetic,
    validate_clean_schema,
)
from src.clean_comparison import (
    ConstantModel,
    TechnicalModel,
    ranked_selection,
    selection_stats,
    probability_stats,
    choose_policy,
)


class CleanContractTests(unittest.TestCase):
    def test_forbids_synthetic_and_flow_features(self):
        forbidden_cases = [
            ["sentiment_score"],
            ["fii_flow_1d"],
            ["dii_flow_5d"],
            ["institutional_activity"],
            ["buzz_index"],
            ["ret_1d", "sentiment_buzz"],
        ]
        for cols in forbidden_cases:
            with self.subTest(cols=cols):
                with self.assertRaises(ValueError):
                    assert_no_synthetic(cols)

    def test_validates_clean_allowlist(self):
        valid = list(PRICE_FEATURES[:5]) + list(MARKET_FEATURES[:2])
        validate_clean_schema(valid)

        with self.assertRaises(ValueError):
            validate_clean_schema([])  # empty

        with self.assertRaises(ValueError):
            validate_clean_schema(valid + ["unauthorized_feature_xyz"])

        with self.assertRaises(ValueError):
            validate_clean_schema(valid + [valid[0]])  # duplicate


class CleanComparisonTests(unittest.TestCase):
    def test_constant_and_technical_models(self):
        matrix = pd.DataFrame({
            "ret_5d": [0.05, -0.02, 0.0],
            "close_to_sma20": [0.03, -0.01, 0.0],
        })
        const_model = ConstantModel(0.12)
        p_const = const_model.predict_proba(matrix)
        self.assertEqual(p_const.shape, (3, 2))
        np.testing.assert_allclose(p_const[:, 1], [0.12, 0.12, 0.12])

        tech_model = TechnicalModel()
        p_tech = tech_model.predict_proba(matrix)
        self.assertEqual(p_tech.shape, (3, 2))
        self.assertTrue((p_tech >= 0).all() and (p_tech <= 1).all())
        # higher momentum gives higher score
        self.assertGreater(p_tech[0, 1], p_tech[1, 1])

    def test_ranked_selection_and_stats(self):
        frame = pd.DataFrame({
            "Date": ["2026-09-01", "2026-09-01", "2026-09-02", "2026-09-02"],
            "ticker": ["A.NS", "B.NS", "A.NS", "B.NS"],
            "target": [1, 0, 1, 1],
            "net_return": [0.02, -0.01, 0.018, 0.019],
            "stress_net_return": [0.018, -0.012, 0.016, 0.017],
        })
        probs = np.array([0.8, 0.3, 0.4, 0.9])
        contract = {
            "max_positions_per_day": 1,
            "coverage_fraction": 0.5,
            "min_policy_trades": 2,
            "policy_quantiles": [0.5],
        }
        mask = ranked_selection(frame, probs, contract)
        self.assertEqual(int(mask.sum()), 2)
        # Check that top score each day is picked
        self.assertTrue(mask[0])  # A.NS on day 1 (0.8 vs 0.3)
        self.assertTrue(mask[3])  # B.NS on day 2 (0.9 vs 0.4)

        stats = selection_stats(frame, mask, contract)
        self.assertEqual(stats["count"], 2)
        self.assertEqual(stats["precision"], 1.0)
        self.assertAlmostEqual(stats["mean_net_return"], 0.0195)

    def test_probability_stats_calibration_bins(self):
        labels = [0, 0, 0, 1, 1, 1]
        probs = [0.05, 0.12, 0.18, 0.82, 0.88, 0.95]
        stats = probability_stats(labels, probs)
        self.assertEqual(stats["rows"], 6)
        self.assertAlmostEqual(stats["event_rate"], 0.5)
        self.assertGreaterEqual(stats["roc_auc"], 0.9)
        self.assertEqual(len(stats["calibration_bins"]), 10)


if __name__ == "__main__":
    unittest.main()
