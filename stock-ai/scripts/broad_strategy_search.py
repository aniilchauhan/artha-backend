"""Predeclared bounded strategy search. Research only; no served model changes."""
import hashlib
import json
from pathlib import Path
import sys
import time
import argparse
import gzip

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from src.clean_research_data import audit_bars

SOURCE = BASE / 'runs/selection-50k-20261008'
OUT = BASE / 'runs/broad-strategy-search-final-20261008'
HOLDS = [1, 2, 3, 4, 5, 10, 20]
EXITS = [('time', None, None), ('stop2_target4', .02, .04), ('stop3_target6', .03, .06)]
RULES = ['momentum5', 'momentum20', 'momentum60', 'trend_pullback', 'breakout20', 'breakout10', 'mean_reversion', 'low_vol_trend']


def simulate(bars, ranks, scores, start, end, hold, slots, stop, target, stress=False, capital=50000.):
    if not np.isfinite(capital) or capital <= 0:
        raise ValueError('Capital must be positive and finite')
    multiplier = 2 if stress else 1
    slip, intraday, delivery, dp = .0005 * multiplier, .001 * multiplier, .0025 * multiplier, 15.34 * multiplier
    cash, active, trades, curve = float(capital), [], [], []

    def sell(pos, raw, day, reason):
        nonlocal cash
        fee = pos['notional'] * (delivery if day > pos['entry'] else intraday) + (dp if day > pos['entry'] else 0)
        proceeds = pos['shares'] * raw * (1 - slip) - fee
        cash += proceeds
        trades.append({**pos, 'exit': day, 'exit_price': raw * (1-slip), 'fee': fee, 'reason': reason, 'pnl': proceeds-pos['notional']})

    for day in range(start, end+1):
        # All sale proceeds, including opening-gap exits, are unavailable for new entries until the next day.
        opening_cash = cash
        for pos in active[:]:
            opening = bars[day, pos['symbol'], 0]
            if stop and np.isfinite(opening) and (opening <= pos['stop'] or opening >= pos['target']):
                sell(pos, opening, day, 'gap_stop' if opening <= pos['stop'] else 'gap_target')
                active.remove(pos)
        equity = cash + sum(p['shares']*p['mark'] for p in active)
        budget = equity / slots
        if day <= end-hold+1:
            for symbol in ranks[day-1]:
                if len(active) >= slots: break
                if not np.isfinite(scores[day-1, symbol]): break
                if any(p['symbol'] == symbol for p in active): continue
                opening = bars[day, symbol, 0]
                if not np.isfinite(opening) or opening <= 0: continue
                entry = opening*(1+slip)
                reserved = sum(p['notional']*delivery+dp for p in active)
                available = max(0, min(cash, opening_cash)-reserved-dp)
                shares = int(min(budget/entry, available/(entry*(1+delivery))))
                if shares <= 0: continue
                notional = shares*entry
                cash -= notional
                opening_cash -= notional
                active.append({'symbol': int(symbol), 'entry': day, 'entry_price': entry, 'shares': shares,
                    'notional': notional, 'mark': opening, 'stop': entry*(1-stop) if stop else 0, 'target': entry*(1+target) if target else 0})
        peak_positions = len(active)
        for pos in active[:]:
            opening, high, low, closing = bars[day, pos['symbol']]
            if not np.isfinite([opening,high,low,closing]).all(): continue
            if stop and low <= pos['stop']: raw, reason = pos['stop'], 'stop'
            elif target and high >= pos['target']: raw, reason = pos['target'], 'target'
            elif day-pos['entry']+1 >= hold or day == end: raw, reason = closing, 'time'
            else:
                pos['mark'] = closing
                continue
            sell(pos, raw, day, reason)
            active.remove(pos)
        assert cash >= -1e-7 and peak_positions <= slots
        marked = sum(p['shares']*p['mark'] for p in active)
        curve.append({'session':day,'equity':cash+marked,'cash':cash,'positions':len(active),'exposure':marked/(cash+marked)})
    curve = pd.DataFrame(curve)
    equity = curve.equity.to_numpy()
    dd = equity/np.maximum.accumulate(np.r_[capital,equity])[1:]-1
    gains = sum(max(0,t['pnl']) for t in trades)
    losses = -sum(min(0,t['pnl']) for t in trades)
    if not active: assert abs(capital+sum(t['pnl'] for t in trades)-equity[-1])<1e-6
    return {'return_pct': float((equity[-1]/capital-1)*100), 'final_inr':float(equity[-1]),
        'drawdown_pct':float(dd.min()*100), 'trades':len(trades), 'win_rate_pct':float(np.mean([t['pnl']>0 for t in trades])*100) if trades else 0,
        'profit_factor':float(gains/losses) if losses else None, 'unresolved':len(active),
        'mean_exposure_pct':float(curve.exposure.mean()*100), 'fees_inr':float(sum(t['fee'] for t in trades))}, curve, trades


