import type { RapidMoveCandidate } from './rapid-move-types';
import { saveSignalSnapshot } from './signal-storage';
import type { DecisionSignal } from './signal-schema';

/** Preserve dated research observations; a scan never opens a position. */
export async function persistRapidCandidate(pick: RapidMoveCandidate): Promise<string> {
  if (!pick.resistance20d) throw new Error('Resistance evidence missing.');
  const symbol = pick.ticker.replace(/\.NS$/, '');
  const atr = pick.price * pick.atrPct / 100;
  const observedAtMs = Date.parse(pick.asOf);
  if (!Number.isFinite(observedAtMs) || observedAtMs > Date.now() + 30_000) throw new Error('A valid provider observation timestamp is required.');
  const observedAt = new Date(observedAtMs);
  const cutoff = observedAt.toISOString();
  const shares = Math.max(0,Math.min(Math.floor((50000/3)/pick.entry),Math.floor(500/(pick.entry-pick.invalidation))));
  const signal: DecisionSignal = {
    id:'server_generated',deduplicationKey:'server_generated',revision:1,parentSignalId:null,
    strategyVersion:'RAPID-RADAR-RESEARCH-v1',signalType:'WATCHLIST_OBSERVATION',state:'watching',
    instrumentId:`NSE:${symbol}`,symbol,companyName:pick.name,series:pick.series || 'EQ',dataCutoff:cutoff,issuedAt:cutoff,
    validUntil:new Date(observedAt.getTime() + 96 * 60 * 60 * 1000).toISOString(),referencePrice:pick.price,quoteSource:'Yahoo Finance',quoteStatus:pick.quoteStatus ?? 'historical',
    metrics:{resistance20d:pick.resistance20d,volumeRatio:pick.volumeRatio,momentum5dPct:pick.momentum5Pct,turnoverCr:pick.turnoverCr,atr14:atr,atrPct:pick.atrPct},
    conditions:{entryTrigger:pick.entry,maxOpeningGap:pick.entry*1.025,targetScenario:pick.target,invalidationStop:pick.invalidation,
      validitySessions:1,reviewSessions:5,rewardToRiskRatio:(pick.target-pick.entry)/(pick.entry-pick.invalidation)},
    sizing:{portfolioCapital:50000,riskBudgetInr:500,slotCapital:50000/3,wholeShares:shares,allocatedAmount:shares*pick.entry,plannedRiskAmount:shares*(pick.entry-pick.invalidation)},
    measuredReasons:pick.reasons,evidenceMissing:[...pick.risks,'Research observation; not a validated strategy or an order.'],
    companyHoldAssessment:{status:'not_established',label:'Longer hold not established',reason:'Company assessment remains separate; missing filings cannot justify a longer hold.'},immutableHash:'',
  };
  return (await saveSignalSnapshot(signal)).signal.id;
}
