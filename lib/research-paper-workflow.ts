import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAxionProjectRoot } from './project-root';
import { getSignalById } from './signal-storage';
import { calculateSignalHash } from './signal-schema';
import { validateSignal } from './signal-validation';
import { createPaperPortfolio, submitPaperOrder, evaluateSessionMarket, recalculatePortfolioSummary, applyEvent, type PaperEvent } from './paper-position-state-machine';

function ledgerPath(owner: string) {
  const dir = path.resolve(process.env.AXION_RESEARCH_PAPER_DIR || path.join(getAxionProjectRoot(),'.axion','research-paper'));
  fs.mkdirSync(dir,{recursive:true});
  const key = /^storage:[a-f0-9]{64}$/.test(owner) ? owner.slice(8) : crypto.createHash('sha256').update(owner).digest('hex');
  return path.join(dir,key+'.json');
}
function load(owner: string) {
  const file=ledgerPath(owner), portfolio=createPaperPortfolio();
  if (fs.existsSync(file)) {
    const saved=JSON.parse(fs.readFileSync(file,'utf8')) as {events:PaperEvent[];marks:typeof portfolio.marketMarks;reviews?:Record<string,{holdingSessions?:number;lastEvaluatedSession?:string}>};
    for(const event of saved.events) applyEvent(portfolio,event);
    portfolio.marketMarks=saved.marks;
    for(const [id,review] of Object.entries(saved.reviews ?? {})) if(portfolio.orders[id]) Object.assign(portfolio.orders[id],review);
  }
  return portfolio;
}
export function readResearchPaper(owner: string) {
  const portfolio=load(owner);
  return {summary:recalculatePortfolioSummary(portfolio),orders:Object.values(portfolio.orders),events:portfolio.events,marks:portfolio.marketMarks,
    initialCapital:portfolio.initialCapital,maxPositions:portfolio.maxPositions,
    limitation:'Research paper simulation only. Daily OHLC cannot prove real fills. No broker orders. Unmarked positions retain cost basis. Radar paper results are separate from historical momentum backtests.'};
}
async function mutate(owner: string, operation:(portfolio:ReturnType<typeof createPaperPortfolio>)=>Promise<void>) {
  const file=ledgerPath(owner),lock=file+'.lock';
  fs.mkdirSync(lock); // Fail closed on simultaneous writer; never steal a live lock.
  try {
    const portfolio=load(owner); await operation(portfolio);
    const temp=file+'.'+crypto.randomUUID()+'.tmp';
    const reviews=Object.fromEntries(Object.values(portfolio.orders).map(o=>[o.id,{holdingSessions:o.holdingSessions,lastEvaluatedSession:o.lastEvaluatedSession}]));
    fs.writeFileSync(temp,JSON.stringify({events:portfolio.events,marks:portfolio.marketMarks,reviews}),{flag:'wx'});
    fs.renameSync(temp,file);
    return readResearchPaper(owner);
  } finally {fs.rmdirSync(lock);}
}
export async function proposeResearchPaper(owner: string, signalId: string, days: number, now = new Date()) {
  if (![1,2,3,4,5].includes(days)) throw new Error('Choose 1–5 trading sessions.');
  const signal=await getSignalById(signalId);
  if(!signal || signal.strategyVersion !== 'RAPID-RADAR-RESEARCH-v1' || signal.series!=='EQ' || now.getTime()-Date.parse(signal.dataCutoff)>96*3600000 || Date.parse(signal.dataCutoff)>now.getTime()) throw new Error('Recent stored EQ-series radar evidence required. Restricted/SME series cannot use this whole-share paper model.');
  const checked=validateSignal(signal);
  if(checked.immutableHash!==signal.immutableHash||Date.parse(signal.issuedAt)>now.getTime())throw new Error('Stored signal integrity or issue time is invalid.');
  return mutate(owner,async portfolio=>{
    const proposed={...signal,signalType:'ACTIONABLE_PAPER_SIGNAL' as const,validUntil:new Date(now.getTime()+7*86400000).toISOString(),
      conditions:{...signal.conditions,reviewSessions:days}};
    proposed.immutableHash=calculateSignalHash(proposed);
    const result=submitPaperOrder(portfolio,proposed,now.toISOString(),signal);
    if(!result.success) throw new Error(result.error);
  });
}
export async function reconcileResearchPaper(owner: string, sessions: Parameters<typeof evaluateSessionMarket>[1][]) {
  return mutate(owner,async portfolio=>{
    for(const session of [...sessions].sort((a,b)=>a.date.localeCompare(b.date))) {
      // Process each observed session once; do not move marks backwards on retry.
      if((portfolio.marketMarks?.[session.symbol]?.asOf ?? '')>=session.date) continue;
      evaluateSessionMarket(portfolio,session);
    }
  });
}
export function researchPaperOwners(): string[] {
  // Hashed tenant filenames are storage IDs usable by the worker without exposing account names.
  const dir=path.dirname(ledgerPath('directory-probe'));
  return fs.readdirSync(dir).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>'storage:'+f.slice(0,-5));
}
