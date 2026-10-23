"""Run independent capital shards with four local processes, verify, then publish."""
import concurrent.futures
import hashlib
import json
import subprocess
import sys
import time
import argparse
from pathlib import Path
import pandas as pd

base=Path(__file__).resolve().parents[1]
out=base/'runs/ten-year-app-grid-20261008'

def run(capital):
    command=[sys.executable,str(base/'scripts/broad_strategy_search.py'),'--ten-year','--complete-grid','--grid-capital',str(capital)]
    result=subprocess.run(command,capture_output=True,text=True)
    if result.returncode:raise RuntimeError(f'INR{capital} failed: {result.stderr[-2000:]}')
    return capital

def main():
    started=time.time()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish-only',action='store_true',help='Verify existing completed amount shards without rerunning simulations')
    args=parser.parse_args()
    if not args.publish_only:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for future in concurrent.futures.as_completed([pool.submit(run,c) for c in range(50000,1000001,50000)]):
                print(f'Amount verified: INR {future.result():,}',flush=True)
    rows=[]
    for capital in range(50000,1000001,50000):
        shard=json.loads((out/f'amount_{capital}.json').read_text())
        assert len(shard)==1512 and all(r['capital_inr']==capital for r in shard)
        rows.extend(shard)
    assert len(rows)==30240 and len({r['key'] for r in rows})==30240
    assert all(r['unresolved']==0 for r in rows)
    original=pd.read_csv(base/'runs/ten-year-strategy-search-audited-20261008/comparison.csv')
    old={(r['rule'],r['hold'],r['exit'],r['stocks'],r['period']):r for r in original.to_dict('records')}
    for r in rows:
        if r['capital_inr']!=50000:continue
        period='full_period_diagnostic' if r['period']=='full_period' else r['period']
        prior=old[(r['rule'],r['hold'],r['exit'],r['stocks'],period)]
        for metric in ('return_pct','final_inr','drawdown_pct','stress_return_pct'):
            assert abs(r[metric]-prior[metric])<1e-7,(r['key'],metric)
    pd.DataFrame(rows).to_csv(out/'comparison.csv',index=False)
    (out/'summary.json').write_text(json.dumps(rows,separators=(',',':'),allow_nan=False))
    paths=[p for p in out.rglob('*') if p.is_file() and p.name not in ('checksums.json','COMPLETE.json','verification.json')]
    def hash_file(p):return str(p.relative_to(out)).replace('\\','/'),hashlib.sha256(p.read_bytes()).hexdigest()
    files={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for filename,digest in pool.map(hash_file,paths):
            files[filename]=digest
            if len(files)%5000==0:print(f'Artifact hashes verified: {len(files):,}/{len(paths):,}',flush=True)
    (out/'checksums.json').write_text(json.dumps(files,indent=2))
    complete=dict(rows=len(rows),simulations=len(rows)*2,runtime_seconds=round(time.time()-started,2),runtime_scope='publication_only' if args.publish_only else 'simulation_and_publication',eligible_for_live_trading=False,verified_50k_regression=True)
    (out/'COMPLETE.json').write_text(json.dumps(complete,indent=2))
    print(json.dumps(complete),flush=True)

if __name__=='__main__':main()
