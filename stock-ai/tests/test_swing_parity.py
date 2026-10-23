import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.reconcile_swing_outcomes import reconcile_setup
from src.swing_execution import resolve_entry, resolve_exit, stop_for_next_bar


class SwingExecutionParityTests(unittest.TestCase):
    def setup_signal(self):
        return {
            "symbol": "TEST",
            "signalDate": "2026-01-01",
            "status": "watching",
            "triggerPrice": 100,
            "targetPrice": 110,
            "stopPrice": 95,
        }

    def bars(self, rows):
        return pd.DataFrame([
            {"Date": date, "Open": opening, "High": high, "Low": low, "Close": close}
            for date, opening, high, low, close in rows
        ])

    def test_shared_resolver_is_stop_first_for_conflicting_bar(self):
        decision = resolve_exit(
            {"Open": 100, "High": 112, "Low": 94, "Close": 108},
            entry_price=100,
            target_price=110,
            stop_price=95,
        )
        self.assertEqual(decision, {"status": "stopped", "exit_price": 95, "reason": "intraday_stop"})

    def test_entry_bar_later_high_cannot_rewrite_opening_gap_stop(self):
        decision = resolve_exit(
            {"Open": 94, "High": 115, "Low": 90, "Close": 110},
            entry_price=100,
            target_price=110,
            stop_price=95,
        )
        self.assertEqual(decision["reason"], "gap_stop")
        self.assertEqual(decision["exit_price"], 94)

    def test_trailing_stop_changes_only_following_bar(self):
        initial_stop = 95.0
        next_stop = stop_for_next_bar(initial_stop, 100.0, 107.0)
        self.assertEqual(next_stop, 100.15)
        same_bar = resolve_exit(
            {"Open": 103, "High": 108.5, "Low": 99, "Close": 107},
            entry_price=100,
            target_price=110,
            stop_price=initial_stop,
        )
        self.assertIsNone(same_bar)

    def test_reconciliation_replays_same_gap_stop_and_is_idempotent(self):
        setup = self.setup_signal()
        bars = self.bars([
            ("2026-01-02", 100, 102, 99, 101),
            ("2026-01-05", 94, 115, 90, 110),
        ])
        entry = resolve_entry(bars.iloc[0], setup["triggerPrice"])
        self.assertEqual(entry["status"], "active")
        result = reconcile_setup(setup, bars)
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(result["exitPrice"], 94)
        self.assertEqual(reconcile_setup(result, bars), result)


if __name__ == "__main__":
    unittest.main()