import { executeDurableDaemonCycle, getISTMarketContext } from '../lib/durable-scanner-daemon';
import { readResearchPaper, reconcileResearchPaper, researchPaperOwners } from '../lib/research-paper-workflow';
import { fetchStockQuotes } from '../lib/stock-fetcher';
import { indiaDay,isProviderStock } from '../lib/market-quote';
import {readSnapshot} from '../lib/backend-snapshots';
import type { RapidMoveBatch } from '../lib/rapid-move-types';

const base=new URL(process.env.AXION_INTERNAL_URL || 'http://127.0.0.1:3000');
if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new Error('Research worker requires a loopback application URL.');
async function runTask(){
  for(const owner of researchPaperOwners()){
    const ledger=readResearchPaper(owner);
    const symbols=[...new Set(ledger.orders.filter(o=>['pending','filled'].includes(o.status)).map(o=>o.symbol))];
    const quotes=await fetchStockQuotes(symbols.map(s=>s+'.NS'));
    const sessions=[];
    for(let i=0;i<quotes.length;i++){
      const quote=quotes[i];if(!quote||!isProviderStock(quote))throw new Error(`Missing valid paper quote for ${symbols[i]}.`);
      for(const raw of quote.history){
        const bar=raw as unknown as {date:string;open:number;high:number;low:number;close:number;volume:number};
        if(!Number.isFinite(Date.parse(bar.date)) || indiaDay(new Date(bar.date))>=indiaDay(new Date()))continue;
        if(![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite))continue;
        sessions.push({...bar,date:indiaDay(new Date(bar.date)),symbol:symbols[i]});
      }
    }
    await reconcileResearchPaper(owner,sessions);
  }
  const snapshot=await readSnapshot<RapidMoveBatch>('rapid-moves');
  if(Date.now()-Date.parse(snapshot.generatedAt)>20*60_000)throw new Error('Radar backend snapshot is stale.');
  if(snapshot.coverage.evaluated<snapshot.coverage.total)throw new Error('Paper reconciliation completed, but radar backend coverage is incomplete.');


}
async function cycle(){
  const phase=getISTMarketContext().phase;
  if(['WEEKEND','OFF_HOURS'].includes(phase))return;
  const result=await executeDurableDaemonCycle({scannerTask:runTask,maxRetries:1});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.success && process.argv.includes('--once'))process.exitCode=1;
}
async function main(){
  if(process.argv.includes('--once'))await cycle();
  else{await cycle();setInterval(()=>{void cycle().catch(error=>process.stderr.write(String(error)+'\n'));},15*60_000);}
}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
