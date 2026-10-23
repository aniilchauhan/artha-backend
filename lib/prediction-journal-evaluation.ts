import { indiaDay } from './market-quote';
import {
  JOURNAL_EVENT_RETURN, JOURNAL_MODEL_SCORE_THRESHOLD, JOURNAL_POLICY_VERSION,
} from './prediction-journal-types';
import type {
  JournalCohortSummary, JournalEntry, JournalEventStats, JournalOutcome, JournalQuote,
  JournalSelectionStats, JournalSummary,
} from './prediction-journal-types';

export { JOURNAL_POLICY_VERSION } from './prediction-journal-types';
export type { JournalEntry, JournalOutcome, JournalSummary } from './prediction-journal-types';

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const timestamp = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : NaN;
const dayOf = (value: number) => indiaDay(new Date(value));
type Bar = JournalQuote['history'][number];

function usableQuote(quote: JournalQuote | null, symbol: string, now: number): quote is JournalQuote {
  if (!quote || quote.providerSymbol !== symbol || quote.currency !== 'INR' ||
      quote.dataSource !== 'provider' || quote.isFallback || !Array.isArray(quote.history)) return false;
  const observed = timestamp(quote.quoteAsOf), fetched = timestamp(quote.fetchedAt);
  return Number.isFinite(observed) && Number.isFinite(fetched) && observed <= fetched && fetched <= now;
}

function observedBars(quote: JournalQuote): Bar[] {
  const observed = timestamp(quote.quoteAsOf);
  return quote.history.filter(bar => {
    const date = timestamp(bar.date);
    return Number.isFinite(date) && date <= observed &&
      [bar.open, bar.high, bar.low, bar.close].every(positive) &&
      bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) &&
      typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0;
  }).sort((a, b) => timestamp(a.date) - timestamp(b.date));
}