def main():
    global SOURCE, OUT
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ten-year',action='store_true')
    parser.add_argument('--capital-sweep',action='store_true',help='Compare two previously inspected momentum profiles across INR50k to INR10 lakh')
    parser.add_argument('--complete-grid',action='store_true',help='Publish all capital/strategy combinations and execution details for the research app')
    parser.add_argument('--grid-capital',type=int,help='One amount shard; completion published separately after all shards pass')
    args=parser.parse_args()
    ten_year=args.ten_year
    if (args.capital_sweep or args.complete_grid) and not ten_year:parser.error('Capital experiments require --ten-year')
    if ten_year:
        SOURCE=BASE/'runs/ten-year-snapshot-20261008'
        OUT=BASE/'runs/ten-year-strategy-search-audited-20261008'
        if args.capital_sweep:OUT=BASE/'runs/ten-year-capital-sweep-20261008'
        if args.complete_grid:OUT=BASE/'runs/ten-year-app-grid-20261008'
    cutoff='2026-10-07' if ten_year else '2026-10-01'
    development_years=range(2017,2022) if ten_year else (2022,2023)
    validation_start,validation_end=('2022-01-01','2023-12-31') if ten_year else ('2024-01-01','2024-12-31')
    evaluation_start='2024-01-01' if ten_year else '2025-01-01'
    OUT.mkdir(exist_ok=bool(args.complete_grid and args.grid_capital))
    started = time.time()
    manifest = json.loads((SOURCE/'manifest.json').read_text())
    for filename,digest in manifest['artifacts'].items():
        if filename.startswith('snapshot/') and hashlib.sha256((SOURCE/filename).read_bytes()).hexdigest()!=digest:
            raise ValueError('Snapshot checksum mismatch: '+filename)
    contract = {'capital_inr':50000,'universe':'frozen current core50; not point-in-time membership','rules':RULES,
        'holds':HOLDS,'sizes':[3,4,5],'exits':EXITS,'grid_configurations':len(RULES)*len(HOLDS)*len(EXITS)*3,
        'development':['2017-01-01','2021-12-31'] if ten_year else ['2022-01-01','2023-12-31'],
        'validation':[validation_start,validation_end],
        'evaluation':[evaluation_start,cutoff],'blind_holdout':False,
        'full_period_diagnostics':['2016-10-08',cutoff] if ten_year else None,
        'selection':'Rank average stressed annual development returns across all declared development years and sizes. Require >=20 trades, positive return and <=20% drawdown in every development year/size. Freeze winner before validation and evaluation. Validation cannot change it.',
        'costs':'0.05% slippage each side; 0.10% notional fee for same-session exits; 0.25% notional fee plus INR15.34 DP for overnight exits. Stress doubles all fees/slippage. Charges approximate not exact broker contract notes; no tax on profits.',
        'execution':'Prior-close signals, next-open orders, whole shares, equal slots, no leverage, no duplicates; no same-day recycling of sale proceeds. Gap stops use actual open, stop-first for ambiguous OHLC. Flat bars cannot fill. Cash earns 0%.',
        'limitations':['History previously inspected. Larger search increases selection bias; no dependable future edge established.',
          'Survivorship bias in current core50; Yahoo adjusted-price/corporate-action history not independently verified.',
          'Daily OHLC cannot prove liquidity, intraday order, circuit limits or fills; no dividends or account-specific taxes.',
          'Missing prices carry the last mark; unresolved terminal positions disqualify promotion.'],
        'fee_reference':'https://zerodha.com/charges/', 'manifest_sha256':hashlib.sha256((SOURCE/'manifest.json').read_bytes()).hexdigest(),
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (OUT/'contract.json').write_text(json.dumps(contract,indent=2))
    market_raw=pd.read_csv(SOURCE/'snapshot/market/NSEI.csv')
    if ten_year:
        # Index volume is not a stock-liquidity criterion. Preserve genuine zero-volume index closes;
        # quarantine invalid index prices explicitly rather than inventing market sessions.
        frame=market_raw.copy()
        frame['Date']=pd.to_datetime(frame.Date,errors='raise')
        if frame.Date.duplicated().any():raise ValueError('Duplicated index sessions')
        frame=frame[frame.Date.le(cutoff)].sort_values('Date').reset_index(drop=True)
        values=frame[['Open','High','Low','Close']].apply(pd.to_numeric,errors='coerce')
        valid=np.isfinite(values).all(axis=1)&values.gt(0).all(axis=1)
        valid &= values.High.ge(values[['Open','Close','Low']].max(axis=1))&values.Low.le(values[['Open','Close','High']].min(axis=1))
        valid &= frame.Close.pct_change(fill_method=None).abs().le(.4)|frame.Close.shift().isna()
        market_audit={'input_rows':len(market_raw),'accepted_rows':int(valid.sum()),'invalid_index_bars':int((~valid).sum()),
            'excluded_dates':frame.loc[~valid,'Date'].dt.strftime('%Y-%m-%d').tolist(),
            'note':'Zero/unknown index volume does not invalidate a positive coherent index OHLC observation. Invalid sessions are omitted; no missing candle is synthesized.'}
        benchmark=frame.loc[valid].reset_index(drop=True)
        contract['limitations'].append('Invalid benchmark sessions omitted and recorded; missing exchange/provider sessions may distort holding-age calculations. There is no independent exchange-calendar completeness certification.')
        (OUT/'contract.json').write_text(json.dumps(contract,indent=2))
    else:
        benchmark, market_audit = audit_bars(market_raw,cutoff,benchmark=True)
    dates = pd.DatetimeIndex(benchmark.Date)
    symbols = sorted(manifest['contract']['universe_members'])
    bars = np.full((len(dates),len(symbols),4),np.nan)
    signal_closes = np.full((len(dates),len(symbols)),np.nan)
    scores = {rule:np.full((len(dates),len(symbols)),-np.inf) for rule in RULES}
    mclose = benchmark.Close
    market_up = mclose.gt(mclose.rolling(50).mean())
    audit = {}
    for j,symbol in enumerate(symbols):
        raw,audit[symbol]=audit_bars(pd.read_csv(SOURCE/'snapshot/raw'/f"{symbol.replace('.','_')}.csv"),cutoff)
        stock = raw.set_index('Date').reindex(dates)
        signal_closes[:,j]=stock.Close.to_numpy()
        bars[:,j,:]=stock[['Open','High','Low','Close']].to_numpy()
        bars[stock.High.eq(stock.Low).to_numpy(),j,:]=np.nan
        c,v = stock.Close,stock.Volume
        valid = stock[['Open','High','Low','Close','Volume']].notna().all(axis=1).rolling(61).sum().eq(61)
        valid &= (c*v).rolling(20).mean().ge(10_000_000)
        r5,r20,r60 = [c.pct_change(n,fill_method=None) for n in (5,20,60)]
        up = c.gt(c.rolling(50).mean()) & market_up.to_numpy()
        volatility = c.pct_change(fill_method=None).rolling(20).std()
        delta = c.diff()
        gains,losses = delta.clip(lower=0).rolling(14).mean(),-delta.clip(upper=0).rolling(14).mean()
        rsi=100-100/(1+gains/losses.replace(0,np.nan))
        candidate = {
          'momentum5':(valid & r5.gt(0),r5), 'momentum20':(valid & up & r20.gt(0),r20),
          'momentum60':(valid & up & r60.gt(0),r60),
          'trend_pullback':(valid & up & r20.gt(0) & r5.between(-.06,0),r20-r5),
          'breakout20':(valid & up & c.gt(stock.High.rolling(20).max().shift(1)) & v.gt(v.rolling(20).mean()*1.5),r20),
          'breakout10':(valid & up & c.gt(stock.High.rolling(10).max().shift(1)),r20),
          'mean_reversion':(valid & market_up.to_numpy() & rsi.lt(30) & r5.lt(0),-r5),
          'low_vol_trend':(valid & up & r20.gt(0) & volatility.gt(0),-volatility)}
        for rule,(eligible,score) in candidate.items(): scores[rule][:,j]=np.where(eligible & score.notna(),score,-np.inf)
    ranks={rule:np.argsort(-matrix,axis=1,kind='stable') for rule,matrix in scores.items()}
    (OUT/'data_audit.json').write_text(json.dumps({'market':market_audit,'stocks':audit,'symbols':symbols,'dates':[str(dates[0].date()),str(dates[-1].date())]},indent=2))
    if args.complete_grid:
        (OUT/'details').mkdir(exist_ok=True)
        contract.update(capital_inr=None,capital_amounts=list(range(50000,1000001,50000)),grid_configurations=10080,
            selection='All previously defined rules; retrospective comparison only. No automatic nomination or live promotion.')
        (OUT/'contract.json').write_text(json.dumps(contract,indent=2))
        periods={'full_period':(dates>='2016-10-08'),'validation':(dates>='2022-01-01')&(dates<='2023-12-31'),'evaluation':dates>='2024-01-01'}
        rows=[]
        date_strings=dates.strftime('%Y-%m-%d').tolist()
        market_values=mclose.to_numpy()
        amounts=[args.grid_capital] if args.grid_capital else contract['capital_amounts']
        if any(c not in contract['capital_amounts'] for c in amounts):raise ValueError('Invalid grid amount')
        for capital in amounts:
            for rule in RULES:
                for hold in HOLDS:
                    for exit_name,stop,target in EXITS:
                        for slots in (3,4,5):
                            for period,mask in periods.items():
                                days=np.flatnonzero(mask);start,end=int(days[0]),int(days[-1])
                                key=f'{capital}_{rule}_{hold}_{exit_name}_{slots}_{period}'
                                existing=OUT/'details'/f'{key}.json.gz'
                                if existing.exists():
                                    try:
                                        with gzip.open(existing,'rt',encoding='utf8') as f:rows.append(json.load(f)['summary'])
                                        continue
                                    except (OSError,ValueError,EOFError):pass
                                stats,curve,trades=simulate(bars,ranks[rule],scores[rule],start,end,hold,slots,stop,target,capital=capital)
                                stress,_,_=simulate(bars,ranks[rule],scores[rule],start,end,hold,slots,stop,target,True,capital=capital)
                                key=f'{capital}_{rule}_{hold}_{exit_name}_{slots}_{period}'
                                elapsed=(dates[end]-dates[start]).days/365.25
                                row=dict(key=key,capital_inr=capital,rule=rule,hold=hold,exit=exit_name,stocks=slots,period=period,**stats,
                                    cagr_pct=((stats['final_inr']/capital)**(1/elapsed)-1)*100,
                                    stress_return_pct=stress['return_pct'],stress_drawdown_pct=stress['drawdown_pct'],
                                    benchmark_return_pct=(mclose.iloc[end]/mclose.iloc[start-1]-1)*100,start=str(dates[start].date()),end=str(dates[end].date()))
                                rows.append(row)
                                detailed=[]
                                for trade in trades:
                                    j=trade['symbol'];signal=trade['entry']-1
                                    detailed.append(dict(ticker=symbols[j],signal_date=date_strings[signal],entry_date=date_strings[trade['entry']],exit_date=date_strings[trade['exit']],
                                        shares=trade['shares'],entry_price=trade['entry_price'],exit_price=trade['exit_price'],fees=trade['fee'],pnl=trade['pnl'],exit_reason=trade['reason'],
                                        holding_sessions=trade['exit']-trade['entry']+1,selection_score=float(scores[rule][signal,j]),signal_close=float(signal_closes[signal,j])))
                                # Keep every session and every trade; compression is storage-only, not downsampling.
                                points=[dict(date=date_strings[int(p.session)],equity=p.equity,cash=p.cash,positions=int(p.positions),benchmark=capital*market_values[int(p.session)]/market_values[start-1]) for p in curve.itertuples()]
                                detail=dict(summary=row,trades=detailed,equity=points)
                                with gzip.open(OUT/'details'/f'{key}.json.gz','wt',encoding='utf8',compresslevel=1) as f:
                                    json.dump(detail,f,separators=(',',':'),allow_nan=False)
            pd.DataFrame(rows).to_csv(OUT/(f'amount_{capital}.csv' if args.grid_capital else 'comparison.csv'),index=False)
            print(f'Grid capital completed: INR {capital:,}; {len(rows)} rows',flush=True)
        if args.grid_capital:
            (OUT/f'amount_{args.grid_capital}.json').write_text(json.dumps(rows,separators=(',',':'),allow_nan=False))
            return
        (OUT/'summary.json').write_text(json.dumps(rows,separators=(',',':'),allow_nan=False))
        files={str(p.relative_to(OUT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.rglob('*') if p.is_file()}
        (OUT/'checksums.json').write_text(json.dumps(files,indent=2))
        (OUT/'COMPLETE.json').write_text(json.dumps(dict(rows=len(rows),simulations=len(rows)*2,runtime_seconds=round(time.time()-started,2),eligible_for_live_trading=False)))
        print(f'Complete: {len(rows)*2} simulations',flush=True)
        return
    if args.capital_sweep:
        rows=[]
        periods={'full_period':(dates>='2016-10-08'),'validation':(dates>='2022-01-01')&(dates<='2023-12-31'),'evaluation':dates>='2024-01-01'}
        contract.update(capital_inr=None,capital_amounts=list(range(50000,1000001,50000)),rules=['momentum20','momentum60'],holds=[20,10],exits=[('time',None,None)],grid_configurations=120,
            selection='Fixed previously inspected profiles: momentum20/20-session hold and momentum60/10-session hold. Capital sensitivity only; no new strategy selection.')
        (OUT/'contract.json').write_text(json.dumps(contract,indent=2))
        for capital in contract['capital_amounts']:
            for rule,hold in [('momentum20',20),('momentum60',10)]:
                for slots in (3,4,5):
                    for period,mask in periods.items():
                        days=np.flatnonzero(mask)
                        base,_,_=simulate(bars,ranks[rule],scores[rule],int(days[0]),int(days[-1]),hold,slots,None,None,capital=capital)
                        stress,_,_=simulate(bars,ranks[rule],scores[rule],int(days[0]),int(days[-1]),hold,slots,None,None,True,capital=capital)
                        rows.append(dict(capital_inr=capital,rule=rule,hold=hold,stocks=slots,period=period,**base,stress_return_pct=stress['return_pct'],stress_final_inr=stress['final_inr'],stress_drawdown_pct=stress['drawdown_pct']))
            print(f'Capital completed: INR {capital:,}',flush=True)
        table=pd.DataFrame(rows)
        table.to_csv(OUT/'comparison.csv',index=False)
        result={'simulations':len(rows)*2,'rows':len(rows),'runtime_seconds':round(time.time()-started,2),'eligible_for_live_trading':False,'note':'Larger capital changes rounding, fixed fees and subsequent selections; no capital-dependent liquidity/slippage model. Each period starts independently at the stated capital.'}
        (OUT/'result.json').write_text(json.dumps(result,indent=2,allow_nan=False))
        files={str(p.relative_to(OUT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file()}
        (OUT/'checksums.json').write_text(json.dumps(files,indent=2))
        print(json.dumps(result),flush=True)
        return
    profiles=[]; dev_rows=[]
    for rule in RULES:
        for hold in HOLDS:
            for exit_name,stop,target in EXITS:
                rows=[]
                for year in development_years:
                    days=np.flatnonzero(dates.year==year)
                    for slots in (3,4,5):
                        stats,_,_=simulate(bars,ranks[rule],scores[rule],int(days[0]),int(days[-1]),hold,slots,stop,target,True)
                        rows.append({'rule':rule,'hold':hold,'exit':exit_name,'stocks':slots,'year':year,**stats})
                eligible=all(r['return_pct']>0 and r['trades']>=20 and r['drawdown_pct']>=-20 and not r['unresolved'] for r in rows)
                profiles.append({'rule':rule,'hold':hold,'exit':exit_name,'stop':stop,'target':target,'eligible':eligible,'selection_score':float(np.mean([r['return_pct'] for r in rows]))})
                dev_rows+=rows
        print(f'Development completed: {rule}',flush=True)
    ordered=sorted(profiles,key=lambda p:(-p['selection_score'],p['rule'],p['hold'],p['exit']))
    qualified=[p for p in ordered if p['eligible']]
    nominee=qualified[0] if qualified else None
    explorer=ordered[0]
    frozen={'nominee':nominee,'exploratory_development_leader':explorer,'profiles':profiles}
    (OUT/'frozen_policy.json').write_text(json.dumps(frozen,indent=2))
    pd.DataFrame(dev_rows).to_csv(OUT/'development.csv',index=False)
    rows=[]; curves={}; periods={'validation':(dates>=validation_start)&(dates<=validation_end),'evaluation':(dates>=evaluation_start)}
    if ten_year:periods['full_period_diagnostic']=(dates>='2016-10-08')
    # Evaluate all frozen profiles for transparency. Never select a replacement using these outcomes.
    for period,mask in periods.items():
        days=np.flatnonzero(mask)
        for profile in profiles:
            rule=profile['rule']
            for slots in (3,4,5):
                base,curve,trades=simulate(bars,ranks[rule],scores[rule],int(days[0]),int(days[-1]),profile['hold'],slots,profile['stop'],profile['target'])
                stress,_,_=simulate(bars,ranks[rule],scores[rule],int(days[0]),int(days[-1]),profile['hold'],slots,profile['stop'],profile['target'],True)
                row={**profile,**base,'stocks':slots,'period':period,'stress_return_pct':stress['return_pct'],'stress_drawdown_pct':stress['drawdown_pct']}
                rows.append(row)
                if profile==nominee or profile==explorer:
                    tag=f"{period}_{rule}_{profile['hold']}d_{profile['exit']}_{slots}stocks"
                    curve['Date']=dates[curve.session.to_numpy()]
                    curve.to_csv(OUT/f'{tag}_equity.csv',index=False)
                    frame=pd.DataFrame(trades)
                    if trades:
                        frame['ticker']=[symbols[j] for j in frame.symbol]
                        frame['entry_date']=dates[frame.entry.to_numpy()]
                        frame['exit_date']=dates[frame['exit'].to_numpy()]
                    frame.to_csv(OUT/f'{tag}_trades.csv',index=False)
                    if period==('full_period_diagnostic' if ten_year else 'evaluation'): curves[f'{rule} {profile["hold"]}d {slots} stocks']=curve
        print(f'{period} completed: {len(days)} sessions',flush=True)
    table=pd.DataFrame(rows);table.to_csv(OUT/'comparison.csv',index=False)
    selected=table[(table.rule==explorer['rule'])&(table.hold==explorer['hold'])&(table['exit']==explorer['exit'])]
    evaluation=np.flatnonzero(periods['evaluation']);validation=np.flatnonzero(periods['validation'])
    references={name:float((mclose.iloc[days[-1]]/mclose.iloc[days[0]-1]-1)*100) for name,days in [(name,np.flatnonzero(mask)) for name,mask in periods.items()]}
    live_pass=bool(nominee) and all(r['stress_return_pct']>0 and r['trades']>=30 and not r['unresolved'] and r['stress_drawdown_pct']>=-20 for r in rows if r['period']!='full_period_diagnostic' and r['rule']==nominee['rule'] and r['hold']==nominee['hold'] and r['exit']==nominee['exit'])
    # Even a historical gate pass cannot promote an inspected, biased-universe backtest.
    result={'configurations':contract['grid_configurations'],'nominee':nominee,'exploratory_development_leader':explorer,
        'historical_gate_pass':live_pass,'eligible_for_live_trading':False,'leader_outcomes':selected.astype(object).where(pd.notna(selected),None).to_dict('records'),
        'nifty_price_references':references,'runtime_seconds':round(time.time()-started,2),
        'later_period_is_blind':False,'evaluation_start':str(dates[evaluation[0]].date()),'evaluation_end':str(dates[evaluation[-1]].date())}
    (OUT/'result.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    lines=['# Broad strategy search: INR 50,000','',f"Compared {contract['grid_configurations']} configurations: eight rules, seven holds (1/2/3/4/5/10/20 sessions), three exits, and 3/4/5 stocks.",'',
      f"Development: {contract['development']}. Frozen selection before validation {contract['validation']} and evaluation {contract['evaluation']}. All periods are retrospective; this is NOT a blind holdout. A full-period diagnostic includes fitted development history and cannot establish out-of-sample performance.",
      '',f'Qualified development nominee: {nominee}.',f'Exploratory development leader (not a live recommendation): {explorer}.','',
      '| Period | Stocks | End INR | Net return | Doubled-cost return | Drawdown | Trades |','|---|---:|---:|---:|---:|---:|---:|']
    for r in selected.to_dict('records'):
        lines.append(f"| {r['period']} | {r['stocks']} | {r['final_inr']:.0f} | {r['return_pct']:.2f}% | {r['stress_return_pct']:.2f}% | {r['drawdown_pct']:.2f}% | {r['trades']} |")
    lines+=['',f'Nifty price-only reference returns: {references}. Cash: 0%, no interest. These are price-index references, not tradable fund results.',
      '',contract['costs'],'',contract['execution'],'','Rules use only completed prior data. Stocks require 61 consecutive valid sessions and at least INR 1 crore 20-session average traded value. Momentum5 selects positive five-session strength; momentum20/60 also require stock and Nifty above SMA50. Trend pullback requires positive 20-session momentum and a five-session decline between 0% and 6%. Breakouts exceed prior 10/20-session highs (20-session version requires 1.5x average volume). Mean reversion requires RSI14 <30, negative five-session return and bullish Nifty regime. Low-volatility trend ranks eligible uptrend stocks by lowest trailing 20-session return volatility.','']
    lines+=[f'- {limit}' for limit in contract['limitations']]
    lines+=['','comparison.csv contains hindsight diagnostics. The best evaluation row must not replace the development-frozen policy. An absence of eligible strategies is a valid result, not a reason to relax gates after seeing results.']
    (OUT/'REPORT.md').write_text('\n'.join(lines),encoding='utf8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(10,5))
    for label,curve in curves.items():ax.plot(curve.Date,curve.equity,label=label)
    ax.axhline(50000,color='gray',linestyle='--',label='Cash')
    ax.set(title='Development-selected research leader: '+('ten-year retrospective equity' if ten_year else 'later-period equity'),ylabel='INR, after modeled costs')
    ax.legend(fontsize=8);fig.tight_layout();fig.savefig(OUT/'equity.png',dpi=150);plt.close(fig)
    (OUT/'checksums.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.iterdir() if p.is_file()},indent=2))
    print(json.dumps(result,indent=2),flush=True)

if __name__=='__main__':main()
