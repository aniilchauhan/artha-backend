"""Download isolated, identity-checked provider history; never extend history synthetically."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

import pandas as pd

BASE = Path(__file__).resolve().parents[1]
OUT = BASE/'runs/ten-year-snapshot-20261008'
START, END = '2015-07-01', '2026-10-08'

def fetch(symbol):
    errors=[]
    for host in ('query1.finance.yahoo.com','query2.finance.yahoo.com'):
        try:
            params=urllib.parse.urlencode({'period1':int(datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp()),
                'period2':int(datetime.fromisoformat(END).replace(tzinfo=timezone.utc).timestamp()),'interval':'1d','events':'div,splits'})
            req=urllib.request.Request(f'https://{host}/v8/finance/chart/{urllib.parse.quote(symbol,safe="")}?{params}',headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as response:payload=json.load(response)
            chart=payload['chart']['result'][0]
            if chart['meta']['symbol']!=symbol or chart['meta']['currency']!='INR':raise ValueError('Identity/currency mismatch')
            values=chart['indicators']['quote'][0]
            frame=pd.DataFrame({'Date':pd.to_datetime(chart['timestamp'],unit='s',utc=True).tz_convert('Asia/Kolkata').strftime('%Y-%m-%d'),
                **{name:values[name.lower()] for name in ['Open','High','Low','Close','Volume']}})
            frame=frame[frame.Date.lt(END)].sort_values('Date')
            if len(frame)<100 or frame.Date.duplicated().any():raise ValueError('Insufficient or duplicated bars')
            return symbol,frame,chart.get('events',{}),{'status':'downloaded','rows':len(frame),'first':frame.Date.min(),'last':frame.Date.max(),'host':host}
        except Exception as error:errors.append(str(error))
    return symbol,None,None,{'status':'unavailable','errors':errors}

def main():
    OUT.mkdir(exist_ok=True)
    (OUT/'snapshot/raw').mkdir(parents=True,exist_ok=True)
    (OUT/'snapshot/market').mkdir(parents=True,exist_ok=True)
    (OUT/'actions').mkdir(exist_ok=True)
    old=json.loads((BASE/'runs/selection-50k-20261008/manifest.json').read_text())
    symbols=old['contract']['universe_members']
    audit={};available=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for job in as_completed([pool.submit(fetch,symbol) for symbol in ['^NSEI',*symbols]]):
            symbol,frame,actions,info=job.result();audit[symbol]=info
            if frame is not None:
                destination=OUT/'snapshot/market/NSEI.csv' if symbol=='^NSEI' else OUT/'snapshot/raw'/f'{symbol.replace(".","_")}.csv'
                frame.to_csv(destination,index=False)
                (OUT/'actions'/f'{symbol.replace(".","_").replace("^","")}.json').write_text(json.dumps(actions,indent=2))
                if symbol!='^NSEI':available.append(symbol)
            print(symbol,info['status'],info.get('rows',0),flush=True)
    (OUT/'download_audit.json').write_text(json.dumps(audit,indent=2))
    market=audit.get('^NSEI',{})
    if market.get('status')!='downloaded' or market['first']>'2016-10-08' or market['last']<'2026-10-07':
        raise ValueError('Benchmark does not cover the requested ten-year window; do not run a ten-year claim.')
    if len(available)<30:raise ValueError('Fewer than thirty provider-verified stock histories available.')
    artifacts={str(p.relative_to(OUT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.rglob('*') if p.is_file() and p.name!='manifest.json'}
    manifest={'created_at':datetime.now(timezone.utc).isoformat(),'status':'downloaded','source':'Yahoo Finance daily chart; raw quote OHLC, no auto-adjust transformation applied by this script',
        'request':[START,END],'requested_backtest':['2016-10-08','2026-10-07'],'contract':{'universe_members':sorted(available)},'artifacts':artifacts,
        'limitations':['Current selected membership is survivor-biased, not historic index membership. IPO stocks enter only when their observed data supports the lookback.',
          'Provider corporate-action adjustment conventions are not independently verified; action events retained for audit. No total-return/dividend accounting is promised.']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
    print('Snapshot complete:',len(available),'stocks',flush=True)

if __name__=='__main__':main()
