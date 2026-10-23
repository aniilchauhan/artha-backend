"""Explain duration sensitivity for the best development-only diagnostic rule."""
import hashlib
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1] / 'runs/short-holds-delivery-costs-20261008'
checks = json.loads((ROOT/'checksums.json').read_text())
assert all(hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest for name,digest in checks.items())
frozen = json.loads((ROOT/'frozen_policy.json').read_text())
# This choice uses only stored development scores. No evaluation ranking.
best = sorted(frozen['development_profiles'], key=lambda p:(-p['selection_score'],p['rule'],p['hold_days'],p['bracket']))[0]
diagnostics = pd.read_csv(ROOT/'diagnostics.csv')
selected = diagnostics.loc[(diagnostics.rule==best['rule']) & (diagnostics.bracket==best['bracket'])].copy()
selected.to_csv(ROOT/'duration_sensitivity.csv',index=False)
returns=selected.pivot(index='hold_days',columns='stocks',values='return_pct')
values=selected.pivot(index='hold_days',columns='stocks',values='final_value_inr')
lines=['# Holding-period comparison after delivery costs','',
       'INR 50,000 initial capital. Evaluation: 1 January 2025 to 1 October 2026 (434 sessions). Development: calendar 2024. This history was previously inspected; it is not prospective validation.','',
       f"The highest development score belonged to {best['rule']}, maximum {best['hold_days']} days, bracket={best['bracket']}. Even this candidate FAILED development eligibility. The following sensitivity table holds its selection rule and exit type constant while comparing durations; it does not nominate a live strategy.",'',
       'Rule: enter a liquid stock with positive trailing 20-day momentum, above its 50-day average, during a positive Nifty trend, after a negative trailing 5-day return. Rank by relative 20-day momentum. Entry is next open; exit is the holding-period close. Timed-exit variants have no protective stop, so daily closing drawdowns do not capture every intraday risk.','',
       '| Maximum trading days | 3 stocks return | 4 stocks return | 5 stocks return |','|---|---:|---:|---:|']
for h,row in returns.iterrows():
    lines.append(f'| {h} | {row[3]:.2f}% | {row[4]:.2f}% | {row[5]:.2f}% |')
lines += ['','| Maximum trading days | 3 stocks final INR | 4 stocks final INR | 5 stocks final INR |','|---|---:|---:|---:|']
for h,row in values.iterrows():
    lines.append(f'| {h} | {row[3]:.0f} | {row[4]:.0f} | {row[5]:.0f} |')
lines += ['','Longer holds reduced turnover and losses for this rule, but no duration produced a profit. Changing duration does not validate an edge. None of the 30 tested profiles passed positive doubled-cost development P&L at all sizes. The gated portfolios therefore held cash.',
          '', 'Costs: 0.05% slippage each side; 0.10% roundtrip same-day fees; 0.25% roundtrip overnight fees plus INR 15.34 DP per stock sale. Stress doubles costs and slippage. These are modeled approximations informed by [Zerodha charges](https://zerodha.com/charges/), checked 8 October 2026.',
          '', 'Whole shares, equal equity slots, actual overlap, idle cash, no duplicate holdings, no leverage and no intraday cash recycling. Current core50 membership has survivor bias. Price adjustments/corporate actions are not independently verified. Returns exclude dividends, cash interest and tax on profits.',
          '', 'REPORT.md records eligibility, comparison.csv records gated portfolios, development.csv records development outcomes, and diagnostics.csv records all ungated profiles.']
(ROOT/'HOLDING_COMPARISON.md').write_text('\n'.join(lines),encoding='utf-8')
print(returns.round(2).to_string())
print(values.round(2).to_string())
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig,ax=plt.subplots(figsize=(8,4))
for n in (3,4,5):
    ax.plot(returns.index,returns[n],marker='o',label=f'{n} positions')
ax.axhline(0,color='black',linestyle='--')
ax.set(title='Same pullback rule: longer holds reduced losses',xlabel='Maximum holding sessions',ylabel='Net historical return (%)',xticks=[1,2,3,4,5])
ax.legend();fig.tight_layout();fig.savefig(ROOT/'holding_returns.png',dpi=150);plt.close(fig)
checks.update({name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['HOLDING_COMPARISON.md','duration_sensitivity.csv','holding_returns.png']})
(ROOT/'checksums.json').write_text(json.dumps(checks,indent=2))
