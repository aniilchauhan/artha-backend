"""Bounded, point-in-time 1–5 session research with overlapping cash positions."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))


def simulate(bars, scores, start, end, hold, slots, bracket=False, stress=False, capital=50000):
    """Signals at prior close; open entries; no recycling intraday sale proceeds.

    bars: sessions x symbols x [open, high, low, close]. Missing bars retain the
    last valuation; they never become invented fills. Positions time out on the
    first valid close at/after their maximum holding age.
    """
    multiplier = 2 if stress else 1
    slip = 0.0005 * multiplier
    intraday_fee, delivery_fee, dp_fee = 0.001 * multiplier, 0.0025 * multiplier, 15.34 * multiplier
    cash, active, trades, curve = float(capital), [], [], []

    def close_position(pos, raw_exit, day, reason):
        nonlocal cash
        overnight = day > pos['entry_session']
        charges = pos['notional'] * (delivery_fee if overnight else intraday_fee) + (dp_fee if overnight else 0)
        proceeds = pos['shares'] * raw_exit * (1 - slip) - charges
        cash += proceeds
        trades.append({**pos, 'exit_session': day, 'exit_price': raw_exit * (1 - slip),
                       'reason': reason, 'charges_inr': charges, 'pnl': proceeds - pos['notional']})

    for day in range(start, end + 1):
        # Overnight gap exits occur at the opening auction, before new entries.
        for pos in active[:]:
            opening = bars[day, pos['symbol'], 0]
            if bracket and np.isfinite(opening) and (opening <= pos['stop'] or opening >= pos['target']):
                close_position(pos, opening, day, 'gap_stop' if opening <= pos['stop'] else 'gap_target')
                active.remove(pos)
        # Value before entry using previous completed closes, plus realized cash.
        equity_before = cash + sum(p['shares'] * p['mark'] for p in active)
        budget = equity_before / slots
        if day <= end - hold + 1:
            ranked = sorted(range(scores.shape[1]), key=lambda j: (-scores[day - 1, j], j))
            for symbol in ranked:
                if len(active) >= slots:
                    break
                if not np.isfinite(scores[day - 1, symbol]) or any(p['symbol'] == symbol for p in active):
                    continue
                opening = bars[day, symbol, 0]
                if not np.isfinite(opening) or opening <= 0:
                    continue
                entry = opening * (1 + slip)
                reserved = sum(p['notional'] * delivery_fee + dp_fee for p in active)
                available = max(0, cash - reserved - dp_fee)
                shares = int(min(budget / entry, available / (entry * (1 + delivery_fee))))
                if shares <= 0:
                    continue
                notional = shares * entry
                cash -= notional
                active.append({'symbol': symbol, 'entry_session': day, 'entry_price': entry,
                               'shares': shares, 'notional': notional, 'mark': opening,
                               'stop': entry * 0.98, 'target': entry * 1.04})
        peak_positions = len(active)
        # Intraday stops precede targets when the candle cannot establish order.
        for pos in active[:]:
            opening, high, low, closing = bars[day, pos['symbol']]
            if not np.isfinite([opening, high, low, closing]).all():
                continue
            reason, exit_price = None, None
            if bracket and low <= pos['stop']:
                reason, exit_price = 'stop', pos['stop']
            elif bracket and high >= pos['target']:
                reason, exit_price = 'target', pos['target']
            elif day - pos['entry_session'] + 1 >= hold or day == end:
                reason, exit_price = 'time', closing
            if reason:
                close_position(pos, exit_price, day, reason)
                active.remove(pos)
            else:
                pos['mark'] = closing
        assert cash >= -1e-7 and len(active) <= slots and peak_positions <= slots
        equity = cash + sum(p['shares'] * p['mark'] for p in active)
        curve.append({'session': day, 'equity': equity, 'cash': cash, 'open_positions': len(active), 'peak_positions': peak_positions})
    # Missing terminal bars cannot be liquidated synthetically.
    unresolved = len(active)
    curve = pd.DataFrame(curve)
    equity = curve.equity.to_numpy()
    drawdown = equity / np.maximum.accumulate(np.r_[capital, equity])[1:] - 1
    result = {'hold_days': hold, 'stocks': slots, 'bracket': bracket, 'final_value_inr': float(equity[-1]),
              'return_pct': float((equity[-1] / capital - 1) * 100), 'max_drawdown_pct': float(drawdown.min() * 100),
              'trades': len(trades), 'win_rate_pct': float(np.mean([t['pnl'] > 0 for t in trades]) * 100) if trades else None,
              'unresolved_positions': unresolved, 'sessions': len(curve)}
    if not active:
        assert abs(capital + sum(t['pnl'] for t in trades) - equity[-1]) < 1e-6
    return result, curve, trades


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=str(BASE / 'runs/selection-50k-20261008'))
    parser.add_argument('--output', default=str(BASE / 'runs/short-holds-20261008'))
    args = parser.parse_args()
    source, out = Path(args.source).resolve(), Path(args.output).resolve()
    if not out.is_relative_to(BASE / 'runs'):
        raise ValueError('Output must be an isolated research run')
    out.mkdir(exist_ok=False)
    manifest = json.loads((source / 'manifest.json').read_text())
    for name, digest in manifest['artifacts'].items():
        if name.startswith('snapshot/') and hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Source mismatch: {name}')
    contract = {'capital_inr': 50000, 'holding_sessions': [1,2,3,4,5], 'position_counts': [3,4,5],
                'rules': ['momentum', 'trend_momentum', 'trend_pullback'], 'exits': ['time_only', 'stop2_target4'],
                'development': ['2024-01-01','2024-12-31'], 'evaluation': ['2025-01-01','2026-10-01'],
                'nomination': 'Average stressed development return across all three sizes; minimum 50 trades and positive stressed return at every size; unresolved positions disqualify.',
                'execution': 'Prior-close signals, next-open entry, integer shares, equal equity slots, no duplicate stock, no leverage, intraday cash recycled only next session. Opening gap exits fill at actual open; ambiguous candle stop first. Terminal positions liquidated at valid last close.',
                'cost_assumptions': '0.05% slippage each side; same-session exits use 0.10% roundtrip fees; overnight exits use 0.25% roundtrip fees plus INR 15.34 DP per stock sale. Stress doubles all charges and slippage. Fee buffers reserved at entry. Proportional fees are conservative approximations, not exact historical broker quotes.',
                'fee_reference': 'https://zerodha.com/charges/ (checked 2026-10-08: delivery STT 0.1% each side; DP INR 15.34 per sold scrip).',
                'limitations': ['Previously inspected historical prices; no blind/prospective performance claim.', 'Current core50 membership has survivorship bias.', 'Cached price adjustments and corporate actions are not independently verified.', 'Daily candles cannot establish intraday fills; no interest, dividends or tax-on-profit accounting.'],
                'source_manifest_sha256': hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(),
                'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (out/'contract.json').write_text(json.dumps(contract, indent=2))
    from src.clean_research_data import audit_bars
    benchmark, _ = audit_bars(pd.read_csv(source/'snapshot/market/NSEI.csv'), '2026-10-01', benchmark=True)
    dates = pd.DatetimeIndex(benchmark.Date)
    symbols = sorted(manifest['contract']['universe_members'])
    bars = np.full((len(dates), len(symbols), 4), np.nan)
    momentum = np.full((len(dates), len(symbols)), -np.inf)
    trend = momentum.copy()
    pullback = momentum.copy()
    market_close = benchmark.Close.to_numpy()
    market_trend = benchmark.Close.gt(benchmark.Close.rolling(50).mean()).to_numpy()
    market_ret20 = benchmark.Close.pct_change(20).to_numpy()
    audit = {}
    for j, ticker in enumerate(symbols):
        raw, audit[ticker] = audit_bars(pd.read_csv(source/'snapshot/raw'/f"{ticker.replace('.', '_')}.csv"), '2026-10-01')
        stock = raw.set_index('Date').reindex(dates)
        bars[:,j,:] = stock[['Open','High','Low','Close']].to_numpy()
        close = stock.Close
        valid = stock[['Open','High','Low','Close','Volume']].notna().all(axis=1).rolling(51).sum().eq(51)
        ret20, ret5 = close.pct_change(20, fill_method=None), close.pct_change(5, fill_method=None)
        # Trailing average traded value is an entry-time liquidity filter.
        liquid = (close * stock.Volume).rolling(20).mean().ge(10_000_000)
        eligible = valid & liquid
        score = ret20.to_numpy() - market_ret20
        momentum[:,j] = np.where(eligible, score, -np.inf)
        trending = eligible & close.gt(close.rolling(50).mean()) & ret20.gt(0) & market_trend
        trend[:,j] = np.where(trending, score, -np.inf)
        pullback[:,j] = np.where(trending & ret5.lt(0), score, -np.inf)
    scores_by_rule = {'momentum': momentum, 'trend_momentum': trend, 'trend_pullback': pullback}
    dev = np.flatnonzero((dates >= '2024-01-01') & (dates <= '2024-12-31'))
    test = np.flatnonzero(dates >= '2025-01-01')
    profiles = []
    dev_rows = []
    for rule, scores in scores_by_rule.items():
        for hold in range(1,6):
            for bracket in (False, True):
                stats = [simulate(bars,scores,int(dev[0]),int(dev[-1]),hold,n,bracket,True)[0] for n in (3,4,5)]
                eligible = all(s['trades']>=50 and s['return_pct']>0 and s['unresolved_positions']==0 for s in stats)
                profile = {'rule':rule,'hold_days':hold,'bracket':bracket,'eligible':eligible,
                           'selection_score':float(np.mean([s['return_pct'] for s in stats]))}
                profiles.append(profile)
                dev_rows.extend([{**s,'rule':rule,'eligible':eligible} for s in stats])
    finalists = sorted([p for p in profiles if p['eligible']], key=lambda p:(-p['selection_score'],p['rule'],p['hold_days'],p['bracket']))
    nominee = finalists[0] if finalists else None
    # Freeze both the overall policy and each duration's development winner.
    duration_nominees = {str(h): next((p for p in finalists if p['hold_days']==h), None) for h in range(1,6)}
    frozen = {'nominee':nominee,'duration_nominees':duration_nominees,'development_profiles':profiles}
    (out/'frozen_policy.json').write_text(json.dumps(frozen,indent=2))
    pd.DataFrame(dev_rows).to_csv(out/'development.csv',index=False)
    rows, diagnostics = [], []
    for hold in range(1,6):
        policy = duration_nominees[str(hold)]
        scores = scores_by_rule[policy['rule']] if policy else np.full_like(momentum,-np.inf)
        for n in (3,4,5):
            result, curve, trades = simulate(bars,scores,int(test[0]),int(test[-1]),hold,n,policy['bracket'] if policy else False)
            stressed = simulate(bars,scores,int(test[0]),int(test[-1]),hold,n,policy['bracket'] if policy else False,True)[0]
            rows.append({**result,'rule':policy['rule'] if policy else 'cash','stress_return_pct':stressed['return_pct']})
            curve['Date'] = dates[curve.session.to_numpy()]
            curve.to_csv(out/f'equity_{hold}d_{n}stocks.csv',index=False)
            trade_frame=pd.DataFrame(trades)
            if trades:
                trade_frame['ticker']=[symbols[j] for j in trade_frame.symbol]
                trade_frame['entry_date']=dates[trade_frame.entry_session.to_numpy()]
                trade_frame['exit_date']=dates[trade_frame.exit_session.to_numpy()]
            trade_frame.to_csv(out/f'trades_{hold}d_{n}stocks.csv',index=False)
    # All profiles shown as diagnostics, never used to change frozen decisions.
    for profile in profiles:
        for n in (3,4,5):
            stats,_,_ = simulate(bars,scores_by_rule[profile['rule']],int(test[0]),int(test[-1]),profile['hold_days'],n,profile['bracket'])
            diagnostics.append({**stats,'rule':profile['rule'],'development_eligible':profile['eligible']})
    pd.DataFrame(rows).to_csv(out/'comparison.csv',index=False)
    pd.DataFrame(diagnostics).to_csv(out/'diagnostics.csv',index=False)
    reference = float((market_close[test[-1]]/market_close[test[0]-1]-1)*100)
    result={'nominee':nominee,'duration_nominees':duration_nominees,'results':rows,
            'evaluation_start':str(dates[test[0]].date()),'evaluation_end':str(dates[test[-1]].date()),
            'nifty_price_return_pct_reference_only':reference,'eligible_for_live_trading':False}
    (out/'result.json').write_text(json.dumps(result,indent=2))
    (out/'data_audit.json').write_text(json.dumps(audit,indent=2))
    lines=['# INR 50,000: 1–5 trading-day holding comparison','',f"Evaluation: {result['evaluation_start']} to {result['evaluation_end']}. Development: calendar 2024.",'',
           'Rules: rank trailing 20-session return relative to Nifty; optionally require both stock and Nifty above their trailing 50-session averages; optionally require a negative trailing 5-session stock return (pullback). Require 51 contiguous valid bars and INR 1 crore trailing average daily traded value. Universe: current core50, not historical membership.','',
           'Thirty profiles were compared on development data only: three selection rules, five holding durations, and timed exits versus 2% stop/4% target. Each profile was assessed at all three position counts. A positive doubled-cost development return and at least 50 trades at every size are required. This does not guarantee future profits.','',
           f"Overall development nominee: {nominee}.",'', '| Hold (trading days) | Stocks | Frozen rule | Final INR | Net return | Stress return | Max drawdown | Trades |','|---|---:|---|---:|---:|---:|---:|---:|']
    for r in rows:
        lines.append(f"| {r['hold_days']} | {r['stocks']} | {r['rule']} | {r['final_value_inr']:.0f} | {r['return_pct']:.2f}% | {r['stress_return_pct']:.2f}% | {r['max_drawdown_pct']:.2f}% | {r['trades']} |")
    lines += ['',f'Nifty price index reference: {reference:.2f}%, before fund fees/tracking error; this is not an investable whole-share portfolio.','',contract['execution'],'',contract['cost_assumptions'],'']+[f'- {x}' for x in contract['limitations']]
    lines += ['','Duration rows use their own development-frozen policy; only the overall nominee was selected before evaluation. Choosing a different duration from evaluation results would be hindsight. If a duration has no eligible policy, it stays cash; that is not a profitable forecast. diagnostics.csv contains ungated historical outcomes and must not select the production strategy.']
    (out/'REPORT.md').write_text('\n'.join(lines),encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(9,5))
    for h in range(1,6):
        c=pd.read_csv(out/f'equity_{h}d_5stocks.csv',parse_dates=['Date'])
        ax.plot(c.Date,c.equity,label=f'{h} day maximum')
    ax.set(title='Development-frozen policies: INR 50,000 / 5 positions',ylabel='Portfolio value (INR)')
    ax.legend();fig.tight_layout();fig.savefig(out/'equity_comparison.png',dpi=150);plt.close(fig)
    checks={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}
    (out/'checksums.json').write_text(json.dumps(checks,indent=2))
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
