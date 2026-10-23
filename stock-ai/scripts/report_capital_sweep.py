"""Verify and report the saved capital-sensitivity experiment."""
import hashlib
import json
from pathlib import Path
import pandas as pd

base=Path(__file__).resolve().parents[1]
out=base/'runs/ten-year-capital-sweep-20261008'
for filename,digest in json.loads((out/'checksums.json').read_text()).items():
    assert hashlib.sha256((out/filename).read_bytes()).hexdigest()==digest,filename
t=pd.read_csv(out/'comparison.csv')
assert len(t)==360 and not t.duplicated(['capital_inr','rule','stocks','period']).any()
assert t.unresolved.eq(0).all()
original=pd.read_csv(base/'runs/ten-year-strategy-search-audited-20261008/comparison.csv')
for r in t[t.capital_inr.eq(50000)].to_dict('records'):
    period='full_period_diagnostic' if r['period']=='full_period' else r['period']
    old=original[(original.rule==r['rule'])&(original.hold==r['hold'])&(original.stocks==r['stocks'])&(original.period==period)&(original['exit']=='time')].iloc[0]
    for key in ('final_inr','return_pct','drawdown_pct','stress_return_pct'):
        assert abs(r[key]-old[key])<1e-7,(r,key)
lines=['# Ten-year investment amount comparison','',
    'Tested every INR50,000 increment from INR50,000 through INR10,00,000. Two previously inspected profiles: 20-day momentum with a 20-session time exit, and 60-day momentum with a 10-session time exit. Each uses 3, 4 or 5 stock slots. These are sensitivity tests of historical candidates, not a repeat of the entire 504-strategy search and not live recommendations.','',
    '720 simulations: 20 amounts x 2 profiles x 3 portfolio sizes x 3 periods x 2 cost settings. Full period: October 10, 2016 to October 7, 2026 (2,464 valid sessions); validation: 2022–2023; evaluation: 2024–October 7, 2026. Each period starts with the stated capital independently. Capital is invested once; no contributions, withdrawals, leverage or cash interest.','',
    '## Main candidate: 20-day momentum, hold 20 sessions, 3 stocks','',
    '| Starting INR | Ending INR, ten years | Total return | Doubled-cost return | Largest drawdown | 2024–2026 return |',
    '|---:|---:|---:|---:|---:|---:|']
for r in t[(t.rule=='momentum20')&(t.stocks==3)&(t.period=='full_period')].to_dict('records'):
    recent=t[(t.rule=='momentum20')&(t.stocks==3)&(t.period=='evaluation')&(t.capital_inr==r['capital_inr'])].iloc[0]
    lines.append(f"| {r['capital_inr']:,.0f} | {r['final_inr']:,.0f} | {r['return_pct']:.2f}% | {r['stress_return_pct']:.2f}% | {r['drawdown_pct']:.2f}% | {recent.return_pct:.2f}% |")
lines+=['','Larger accounts reduce the proportional impact of the fixed INR15.34 delivery charge and whole-share rounding. Cash differences can also change later trades, so results are not simply scaled copies and do not improve monotonically. A larger amount did not remove the approximately 41% drawdown.','']
for rule,hold in [('momentum20',20),('momentum60',10)]:
    for period in ('full_period','validation','evaluation'):
        lines += [f'## {rule}, hold {hold} sessions: {period}','',
            '| Starting INR | 3 stocks return | 4 stocks return | 5 stocks return | 3 stocks doubled-cost return |','|---:|---:|---:|---:|---:|']
        subset=t[(t.rule==rule)&(t.period==period)]
        for capital in sorted(subset.capital_inr.unique()):
            s=subset[subset.capital_inr.eq(capital)].set_index('stocks')
            lines.append(f'| {capital:,.0f} | {s.loc[3,"return_pct"]:.2f}% | {s.loc[4,"return_pct"]:.2f}% | {s.loc[5,"return_pct"]:.2f}% | {s.loc[3,"stress_return_pct"]:.2f}% |')
        lines+=['']
lines+=['## Execution and limits','',
    'Prior-close signals, next-open orders, whole shares, equal stock slots, no duplicate holdings and no same-day recycling of sale proceeds. Modeling uses 0.05% slippage each side; 0.10% notional fee for same-session exits; 0.25% notional fee plus INR15.34 for overnight exits. Stress doubles these costs. Fees approximate historical broker charges; no tax on profits or dividend ledger.','',
    'Capital-dependent market impact, order-book depth and liquidity were not modeled. Larger orders could have worse real fills. Current core50 membership creates survivorship bias; corporate actions are not independently certified; invalid benchmark candles are quarantined. Full-period results include development history, and later periods were previously inspected. No amount is cleared for live trading by this experiment.','',
    'Verified all artifact hashes, all 360 output rows are unique and have no unresolved terminal positions, and every INR50,000 result matches the previous ten-year simulation. comparison.csv includes ending capital, trade counts, fees, exposure, win rates, drawdowns and stress results for all combinations.']
report=base.parent/'docs/CAPITAL_AMOUNT_BACKTEST_2026_10_08.md'
report.write_text('\n'.join(lines),encoding='utf8')
print(str(report))
print('Verified 360 rows and INR50,000 regression matches.')
