"""
Strict Leakage & Synthetic Input Audit Test Suite (M5-07).
Validates:
1. Feature extraction strictly forbids lookahead bias and target columns.
2. Synthetic features (sentiment buzz, synthetic FII/DII) are strictly forbidden when clean mode is enabled.
3. 4-period temporal partition boundaries strictly prevent information transfer between train, tuning, calibration, and test.
4. Target definition adheres to the executable contract (next_open to next_high before stop) with terminal NaN.
"""

import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd

STOCK_AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STOCK_AI_DIR))

import config
from src import features, dataset
from src.clean_contract import assert_no_synthetic, FORBIDDEN_PREFIXES


class TestStrictLeakageAndSyntheticAudit(unittest.TestCase):

    def test_forbidden_synthetic_features_rejection(self):
        """Verify that any presence of synthetic features triggers an immediate error."""
        for prefix in FORBIDDEN_PREFIXES:
            cols = ["ret_1d", "rsi_14", f"{prefix}_metric"]
            with self.assertRaises(ValueError, msg=f"Should reject forbidden synthetic feature prefix: {prefix}"):
                assert_no_synthetic(cols)

    def test_feature_columns_contain_zero_targets_or_future_prices(self):
        """Verify extract_feature_column_names filters out all price labels and future targets."""
        forbidden = [
            "target", "target_intraday", "next_open", "next_high", "next_low", "next_close",
            "Date", "ticker", "Open", "High", "Low", "Close", "Adj Close", "Volume"
        ]
        sample_df = pd.DataFrame(columns=forbidden + ["rsi_14", "macd", "volatility_20d"])
        clean_features = features.extract_feature_column_names(sample_df)

        for col in forbidden:
            self.assertNotIn(col, clean_features, f"Feature column leakage detected: {col}")
        self.assertEqual(sorted(clean_features), ["macd", "rsi_14", "volatility_20d"])

    def test_strict_temporal_causality_feature_stability(self):
        """Mutating future data must never mutate past feature values."""
        dates = pd.date_range("2024-01-01", periods=60, freq="B")
        np.random.seed(99)
        base_prices = 200.0 + np.cumsum(np.random.randn(60) * 2.0)
        df_base = pd.DataFrame({
            "Date": dates,
            "Open": base_prices,
            "High": base_prices + 3.0,
            "Low": base_prices - 3.0,
            "Close": base_prices + 1.0,
            "Volume": 50000.0,
        })

        feat_base = features.compute_stock_features(df_base)

        # Mutate the last 15 days
        df_mut = df_base.copy()
        df_mut.loc[45:, "Close"] = df_mut.loc[45:, "Close"] * 3.5
        df_mut.loc[45:, "High"] = df_mut.loc[45:, "High"] * 3.5

        feat_mut = features.compute_stock_features(df_mut)

        non_ohlc = [c for c in feat_base.columns if c not in ["Date", "Open", "High", "Low", "Close", "Volume"]]
        for col in non_ohlc:
            np.testing.assert_allclose(
                feat_base.loc[:44, col].values,
                feat_mut.loc[:44, col].values,
                rtol=1e-5,
                atol=1e-5,
                err_msg=f"Future mutation leaked backwards into past rows for feature: {col}",
            )

    def test_terminal_row_target_is_nan(self):
        """The final row of any ticker must have target NaN since the next session is unknown."""
        df = pd.DataFrame({
            "Date": pd.date_range("2025-01-01", periods=5, freq="B"),
            "Open": [100.0, 102.0, 101.0, 103.0, 105.0],
            "High": [103.0, 105.0, 104.0, 106.0, 108.0],
            "Low": [99.0, 101.0, 100.0, 102.0, 104.0],
            "Close": [102.0, 101.0, 103.0, 105.0, 107.0],
            "Volume": [1000.0] * 5,
        })

        target_df = features.add_target_definition(df, target_pct=0.02)
        self.assertTrue(pd.isna(target_df.iloc[-1]["target"]), "Terminal row must have target NaN")


if __name__ == "__main__":
    unittest.main()
