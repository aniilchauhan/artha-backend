"""Verify published app artifacts and regress all previously tested capital profiles."""
import gzip
import hashlib
import json
import concurrent.futures
from pathlib import Path
import pandas as pd

base=Path(__file__).resolve().parents[1]
out=base/'runs/ten-year-app-grid-20261008'
complete=json.loads((out/'COMPLETE.json').read_text())
assert complete['rows']==30240 and complete['simulations']==60480
hashes=json.loads((out/'checksums.json').read_text())
def verify_hash(item):
    filename,digest=item
    assert hashlib.sha256((out/filename).read_bytes()).hexdigest()==digest,filename
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(verify_hash,hashes.items()))
rows=json.loads((out/'summary.json').read_text())
lookup={(r['capital_inr'],r['rule'],r['hold'],r['stocks'],r['period']):r for r in rows if r['exit']=='time'}
prior=pd.read_csv(base/'runs/ten-year-capital-sweep-20261008/comparison.csv')
for r in prior.to_dict('records'):
    period='full_period' if r['period']=='full_period' else r['period']
    current=lookup[(r['capital_inr'],r['rule'],r['hold'],r['stocks'],period)]
    for metric in ('final_inr','return_pct','drawdown_pct','stress_return_pct'):
        assert abs(current[metric]-r[metric])<1e-7,(current['key'],metric)
    with gzip.open(out/'details'/f"{current['key']}.json.gz",'rt',encoding='utf8') as f:detail=json.load(f)
    assert abs(r['capital_inr']+sum(t['pnl'] for t in detail['trades'])-current['final_inr'])<1e-6
    assert detail['equity'][-1]['positions']==0 and abs(detail['equity'][-1]['equity']-current['final_inr'])<1e-7
    assert all(t['signal_date']<t['entry_date']<=t['exit_date'] and isinstance(t['shares'],int) and t['shares']>0 for t in detail['trades'])
report={'artifact_hashes_verified':len(hashes),'capital_profile_regressions':len(prior),'verified':True}
(out/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
