"""
Unit and Regression Tests for Axion 10% Swing Opportunities Engine.
Validates:
1. Target calculation (+10.0% from modeled fill price).
2. Gap-down stop loss execution (Open < Stop -> fill = Open per Investor.gov realism).
3. 0.15% friction deduction on net returns.
4. Purged and embargoed chronological splitting (zero overlap leakage).
5. Liquidity and universe eligibility enforcement.
"""

import unittest
from pathlib import Path
import numpy as np
import pandas as pd
import sys

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from src import swing_dataset, swing_universe, swing_features


class TestSwingEngine(unittest.TestCase):

    def test_target_and_gap_stop_mechanics(self):
        """Verify that gap-down stops fill at open and target is calculated from fill."""
        # Create synthetic 60-day OHLCV
        dates = pd.date_range("2026-01-01", periods=60, freq="B")
        opens = [100.0] * 60
        highs = [102.0] * 25 + [106.0] + [98.0] * 34  # breakout bar at 25
        lows = [98.0] * 60
        closes = [100.0] * 25 + [104.0] + [97.0] * 34
        volumes = [1_000_000] * 60

        # Create adverse gap-down on bar 28 (opens at 92, below stop)
        opens[28] = 92.0
        lows[28] = 91.0
        closes[28] = 93.0

        df = pd.DataFrame({
            "Date": dates,
            "Open": opens,
            "High": highs,
            "Low": lows,
            "Close": closes,
            "Volume": volumes,
        })

        res = swing_dataset.generate_stock_swing_labels("TEST.NS", df, horizon_days=5, validity_days=3)
        self.assertFalse(res.empty, "Labels should be generated for test stock")

        # Find the trade with adverse gap
        gap_stop_trades = res[res["outcome"] == "STOP_HIT"]
        self.assertTrue(len(gap_stop_trades) > 0, "Should have triggered STOP_HIT")
        trade = gap_stop_trades.iloc[0]

        # Modeled entry fill
        self.assertGreater(trade["target_price"], trade["entry_price"])
        self.assertAlmostEqual(trade["target_price"], trade["entry_price"] * 1.10, places=2)

        # Gap fill realism: exit price should reflect gap-down opening (<= stop_price)
        self.assertLessEqual(trade["exit_price"], trade["stop_price"])
        # Net return should reflect 0.15% friction
        expected_gross = (trade["exit_price"] - trade["entry_price"]) / trade["entry_price"]
        self.assertAlmostEqual(trade["net_return_pct"], expected_gross - 0.0015, places=4)

    def test_purged_temporal_boundaries(self):
        """Verify that training set excludes observations whose 20-session outcome window overlaps val."""
        dates = pd.date_range("2024-01-01", "2025-12-31", freq="B")
        df = pd.DataFrame({
            "symbol": ["TEST.NS"] * len(dates),
            "signal_date": dates,
            "label_10pct": [1] * len(dates),
            "outcome": ["TARGET_HIT"] * len(dates),
        })

        train_df, val_df, test_df = swing_dataset.purged_train_test_split(
            df,
            train_end_date="2024-06-30",
            val_start_date="2024-07-01",
            val_end_date="2025-06-30",
            test_start_date="2025-07-01",
            horizon_days=20,
        )

        # Max signal date in training set must be strictly prior to (train_end - buffer)
        max_train_date = train_df["signal_date"].max()
        min_val_date = val_df["signal_date"].min()

        self.assertLess(max_train_date, pd.to_datetime("2024-06-30"))
        self.assertGreaterEqual(min_val_date, pd.to_datetime("2024-07-01"))
        # Verify gap separation between train and val
        separation_days = (min_val_date - max_train_date).days
        self.assertGreaterEqual(separation_days, 20, "Purged buffer must be at least 20 days")

    def test_universe_liquidity_audit(self):
        """Verify that penny stocks or illiquid shares are rejected with clear reasons."""
        dates = pd.date_range("2025-01-01", periods=100, freq="B")
        # Penny stock: price 5 INR
        df_penny = pd.DataFrame({
            "Date": dates,
            "Open": [5.0] * 100,
            "High": [5.1] * 100,
            "Low": [4.9] * 100,
            "Close": [5.0] * 100,
            "Volume": [1000] * 100,
        })
        eval_penny = swing_universe.evaluate_ticker_liquidity(df_penny, "PENNY.NS")
        self.assertFalse(eval_penny["eligible"])
        self.assertIn("PRICE_TOO_LOW", eval_penny["exclusion_reason"])
        self.assertIn("LOW_TURNOVER", eval_penny["exclusion_reason"])

    def test_swing_features_point_in_time(self):
        """Verify that swing features compute valid values without NaNs on recent bars."""
        dates = pd.date_range("2025-01-01", periods=100, freq="B")
        df = pd.DataFrame({
            "Date": dates,
            "Open": np.linspace(100, 150, 100),
            "High": np.linspace(102, 153, 100),
            "Low": np.linspace(99, 148, 100),
            "Close": np.linspace(101, 151, 100),
            "Volume": [500_000] * 100,
        })
        feat_df = swing_features.compute_swing_features_for_stock(df)
        self.assertIn("BB_Squeeze_Ratio", feat_df.columns)
        self.assertIn("ATR_Pct", feat_df.columns)
        self.assertIn("MA_Alignment", feat_df.columns)
        # Verify last row has numeric values
        last_row = feat_df.iloc[-1]
        self.assertFalse(np.isnan(last_row["Dist_EMA_20"]))
        self.assertFalse(np.isnan(last_row["ATR_Pct"]))
        self.assertIn("CMF_20", feat_df.columns)
        self.assertIn("VPT_Slope_20d", feat_df.columns)
        self.assertIn("Vol_Churn_Ratio_20d", feat_df.columns)
        self.assertIn("Event_Risk_Window", feat_df.columns)

    def test_breakeven_trailing_stop_protection(self):
        """Verify that a position touching +6.0% gain trails stop to breakeven."""
        dates = pd.date_range("2026-01-01", periods=60, freq="B")
        opens = [100.0] * 60
        highs = [101.0] * 60
        lows = [99.0] * 60
        closes = [100.0] * 60
        volumes = [1_000_000] * 60

        # Bar 25: Entry trigger (High = 102 exceeds trigger 101.20)
        highs[25] = 102.0
        closes[25] = 101.5

        lows[25] = 100.0  # Entry bar must survive the initial structural stop.

        # Bar 26: Holding session 1 rallies to +7.1% (High = 108.5), triggering breakeven trail
        lows[26] = 100.0  # Below the future trailing stop, above the initial stop.
        opens[26] = 103.0
        highs[26] = 108.5
        closes[26] = 107.0

        # Bar 27: Holding session 2 reverses down to 98 (hits trailed breakeven stop)
        opens[27] = 105.0
        lows[27] = 98.0
        closes[27] = 98.5

        df = pd.DataFrame({
            "Date": dates,
            "Open": opens,
            "High": highs,
            "Low": lows,
            "Close": closes,
            "Volume": volumes,
        })

        res = swing_dataset.generate_stock_swing_labels("TEST.NS", df, horizon_days=10, validity_days=3)
        self.assertFalse(res.empty)
        chosen = res[res["signal_date"] == dates[24]].iloc[0]
        self.assertEqual(chosen["exit_date"], dates[27], "The rally must not rewrite the stop on bar 26")
        be_trades = res[res["outcome"] == "BREAKEVEN_EXIT"]
        self.assertTrue(len(be_trades) > 0, "Trade reaching +6% before reversal should exit as BREAKEVEN_EXIT")


if __name__ == "__main__":
    unittest.main()
