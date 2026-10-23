import { calculateSignalHash, type DecisionSignal } from './signal-schema';

export function validateSignal(value: unknown): DecisionSignal {
  const s = value as DecisionSignal;
  const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 1000;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
  if (!s || !/^[A-Z0-9&_-]{1,30}$/.test(s.symbol) || !/^[A-Za-z0-9_.-]{1,80}$/.test(s.strategyVersion) ||
      s.instrumentId !== `NSE:${s.symbol}` || !text(s.companyName) || !/^[A-Z]{2}$/.test(s.series) ||
      !date(s.dataCutoff) || !date(s.issuedAt) || !date(s.validUntil) ||
      !finite(s.referencePrice) || s.referencePrice <= 0 || !text(s.quoteSource) ||
      !['recent','delayed','historical','simulated'].includes(s.quoteStatus) ||
      !['WATCHLIST_OBSERVATION','ACTIONABLE_PAPER_SIGNAL'].includes(s.signalType) ||
      !['watching','entry_met','paper_open','review_due','invalidated','expired'].includes(s.state)) throw new Error('Invalid signal identity or provenance.');
  const fields = {
    metrics: ['resistance20d','volumeRatio','momentum5dPct','turnoverCr','atr14','atrPct'],
    conditions: ['entryTrigger','maxOpeningGap','targetScenario','invalidationStop','validitySessions','reviewSessions','rewardToRiskRatio'],
    sizing: ['portfolioCapital','riskBudgetInr','slotCapital','wholeShares','allocatedAmount','plannedRiskAmount'],
  } as const;
  for (const [key, names] of Object.entries(fields)) {
    const object = s[key as keyof typeof fields] as unknown as Record<string, unknown>;
    if (!object || names.some(name => !finite(object[name]))) throw new Error(`Invalid signal ${key}.`);
  }
  if (s.conditions.entryTrigger <= 0 || s.conditions.targetScenario <= s.conditions.entryTrigger ||
      s.conditions.invalidationStop <= 0 || s.conditions.invalidationStop >= s.conditions.entryTrigger ||
      !Number.isInteger(s.conditions.validitySessions) || s.conditions.validitySessions < 1 || s.conditions.validitySessions > 30 ||
      !Number.isInteger(s.conditions.reviewSessions) || s.conditions.reviewSessions < 1 || s.conditions.reviewSessions > 30 ||
      !Number.isInteger(s.sizing.wholeShares) || s.sizing.wholeShares < 0 || s.sizing.portfolioCapital <= 0 ||
      s.metrics.volumeRatio < 0 || s.metrics.turnoverCr < 0 || s.metrics.atr14 < 0 ||
      [s.measuredReasons,s.evidenceMissing].some(a => !Array.isArray(a) || a.length > 100 || a.some(v => !text(v))) ||
      !s.companyHoldAssessment || !['not_established','caution','supportive'].includes(s.companyHoldAssessment.status) ||
      !text(s.companyHoldAssessment.label) || !text(s.companyHoldAssessment.reason)) throw new Error('Invalid signal conditions or evidence.');
  const safe = structuredClone(s);
  safe.deduplicationKey = `${safe.strategyVersion}:${safe.instrumentId}:${safe.dataCutoff.slice(0,10)}`;
  safe.immutableHash = calculateSignalHash(safe);
  return safe;
}

export function assertSignalId(id: string) {
  if (!/^[A-Za-z0-9_-]{1,220}$/.test(id)) throw new Error('Invalid signal ID.');
}
