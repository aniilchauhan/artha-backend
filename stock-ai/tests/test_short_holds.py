"""Execution invariants for the short holding-period research experiment."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.compare_short_holds import simulate


class ShortHoldTests(unittest.TestCase):
    def fixture(self, days=8, symbols=3):
        bars = np.tile(np.array([100., 101., 99., 100.]), (days, symbols, 1))
        scores = np.tile(np.arange(symbols, 0, -1, dtype=float), (days, 1))
        return bars, scores

    def test_holding_age_whole_shares_and_capital_reconciliation(self):
        bars, scores = self.fixture()
        stats, curve, trades = simulate(bars, scores, 1, 7, 3, 2)
        self.assertEqual(stats['unresolved_positions'], 0)
        self.assertTrue(all(t['exit_session'] - t['entry_session'] + 1 == 3 for t in trades))
        self.assertTrue(all(isinstance(t['shares'], int) for t in trades))
        self.assertTrue(curve.peak_positions.le(2).all())
        self.assertTrue(curve.cash.ge(0).all())
        self.assertAlmostEqual(stats['final_value_inr'], 50000 + sum(t['pnl'] for t in trades))
        self.assertLess(stats['return_pct'], 0)  # Flat prices still incur costs.

    def test_overnight_gap_stop_fills_at_open_not_stop(self):
        bars, scores = self.fixture(symbols=1)
        bars[2,0] = [90, 91, 89, 90]
        _, _, trades = simulate(bars, scores, 1, 3, 3, 1, bracket=True)
        self.assertEqual(trades[0]['reason'], 'gap_stop')
        self.assertAlmostEqual(trades[0]['exit_price'], 90 * .9995)
        self.assertLess(trades[0]['pnl'] / trades[0]['notional'], -.10)

    def test_ambiguous_bar_stop_first_and_no_same_day_recycling(self):
        bars, scores = self.fixture(symbols=1)
        bars[1,0] = [100, 110, 90, 100]
        _, curve, trades = simulate(bars, scores, 1, 2, 1, 1, bracket=True)
        self.assertEqual(trades[0]['reason'], 'stop')
        self.assertEqual(sum(t['entry_session'] == 1 for t in trades), 1)
        self.assertEqual(curve.iloc[0].open_positions, 0)

    def test_future_scores_cannot_change_earlier_entry(self):
        bars, scores = self.fixture()
        _, _, before = simulate(bars, scores, 1, 7, 3, 1)
        altered = scores.copy()
        altered[1:] = altered[1:, ::-1]
        _, _, after = simulate(bars, altered, 1, 7, 3, 1)
        self.assertEqual(before[0]['symbol'], after[0]['symbol'])
        self.assertEqual(before[0]['entry_price'], after[0]['entry_price'])
        self.assertEqual(before[0]['shares'], after[0]['shares'])

    def test_missing_terminal_bar_remains_unresolved(self):
        bars, scores = self.fixture(symbols=1)
        bars[3,0] = np.nan
        result, _, _ = simulate(bars, scores, 1, 3, 3, 1)
        self.assertEqual(result['unresolved_positions'], 1)

    def test_unaffordable_stock_and_empty_signals_hold_cash(self):
        bars, scores = self.fixture(symbols=1)
        bars *= 1000
        result, _, trades = simulate(bars, scores, 1, 7, 1, 3)
        self.assertEqual(result['final_value_inr'], 50000)
        self.assertEqual(trades, [])

    def test_delivery_charges_and_cost_stress(self):
        bars, scores = self.fixture(symbols=1)
        base, _, trades = simulate(bars, scores, 1, 3, 3, 1)
        stress, _, stressed_trades = simulate(bars, scores, 1, 3, 3, 1, stress=True)
        self.assertAlmostEqual(trades[0]['charges_inr'], trades[0]['notional'] * .0025 + 15.34)
        self.assertAlmostEqual(stressed_trades[0]['charges_inr'], stressed_trades[0]['notional'] * .005 + 30.68)
        self.assertLess(stress['final_value_inr'], base['final_value_inr'])
        bars /= 1000
        result, _, trades = simulate(bars, np.full_like(scores, -np.inf), 1, 7, 1, 3)
        self.assertEqual(result['final_value_inr'], 50000)
        self.assertEqual(trades, [])


if __name__ == '__main__':
    unittest.main()
