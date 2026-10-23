import sys
import unittest
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.reconcile_outcomes import resolve_daily_outcome
from scripts.reconcile_swing_outcomes import reconcile_setup


class ReconciliationTests(unittest.TestCase):
    def test_daily_outcome_uses_observed_ohlc_and_stop_first(self):
        prediction = {'target_pct': 0.02, 'stop_pct': 0.02}
        status, exit_price = resolve_daily_outcome(
            prediction, {'Open': 100, 'High': 103, 'Low': 98, 'Close': 101}
        )
        self.assertEqual(status, 'STOP_HIT')
        self.assertEqual(exit_price, 98)

    def test_daily_outcome_uses_close_for_unresolved_session(self):
        prediction = {'target_pct': 0.02, 'stop_pct': 0.02}
        status, exit_price = resolve_daily_outcome(
            prediction, {'Open': 100, 'High': 101, 'Low': 99, 'Close': 100.5}
        )
        self.assertEqual(status, 'TIME_EXIT')
        self.assertEqual(exit_price, 100.5)

    def setup_signal(self):
        return dict(symbol='TEST', signalDate='2026-01-01', status='watching',
                    triggerPrice=100, targetPrice=110, stopPrice=95)

    def bars(self, rows):
        return pd.DataFrame([dict(Date=date, Open=o, High=h, Low=l, Close=c)
                             for date, o, h, l, c in rows])

    def test_trailing_stop_activates_on_following_bar(self):
        bars = self.bars([('2026-01-02', 100, 107, 99, 106),
                          ('2026-01-05', 105, 106, 99, 100)])
        first = reconcile_setup(self.setup_signal(), bars.iloc[:1])
        self.assertEqual(first['status'], 'active')
        result = reconcile_setup(first, bars)
        self.assertEqual(result['exitDate'], '2026-01-05')
        self.assertAlmostEqual(result['exitPrice'], result['entryPrice'] * 1.0015)

    def test_delayed_entry_ignores_pre_entry_stop(self):
        result = reconcile_setup(self.setup_signal(), self.bars([
            ('2026-01-02', 94, 99, 90, 98),
            ('2026-01-05', 100, 102, 99, 101)]))
        self.assertEqual(result['status'], 'active')
        self.assertEqual(result['entryDate'], '2026-01-05')

    def test_gap_entry_recalculates_target_and_is_idempotent(self):
        bars = self.bars([('2026-01-02', 102, 111, 100, 110)])
        result = reconcile_setup(self.setup_signal(), bars)
        self.assertEqual(result['status'], 'active')
        self.assertAlmostEqual(result['targetPrice'], 102 * 1.0005 * 1.1)
        self.assertEqual(reconcile_setup(result, bars), result)

    def test_conflicting_entry_bar_is_stop_first_without_pre_entry_gap_fill(self):
        result = reconcile_setup(self.setup_signal(), self.bars([
            ('2026-01-02', 90, 115, 89, 110)]))
        self.assertEqual(result['status'], 'stopped')
        self.assertEqual(result['exitPrice'], result['stopPrice'])

    def test_gap_stop_and_terminal_idempotence(self):
        bars = self.bars([('2026-01-02', 100, 102, 99, 101),
                          ('2026-01-05', 90, 92, 89, 91)])
        result = reconcile_setup(self.setup_signal(), bars)
        self.assertEqual(result['exitPrice'], 90)
        self.assertAlmostEqual(result['netReturnPct'], 90/result['entryPrice']-1-.0015, places=6)
        self.assertEqual(reconcile_setup(result, bars), result)

    def test_expiry_and_excessive_gap(self):
        bars = self.bars([(f'2026-01-0{i}', 98, 99, 96, 98) for i in (2, 3, 4)])
        self.assertEqual(reconcile_setup(self.setup_signal(), bars)['status'], 'expired')
        bars = self.bars([('2026-01-02', 104, 105, 103, 104)])
        self.assertEqual(reconcile_setup(self.setup_signal(), bars)['status'], 'skipped_gap_too_large')

    def test_twenty_session_deadline(self):
        dates = pd.bdate_range('2026-01-02', periods=21)
        bars = self.bars([(d, 100, 102, 99, 101) for d in dates])
        result = reconcile_setup(self.setup_signal(), bars)
        self.assertEqual(result['status'], 'time_exit')
        self.assertEqual(result['daysHeld'], 20)

    def test_legacy_active_requires_entry_date(self):
        signal = self.setup_signal()
        signal.update(status='active', entryPrice=100)
        with self.assertRaisesRegex(ValueError, 'entryDate'):
            reconcile_setup(signal, self.bars([('2026-01-02', 100, 101, 99, 100)]))


if __name__ == '__main__':
    unittest.main()
