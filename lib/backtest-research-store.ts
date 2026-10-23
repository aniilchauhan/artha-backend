import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {getAxionProjectRoot} from './project-root';
import {RESEARCH_RULES,RESEARCH_HOLDS,RESEARCH_EXITS,type ResearchResult,type ResearchPayload} from './backtest-research-types';

export function parseResearchSelection(params:URLSearchParams) {
  const capital=Number(params.get('capital')??50000),stocks=Number(params.get('stocks')??3),hold=Number(params.get('hold')??20);
  const rule=params.get('rule')??'momentum20',exit=params.get('exit')??'time',period=params.get('period')??'full_period';
  if(!Number.isInteger(capital)||capital<50000||capital>1000000||capital%50000!==0||![3,4,5].includes(stocks)||!RESEARCH_HOLDS.includes(hold)||
    !RESEARCH_RULES.some(r=>r===rule)||!RESEARCH_EXITS.includes(exit)||!['full_period','validation','evaluation'].includes(period)) throw new Error('Invalid research settings.');
  return {capital,stocks,hold,rule,exit,period,key:`${capital}_${rule}_${hold}_${exit}_${stocks}_${period}`};
}
const directory=()=>path.join(getAxionProjectRoot(),'stock-ai/runs/ten-year-app-grid-20261008');
let catalogue:Promise<{rows:ResearchResult[];hashes:Record<string,string>;contract:ResearchPayload['contract'];completion:ResearchPayload['completion']}>|undefined;
async function verified(name:string,hashes:Record<string,string>) {
  const bytes=await readFile(path.join(directory(),name));
  if(!hashes[name]||createHash('sha256').update(bytes).digest('hex')!==hashes[name])throw new Error('Research artifact integrity failure.');
  return bytes;
}
async function loadCatalogue(){
  if(!catalogue)catalogue=(async()=>{
    const completion=JSON.parse(await readFile(path.join(directory(),'COMPLETE.json'),'utf8'));
    const hashes=JSON.parse(await readFile(path.join(directory(),'checksums.json'),'utf8'));
    const [rows,contract]=await Promise.all([verified('summary.json',hashes),verified('contract.json',hashes)]);
    const parsed=JSON.parse(rows.toString()) as ResearchResult[];
    if(parsed.length!==completion.rows||completion.rows!==30240)throw new Error('Incomplete research catalogue.');
    return {rows:parsed,hashes,contract:JSON.parse(contract.toString()),completion};
  })().catch(error=>{catalogue=undefined;throw error;});
  return catalogue;
}
export async function readResearchBacktest(params:URLSearchParams):Promise<ResearchPayload>{
  const selection=parseResearchSelection(params),saved=await loadCatalogue();
  const detail=JSON.parse(gunzipSync(await verified(`details/${selection.key}.json.gz`,saved.hashes)).toString());
  const comparisons=saved.rows.filter(r=>r.rule===selection.rule&&r.hold===selection.hold&&r.exit===selection.exit&&r.period===selection.period);
  return {...detail,contract:saved.contract,completion:saved.completion,comparisons};
}
export async function readResearchStatus(){
  const saved=await loadCatalogue();
  const audit=JSON.parse((await verified('data_audit.json',saved.hashes)).toString());
  return {ready:true,rows:saved.completion.rows,simulations:saved.completion.simulations,amounts:20,strategies:8,
    universeStocks:audit.symbols.length,invalidBenchmarkBars:audit.market.invalid_index_bars,liveApproved:false,
    historicalWindow:'2016-10-10 to 2026-10-07',limitations:['Current membership creates survivorship bias.','Corporate actions are not independently verified.','Nifty reference excludes dividends.','Historical and later periods have already been inspected.']};
}