function completedBar(bar: Bar, quote: JournalQuote): boolean {
  const barDay = dayOf(timestamp(bar.date));
  const observedDay = dayOf(timestamp(quote.quoteAsOf));
  // A cached intraday candle must not turn into a finalized candle merely because time passed.
  if (barDay < observedDay) return true;
  const start = timestamp(quote.sessionStart), end = timestamp(quote.sessionEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end > start &&
    dayOf(start) === barDay && dayOf(end) === barDay && timestamp(quote.fetchedAt) >= end;
}

/** Resolve a frozen, prospective review using the next observed NIFTY session. No network or writes. */
export function evaluateJournalEntry(
  entry: JournalEntry, stockQuote: JournalQuote | null, benchmarkQuote: JournalQuote | null,
  now = Date.now(),
): JournalOutcome {
  // Both exclusions and completed results are immutable, even if provider history is revised later.
  if (entry.outcome && entry.outcome.status !== 'pending') return entry.outcome;
  const evaluatedAt = new Date(now).toISOString();
  const pending = (reason: string, targetDay?: string): JournalOutcome => ({ status: 'pending', reason, evaluatedAt, ...(targetDay ? { targetDay } : {}) });
  const excluded = (reason: string, targetDay?: string): JournalOutcome => ({ status: 'excluded', reason, evaluatedAt, ...(targetDay ? { targetDay } : {}) });
  const assessment = entry.assessment;
  const referenceTime = timestamp(assessment.context.historyAsOf);
  const generated = timestamp(assessment.generatedAt), recorded = timestamp(entry.recordedAt);
  const referencePrice = assessment.context.referencePrice;
  if (entry.policyVersion !== JOURNAL_POLICY_VERSION) return excluded('unsupported_policy');
  if (![referenceTime, generated, recorded].every(Number.isFinite) ||
      referenceTime > generated || generated > recorded || recorded > now ||
      !positive(referencePrice) || assessment.horizon !== 'next_session' ||
      assessment.ticker !== entry.ticker || assessment.context.ticker !== entry.ticker) {
    return excluded('invalid_assessment');
  }
  const referenceDay = dayOf(referenceTime);
  if (!usableQuote(benchmarkQuote, '^NSEI', now)) return pending('benchmark_unavailable');
  const benchmarkBars = observedBars(benchmarkQuote);
  const referenceBars = benchmarkBars.filter(bar => dayOf(timestamp(bar.date)) === referenceDay);
  if (referenceBars.length !== 1 || !completedBar(referenceBars[0], benchmarkQuote)) {
    return pending('reference_session_unavailable');
  }
  // The benchmark determines the day, including holidays and special weekend sessions.
  // A suspended stock cannot silently move its target to its next available candle.
  const nextBar = benchmarkBars.find(bar => dayOf(timestamp(bar.date)) > referenceDay);
  if (!nextBar) return pending('awaiting_next_session');
  const targetDay = dayOf(timestamp(nextBar.date));
  const targetOpen = timestamp(nextBar.date);
  if (benchmarkBars.filter(bar => dayOf(timestamp(bar.date)) === targetDay).length !== 1) {
    return pending('ambiguous_benchmark_session', targetDay);
  }
  if (recorded >= targetOpen || generated >= targetOpen) return excluded('recorded_after_target_open', targetDay);
  if (!completedBar(nextBar, benchmarkQuote)) return pending('awaiting_session_close', targetDay);
  if (!usableQuote(stockQuote, `${entry.ticker}.NS`, now)) return pending('stock_data_unavailable', targetDay);
  const stockReferenceBars = observedBars(stockQuote).filter(bar => dayOf(timestamp(bar.date)) === referenceDay);
  if (stockReferenceBars.length !== 1) return pending('stock_reference_unavailable', targetDay);
  if (Math.abs(stockReferenceBars[0].close - referencePrice) > Math.max(0.01, referencePrice * 0.0001)) {
    return pending('reference_price_revised_or_corporate_action', targetDay);
  }
  const targetBars = observedBars(stockQuote).filter(bar => dayOf(timestamp(bar.date)) === targetDay);
  if (targetBars.length !== 1) return pending('target_bar_unavailable', targetDay);
  const target = targetBars[0];
  if (!completedBar(target, stockQuote)) return pending('awaiting_stock_session_close', targetDay);
  return {
    status: 'completed', reason: 'next_session_observed', evaluatedAt,
    referenceDay, targetDay, targetOpenAt: new Date(targetOpen).toISOString(),
    referencePrice, targetHigh: target.high, targetClose: target.close,
    eventOccurred: target.high >= referencePrice * (1 + JOURNAL_EVENT_RETURN),
    closeReturnPercent: (target.close / referencePrice - 1) * 100,
    dataAsOf: stockQuote.quoteAsOf, fetchedAt: stockQuote.fetchedAt,
    benchmarkDataAsOf: benchmarkQuote.quoteAsOf, benchmarkFetchedAt: benchmarkQuote.fetchedAt,
  };
}

function eventStats(entries: JournalEntry[]): JournalEventStats {
  const count = entries.length;
  const eventCount = entries.filter(entry => entry.outcome?.status === 'completed' && entry.outcome.eventOccurred).length;
  return { count, eventCount, eventRate: count ? eventCount / count : null };
}

function selectionStats(entries: JournalEntry[], total: number): JournalSelectionStats {
  return { ...eventStats(entries), coverage: total ? entries.length / total : null };
}

/** Descriptive counts within each unchanged model/prompt/policy cohort, not evidence of causation. */
export function summarizeJournal(entries: JournalEntry[]): JournalSummary {
  const groups = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.policyVersion, entry.promptVersion, entry.assessment.source, entry.assessment.model]);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  const cohorts: JournalCohortSummary[] = [...groups].map(([cohortId, group]) => {
    const first = group[0];
    const completed = group.filter(entry => entry.outcome?.status === 'completed');
    const supported = completed.filter(entry => entry.assessment.verdict === 'supports_setup');
    const matched = completed.filter(entry => {
      const baseline = entry.assessment.context.baseline;
      return entry.outcome?.status === 'completed' && baseline.status === 'available' &&
        baseline.date === entry.outcome.referenceDay && typeof baseline.score === 'number' &&
        Number.isFinite(baseline.score) && baseline.score >= JOURNAL_MODEL_SCORE_THRESHOLD && baseline.score <= 1;
    });
    return {
      cohortId, policyVersion: first.policyVersion, promptVersion: first.promptVersion,
      source: first.assessment.source, model: first.assessment.model,
      total: group.length, pending: group.filter(entry => !entry.outcome || entry.outcome.status === 'pending').length,
      excluded: group.filter(entry => entry.outcome?.status === 'excluded').length, completed: completed.length,
      reviewedUniverse: eventStats(completed), aiSupported: selectionStats(supported, completed.length),
      matched: { count: matched.length, quantitative: eventStats(matched),
        aiSupported: selectionStats(matched.filter(entry => entry.assessment.verdict === 'supports_setup'), matched.length) },
    };
  });
  return {
    total: entries.length,
    pending: cohorts.reduce((sum, cohort) => sum + cohort.pending, 0),
    excluded: cohorts.reduce((sum, cohort) => sum + cohort.excluded, 0),
    completed: cohorts.reduce((sum, cohort) => sum + cohort.completed, 0), cohorts,
  };
}
