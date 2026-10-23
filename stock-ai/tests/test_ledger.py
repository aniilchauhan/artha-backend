"""
Unit and Regression Tests for Axion Prediction & Outcome Ledger.
Verifies append-only immutability, mathematical integrity of returns, and state machine resolution.
"""

import unittest
import shutil
from pathlib import Path
import tempfile
import sys
from datetime import datetime, timezone
from unittest.mock import patch

class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 9, 9, 10, tzinfo=timezone.utc)

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))
from src import ledger


class TestPredictionLedger(unittest.TestCase):
    def setUp(self):
        self.clock = patch.object(ledger, 'datetime', FrozenDatetime)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        # Create a isolated temporary ledger directory
        self.test_dir = Path(tempfile.mkdtemp())
        self.orig_pred_dir = ledger.PREDICTIONS_DIR
        self.orig_out_dir = ledger.OUTCOMES_DIR

        ledger.PREDICTIONS_DIR = self.test_dir / "predictions"
        ledger.OUTCOMES_DIR = self.test_dir / "outcomes"
        ledger.PREDICTIONS_DIR.mkdir(parents=True, exist_ok=True)
        ledger.OUTCOMES_DIR.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)
        ledger.PREDICTIONS_DIR = self.orig_pred_dir
        ledger.OUTCOMES_DIR = self.orig_out_dir

    def test_record_prediction_immutability_and_hash(self):
        pred = ledger.record_prediction(
            ticker="RELIANCE.NS",
            horizon="next",
            intended_session="2026-09-10",
            reference_price=1000.0,
            score=0.75,
            calibrated_prob=0.68,
            entry_condition="market_open",
            target_pct=0.02,
            stop_pct=0.02,
        )

        self.assertEqual(pred["ticker"], "RELIANCE.NS")
        self.assertEqual(pred["target_price"], 1020.0)
        self.assertEqual(pred["stop_price"], 980.0)
        self.assertEqual(pred["target_pct"], 0.02)
        self.assertEqual(pred["stop_pct"], 0.02)
        self.assertEqual(pred["status"], "PENDING_EXECUTION")
        self.assertTrue("record_hash" in pred)
        self.assertTrue(len(pred["record_hash"]) >= 12)

        # Verify disk persistence
        all_preds = ledger.load_all_predictions()
        self.assertEqual(len(all_preds), 1)
        self.assertEqual(all_preds[0]["prediction_id"], pred["prediction_id"])

    def test_record_outcome_without_mutating_prediction(self):
        pred = ledger.record_prediction(
            ticker="TCS.NS",
            horizon="next",
            intended_session="2026-09-10",
            reference_price=3000.0,
            score=0.82,
        )

        # Original file size before outcome
        pred_files = list(ledger.PREDICTIONS_DIR.glob("*.jsonl"))
        size_before = pred_files[0].stat().st_size

        outcome = ledger.record_outcome(
            prediction_id=pred["prediction_id"],
            ticker="TCS.NS",
            intended_session="2026-09-10",
            outcome_status="TARGET_HIT",
            entry_occurred=True,
            fill_price=3000.0,
            exit_price=3060.0,  # +2.0% gross
            friction_pct=0.0015,  # 0.15% friction
        )

        # Check prediction file was untouched
        size_after = pred_files[0].stat().st_size
        self.assertEqual(size_before, size_after)

        # Check outcome calculations
        self.assertEqual(outcome["outcome_status"], "TARGET_HIT")
        self.assertEqual(outcome["gross_return"], 0.02)
        # Net return = 0.02 - 0.0015 = 0.0185 (+1.85%)
        self.assertAlmostEqual(outcome["net_return"], 0.0185, places=5)

    def test_ledger_summary_metrics(self):
        # Empty summary
        empty_summary = ledger.get_ledger_performance_summary()
        self.assertEqual(empty_summary["reconciled_count"], 0)
        self.assertIsNone(empty_summary["win_rate"])

        # Add 2 predictions and 2 outcomes: 1 win, 1 loss
        p1 = ledger.record_prediction(ticker="INFY.NS", horizon="next", intended_session="2026-09-10", reference_price=1500.0, score=0.7)
        p2 = ledger.record_prediction(ticker="HDFCBANK.NS", horizon="next", intended_session="2026-09-10", reference_price=1600.0, score=0.6)

        ledger.record_outcome(prediction_id=p1["prediction_id"], ticker="INFY.NS", intended_session="2026-09-10", outcome_status="TARGET_HIT", entry_occurred=True, fill_price=1500.0, exit_price=1530.0, price_source='yahoo_finance_daily_ohlc', observed_bar={'Open': 1500, 'High': 1530, 'Low': 1490, 'Close': 1530})
        ledger.record_outcome(prediction_id=p2["prediction_id"], ticker="HDFCBANK.NS", intended_session="2026-09-10", outcome_status="STOP_HIT", entry_occurred=True, fill_price=1600.0, exit_price=1568.0, price_source='yahoo_finance_daily_ohlc', observed_bar={'Open': 1600, 'High': 1601, 'Low': 1568, 'Close': 1568})

        summary = ledger.get_ledger_performance_summary()
        self.assertEqual(summary["total_recorded"], 2)
        self.assertEqual(summary["total_reconciled"], 2)
        self.assertEqual(summary["target_hits"], 1)
        self.assertEqual(summary["stop_hits"], 1)
        self.assertEqual(summary["win_rate"], 0.5)


if __name__ == "__main__":
    unittest.main()
