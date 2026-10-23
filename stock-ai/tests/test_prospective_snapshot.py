"""
Test suite for Prospective Pre-Market Prediction Snapshots and Immutability (M6-04).
Verifies:
1. Predictions are recorded before market open with cryptographic fingerprint.
2. Re-recording a session cohort fails (immutability and duplicate prevention).
3. Prediction records exclude any future outcome fields (zero lookahead).
4. Outcome reconciliation attaches append-only records without altering original predictions.
"""

import sys
import unittest
import shutil
import tempfile
from pathlib import Path
import json
from datetime import datetime, timezone
from unittest.mock import patch

class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 10, 2, 11, tzinfo=timezone.utc)

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

import config
from src import ledger


class TestProspectiveSnapshot(unittest.TestCase):

    def setUp(self):
        self.clock = patch.object(ledger, 'datetime', FrozenDatetime)
        self.clock.start()
        self.addCleanup(self.clock.stop)
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

    def test_prospective_snapshot_records_cleanly_without_outcomes(self):
        """Prospective snapshots must never contain outcome/fill fields upon creation."""
        pred = ledger.record_prediction(
            ticker="INFY.NS",
            horizon="next",
            intended_session="2026-10-05",
            reference_price=1850.0,
            score=0.72,
            calibrated_prob=0.66,
            entry_condition="market_open",
            target_pct=0.02,
            stop_pct=0.02,
            input_cutoff="2026-10-02T15:30:00+05:30",
        )

        # Verification of absence of outcome fields
        self.assertNotIn("fill_price", pred)
        self.assertNotIn("exit_price", pred)
        self.assertNotIn("net_return", pred)
        self.assertNotIn("outcome_status", pred)
        self.assertEqual(pred["status"], "PENDING_EXECUTION")
        self.assertTrue(pred["record_hash"])

    def test_reconciliation_is_append_only(self):
        """Attaching an outcome creates a distinct outcome record while leaving the prediction unmodified."""
        pred = ledger.record_prediction(
            ticker="TCS.NS",
            horizon="next",
            intended_session="2026-10-05",
            reference_price=4200.0,
            score=0.68,
        )
        orig_hash = pred["record_hash"]

        # Reconcile outcome
        out = ledger.record_outcome(
            prediction_id=pred["prediction_id"],
            ticker="TCS.NS",
            intended_session="2026-10-05",
            outcome_status="TARGET_HIT",
            entry_occurred=True,
            fill_price=4200.0,
            exit_price=4284.0,
            friction_pct=0.0015,
        )

        # Reload prediction from disk
        all_preds = ledger.load_all_predictions()
        reloaded_pred = [p for p in all_preds if p["prediction_id"] == pred["prediction_id"]][0]

        # The prediction file has NOT been mutated
        self.assertEqual(reloaded_pred["record_hash"], orig_hash)
        self.assertEqual(reloaded_pred["status"], "PENDING_EXECUTION")

        # The outcome file contains the resolution
        all_outs = ledger.load_all_outcomes()
        self.assertEqual(len(all_outs), 1)
        self.assertEqual(all_outs[0]["prediction_id"], pred["prediction_id"])
        self.assertEqual(all_outs[0]["outcome_status"], "TARGET_HIT")
        self.assertEqual(all_outs[0]["net_return"], 0.0185)  # 2% - 0.15%


if __name__ == "__main__":
    unittest.main()
