import importlib.util
from pathlib import Path
import unittest

import numpy as np

path = Path(__file__).resolve().parents[1] / 'scripts/broad_strategy_search.py'
spec = importlib.util.spec_from_file_location('broad_search', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExecutionTests(unittest.TestCase):
    def test_custom_capital_reconciles_and_no_trade_preserves_capital(self):
        bars,ranks,scores=self.fixture()
        for capital in (100000,150000,1000000):
            stats,_,trades=module.simulate(bars,ranks,scores,1,4,2,3,None,None,capital=capital)
            self.assertAlmostEqual(capital+sum(t['pnl'] for t in trades),stats['final_inr'])
            self.assertAlmostEqual((stats['final_inr']/capital-1)*100,stats['return_pct'])
        scores[:]=-np.inf
        stats,_,_=module.simulate(bars,ranks,scores,1,4,2,3,None,None,capital=150000)
        self.assertEqual(stats['final_inr'],150000)
        self.assertEqual(stats['drawdown_pct'],0)
        with self.assertRaises(ValueError):
            module.simulate(bars,ranks,scores,1,4,2,3,None,None,capital=0)

    def fixture(self):
        bars = np.tile(np.array([100.,101.,99.,100.]), (6,1,1))
        scores = np.zeros((6,1))
        ranks = np.zeros((6,1), dtype=int)
        return bars,ranks,scores

    def test_ambiguous_candle_stops_before_target_and_whole_share_reconciliation(self):
        bars,ranks,scores=self.fixture()
        bars[1,0]=[100,110,90,105]
        stats,curve,trades=module.simulate(bars,ranks,scores,1,1,1,3,.02,.04)
        self.assertEqual(trades[0]['reason'],'stop')
        self.assertEqual(trades[0]['shares'],int(trades[0]['shares']))
        self.assertLess(stats['return_pct'],0)
        self.assertAlmostEqual(50000+sum(t['pnl'] for t in trades),stats['final_inr'])

    def test_overnight_stop_gap_uses_open_and_includes_delivery_dp(self):
        bars,ranks,scores=self.fixture()
        scores[1:]=-np.inf
        bars[2,0]=[90,92,89,91]
        stats,curve,trades=module.simulate(bars,ranks,scores,1,3,3,3,.02,.04)
        self.assertEqual(trades[0]['reason'],'gap_stop')
        self.assertAlmostEqual(trades[0]['exit_price'],90*(1-.0005))
        self.assertAlmostEqual(trades[0]['fee'],trades[0]['notional']*.0025+15.34)
        self.assertEqual(stats['unresolved'],0)

    def test_invalid_terminal_bar_remains_unresolved_and_never_invents_exit(self):
        bars,ranks,scores=self.fixture()
        bars[2:]=np.nan
        stats,curve,trades=module.simulate(bars,ranks,scores,1,3,3,3,None,None)
        self.assertEqual(stats['unresolved'],1)
        self.assertEqual(len(trades),0)

    def test_cost_stress_reduces_equity_and_future_signal_cannot_enter_current_day(self):
        bars,ranks,scores=self.fixture()
        base,_,_=module.simulate(bars,ranks,scores,1,4,1,3,None,None)
        stress,_,_=module.simulate(bars,ranks,scores,1,4,1,3,None,None,True)
        self.assertLess(stress['final_inr'],base['final_inr'])
        scores[0]=-np.inf
        scores[1:]=10
        _,_,trades=module.simulate(bars,ranks,scores,1,1,1,3,None,None)
        self.assertEqual(trades,[])


if __name__=='__main__':unittest.main()
