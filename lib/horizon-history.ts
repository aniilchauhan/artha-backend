import { createHash } from 'node:crypto';
import connectToDatabase from './mongodb';
import HorizonPrediction from '../models/HorizonPrediction';
import type { HorizonAssessment, ResearchHorizon } from './framework-types';
import { indiaDay } from './market-quote';

export type HorizonOutcome = { status: 'pending' | 'right' | 'wrong' | 'unscorable'; reason: string; evaluatedAt: string; returnPercent?: number; benchmarkReturnPercent?: number; relativeReturnPercent?: number; entryPrice?: number; dataAsOf?: string; deadline?: string };
const sessions: Partial<Record<ResearchHorizon, number>> = { week: 5, month: 21 };
const version = 'horizon-entry-aware-v2';
const legacyVersion = 'horizon-end-close-v1';

export function horizonPredictionId(ownerId: string, ticker: string, horizon: ResearchHorizon, inputSession: string, ruleVersion = version) {
  return createHash('sha256').update(JSON.stringify([ownerId, ticker, horizon, inputSession, ruleVersion])).digest('hex');
}

export async function saveHorizonPrediction(ownerId: string, ticker: string, assessment: HorizonAssessment) {
  if (assessment.status !== 'candidate' || !assessment.referencePrice || (assessment.horizon !== 'multibagger' && !assessment.benchmarkReferencePrice)) return { status: 'not_issued', message: 'No directional horizon candidate was issued; this assessment is not counted as a prediction.' };
  const record = new Date(assessment.assessedAt);
  const inputSession = indiaDay(record);
  // Keep the first prediction for this account, ticker, horizon, rule version and IST date.
  const id = horizonPredictionId(ownerId, ticker, assessment.horizon, inputSession, version);
  try {
    await connectToDatabase();
    const inserted = await HorizonPrediction.updateOne({ _id: id, ownerId }, { $setOnInsert: {
      ownerId, ticker, horizon: assessment.horizon, recordedAt: record, inputSession,
      referencePrice: assessment.referencePrice, benchmarkReferencePrice: assessment.benchmarkReferencePrice ?? null, ruleVersion: version, snapshot: assessment,
      outcome: { status: 'pending', reason: 'Awaiting the predeclared evaluation window.', evaluatedAt: record.toISOString() },
    } }, { upsert: true });
    const saved = await HorizonPrediction.findOne({ _id: id, ownerId }).select('_id').lean();
    if (!saved) throw new Error('Prediction save not confirmed');
    return inserted.upsertedCount ? { status: 'saved', message: 'The first prediction for this stock, horizon, and IST date was frozen in your outcome history.' }
      : { status: 'existing', message: 'This stock already has a frozen prediction for this horizon and IST date; the original snapshot was kept.' };
  } catch {
    return { status: 'unavailable', message: 'The research report was created, but the prediction history save could not be confirmed.' };
  }
}

type Bar = { timestamp: number; open: number; high: number; low: number; close: number };
type Chart = { symbol: string; currency: string; observedAt: string; fetchedAt: string; bars: Bar[]; splits: number[] };

async function fetchChart(ticker: string): Promise<Chart | null> {
  const symbol = ticker.startsWith('^') ? ticker : `${ticker}.NS`;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=splits`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const chart = payload?.chart?.result?.[0], meta = chart?.meta, series = chart?.indicators?.quote?.[0];
      const fetchedAt = new Date().toISOString();
      if (meta?.symbol !== symbol || meta?.currency !== 'INR' || !Number.isFinite(meta?.regularMarketTime) || !Array.isArray(chart?.timestamp) || !series) continue;
      const observedAt = new Date(meta.regularMarketTime * 1000).toISOString();
      const bars = chart.timestamp.map((timestamp: number, i: number) => ({ timestamp, open: series.open?.[i], high: series.high?.[i], low: series.low?.[i], close: series.close?.[i] }))
        .filter((bar: Bar) => Number.isFinite(bar.timestamp) && bar.timestamp * 1000 <= Date.parse(observedAt) && [bar.open, bar.high, bar.low, bar.close].every(n => Number.isFinite(n) && n > 0) && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close))
        .sort((a: Bar, b: Bar) => a.timestamp - b.timestamp);
      if (!bars.length || bars.some((bar: Bar, i: number) => i > 0 && bar.timestamp === bars[i - 1].timestamp)) continue;
      const splits = Object.values(chart.events?.splits ?? {}).map((split: any) => split?.date).filter((date: unknown): date is number => Number.isFinite(date));
      return { symbol, currency: meta.currency, observedAt, fetchedAt, bars, splits };
    } catch { /* Try the alternate provider host without inventing missing prices. */ }
  }
  return null;
}

export function evaluateHorizonOutcome(record: any, chart: Chart | null, benchmark: Chart | null = null, now = Date.now()): HorizonOutcome {
  const evaluatedAt = new Date(now).toISOString();
  const result = (status: HorizonOutcome['status'], reason: string, detail: Partial<HorizonOutcome> = {}): HorizonOutcome => ({ status, reason, evaluatedAt, ...detail });
  if (!record || !['week', 'month', 'year', 'multibagger'].includes(record.horizon) || !Number.isFinite(Date.parse(record.recordedAt)) ||
      !Number.isFinite(Date.parse(record.inputSession)) || !Number.isFinite(record.referencePrice) || record.referencePrice <= 0 || ![version, legacyVersion].includes(record.ruleVersion)) return result('unscorable', 'invalid_frozen_prediction');
  if (!chart || chart.symbol !== `${record.ticker}.NS` || chart.currency !== 'INR' || Date.parse(chart.observedAt) > Date.parse(chart.fetchedAt) || Date.parse(chart.fetchedAt) > now) return result('pending', 'provider_data_unavailable');
  if (!benchmark || benchmark.symbol !== '^NSEI' || benchmark.currency !== 'INR' || Date.parse(benchmark.observedAt) > Date.parse(benchmark.fetchedAt) || Date.parse(benchmark.fetchedAt) > now) return result('pending', 'benchmark_data_unavailable');
  const predictionTime = Date.parse(record.recordedAt);
  const subsequent = chart.bars.filter(bar => bar.timestamp * 1000 > predictionTime && bar.timestamp * 1000 <= Date.parse(chart.observedAt));
  const benchmarkAfter = benchmark.bars.filter(bar => bar.timestamp * 1000 > predictionTime && bar.timestamp * 1000 <= Date.parse(benchmark.observedAt));
  const sessionsAfter = benchmarkAfter.map(bar => indiaDay(new Date(bar.timestamp * 1000)));
  if (new Set(sessionsAfter).size !== sessionsAfter.length) return result('unscorable', 'ambiguous_benchmark_sessions', { dataAsOf: benchmark.observedAt });
  const stockByDay = new Map<string, Bar[]>();
  for (const bar of subsequent) {
    const date = indiaDay(new Date(bar.timestamp * 1000));
    stockByDay.set(date, [...(stockByDay.get(date) ?? []), bar]);
  }
  const split = chart.splits.some(at => at * 1000 > predictionTime && at * 1000 <= now);
  if (split) return result('unscorable', 'corporate_action_adjustment_unverified', { dataAsOf: chart.observedAt });
  const horizon = record.horizon as ResearchHorizon;
  if (horizon === 'multibagger') {
    const deadline = new Date(predictionTime); deadline.setUTCFullYear(deadline.getUTCFullYear() + 3);
    const target = record.referencePrice * 2;
    if (subsequent.some(bar => bar.high >= target)) return result('right', 'doubling_threshold_reached', { dataAsOf: chart.observedAt, deadline: deadline.toISOString() });
    if (now < deadline.getTime()) return result('pending', 'awaiting_three_year_deadline', { dataAsOf: chart.observedAt, deadline: deadline.toISOString() });
    if (Date.parse(benchmark.observedAt) < deadline.getTime()) return result('pending', 'awaiting_fresh_data_through_deadline', { dataAsOf: benchmark.observedAt, deadline: deadline.toISOString() });
    const expectedDays = sessionsAfter.filter(day => Date.parse(`${day}T00:00:00+05:30`) <= deadline.getTime());
    if (expectedDays.some(day => stockByDay.get(day)?.length !== 1)) return result('unscorable', 'incomplete_daily_coverage', { dataAsOf: chart.observedAt, deadline: deadline.toISOString() });
    return result('wrong', 'doubling_threshold_not_reached_by_deadline', { dataAsOf: chart.observedAt, deadline: deadline.toISOString() });
  }
  let targetDay: string | undefined;
  if (horizon === 'year') {
    const deadline = new Date(predictionTime); deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
    const deadlineDay = indiaDay(deadline);
    targetDay = sessionsAfter.find(day => day >= deadlineDay);
    if (!targetDay) return result('pending', 'awaiting_one_year_deadline', { dataAsOf: chart.observedAt, deadline: deadline.toISOString() });
  } else {
    const count = sessions[horizon]!;
    if (sessionsAfter.length < count) return result('pending', 'awaiting_completed_sessions', { dataAsOf: chart.observedAt });
    targetDay = sessionsAfter[count - 1];
  }
  const end = stockByDay.get(targetDay)?.length === 1 ? stockByDay.get(targetDay)![0] : null;
  if (!end) return result('unscorable', 'stock_bar_missing_for_benchmark_session', { dataAsOf: chart.observedAt });
  const benchmarkEnd = benchmarkAfter.find(bar => indiaDay(new Date(bar.timestamp * 1000)) === targetDay);
  if (!benchmarkEnd || !Number.isFinite(record.benchmarkReferencePrice) || record.benchmarkReferencePrice <= 0) return result('unscorable', 'benchmark_reference_or_outcome_missing', { dataAsOf: benchmark.observedAt });
  if (horizon === 'week' && record.ruleVersion === version) {
    const snapshot = record.snapshot as HorizonAssessment | undefined;
    const trigger = snapshot?.entryTriggerPrice, stop = snapshot?.invalidationPrice, validSessions = snapshot?.entryValiditySessions;
    if (![trigger, stop, validSessions].every(Number.isFinite) || trigger! <= stop! || validSessions! < 1 || validSessions! > 5) return result('unscorable', 'entry_rule_missing_from_snapshot', { dataAsOf: chart.observedAt });
    let entryPrice: number | null = null;
    for (let i = 0; i < sessions[ horizon ]!; i++) {
      const sessionDay = sessionsAfter[i];
      const bar = stockByDay.get(sessionDay)?.length === 1 ? stockByDay.get(sessionDay)![0] : null;
      if (!bar) return result('unscorable', 'stock_bar_missing_for_benchmark_session', { dataAsOf: chart.observedAt });
      if (i >= validSessions! && entryPrice === null) break;
      if (entryPrice === null) {
        if (bar.open <= stop!) return result('wrong', 'setup_invalidated_before_entry', { dataAsOf: new Date(bar.timestamp * 1000).toISOString() });
        if (bar.high >= trigger!) {
          if (bar.low <= stop!) {
            if (bar.open >= trigger!) return result('wrong', 'initial_stop_reached_after_gap_entry', { dataAsOf: new Date(bar.timestamp * 1000).toISOString() });
            return result('unscorable', 'trigger_and_stop_sequence_ambiguous', { dataAsOf: new Date(bar.timestamp * 1000).toISOString() });
          }
          entryPrice = Math.max(bar.open, trigger!);
        } else if (bar.low <= stop!) {
          return result('wrong', 'setup_invalidated_before_entry', { dataAsOf: new Date(bar.timestamp * 1000).toISOString() });
        }
      } else if (bar.low <= stop!) {
        return result('wrong', 'initial_stop_reached_after_entry', { dataAsOf: new Date(bar.timestamp * 1000).toISOString() });
      }
    }
    if (entryPrice === null) return result('wrong', 'entry_trigger_not_reached_before_expiry', { dataAsOf: chart.observedAt });
    const changeFromEntry = (end.close / entryPrice - 1) * 100;
    const benchmarkReturnPercent = (benchmarkEnd.close / record.benchmarkReferencePrice - 1) * 100;
    return result(changeFromEntry > 0 ? 'right' : 'wrong', changeFromEntry > 0 ? 'positive_close_after_triggered_entry' : 'nonpositive_close_after_triggered_entry',
      { returnPercent: Number(changeFromEntry.toFixed(4)), benchmarkReturnPercent: Number(benchmarkReturnPercent.toFixed(4)),
        relativeReturnPercent: Number((changeFromEntry - benchmarkReturnPercent).toFixed(4)), entryPrice,
        dataAsOf: new Date(end.timestamp * 1000).toISOString() });
  }
  const change = (end.close / record.referencePrice - 1) * 100;
  const benchmarkReturnPercent = (benchmarkEnd.close / record.benchmarkReferencePrice - 1) * 100;
  return result(change > 0 ? 'right' : 'wrong', change > 0 ? 'positive_price_return_at_horizon' : 'nonpositive_price_return_at_horizon',
    { returnPercent: Number(change.toFixed(4)), benchmarkReturnPercent: Number(benchmarkReturnPercent.toFixed(4)),
      relativeReturnPercent: Number((change - benchmarkReturnPercent).toFixed(4)), dataAsOf: new Date(end.timestamp * 1000).toISOString() });
}

export const HORIZON_HISTORY_PAGE_SIZE = 50;

async function reconcilePendingDocs(docs: any[], ownerFilter?: string) {
  let checked = 0;
  const charts = new Map<string, Promise<Chart | null>>();
  const benchmarkRequest = docs.length ? fetchChart('^NSEI') : Promise.resolve(null);
  for (let i = 0; i < docs.length; i += 5) {
    await Promise.all(docs.slice(i, i + 5).map(async (doc: any) => {
      if (!charts.has(doc.ticker)) charts.set(doc.ticker, fetchChart(doc.ticker));
      const [chart, benchmark] = await Promise.all([charts.get(doc.ticker)!, benchmarkRequest]);
      const outcome = evaluateHorizonOutcome(doc, chart, benchmark, Date.now());
      const filter: Record<string, unknown> = { _id: doc._id, 'outcome.status': 'pending' };
      if (ownerFilter) filter.ownerId = ownerFilter;
      const updated = await HorizonPrediction.updateOne(filter, { $set: { outcome, lastCheckedAt: new Date() } });
      if (updated.modifiedCount) checked++;
    }));
  }
  return checked;
}

export async function reconcilePendingHorizonPredictions(limit = 25) {
  await connectToDatabase();
  const retryBefore = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const docs = await HorizonPrediction.find({ 'outcome.status': 'pending', $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: retryBefore } }] })
    .sort({ recordedAt: 1 }).limit(Math.max(1, Math.min(50, Math.floor(limit)))).lean();
  return { checked: await reconcilePendingDocs(docs), selected: docs.length };
}

export async function getHorizonHistory(ownerId: string, from: string, to: string, page = 1, reconcile = false) {
  await connectToDatabase();
  const query = { ownerId, recordedAt: { $gte: new Date(`${from}T00:00:00+05:30`), $lt: new Date(Date.parse(`${to}T00:00:00+05:30`) + 86400000) } };
  let checked = 0;
  if (reconcile) {
    const retryBefore = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const pending = await HorizonPrediction.find({ ...query, 'outcome.status': 'pending', $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: retryBefore } }] })
      .sort({ lastCheckedAt: 1, recordedAt: 1 }).limit(20).lean();
    checked = await reconcilePendingDocs(pending, ownerId);
  }
  const [docs, total, groups] = await Promise.all([
    HorizonPrediction.find(query).sort({ recordedAt: -1, _id: -1 }).skip((page - 1) * HORIZON_HISTORY_PAGE_SIZE).limit(HORIZON_HISTORY_PAGE_SIZE).lean(),
    HorizonPrediction.countDocuments(query),
    HorizonPrediction.aggregate([
      { $match: query },
      { $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt', timezone: 'Asia/Kolkata' } }, horizon: '$horizon', ruleVersion: '$ruleVersion' },
        saved: { $sum: 1 }, right: { $sum: { $cond: [{ $eq: ['$outcome.status', 'right'] }, 1, 0] } },
        wrong: { $sum: { $cond: [{ $eq: ['$outcome.status', 'wrong'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$outcome.status', 'pending'] }, 1, 0] } },
        unscorable: { $sum: { $cond: [{ $eq: ['$outcome.status', 'unscorable'] }, 1, 0] } },
      } }, { $sort: { '_id.date': -1, '_id.horizon': 1, '_id.ruleVersion': 1 } },
    ]),
  ]);
  return { from, to, page, pageSize: HORIZON_HISTORY_PAGE_SIZE, total, checked,
    entries: docs.map((doc: any) => ({ id: String(doc._id), ticker: doc.ticker, horizon: doc.horizon,
      recordedAt: new Date(doc.recordedAt).toISOString(), inputSession: doc.inputSession, referencePrice: doc.referencePrice,
      ruleVersion: doc.ruleVersion, outcome: doc.outcome })),
    days: groups.map((group: any) => ({ ...group._id, saved: group.saved, right: group.right, wrong: group.wrong,
      pending: group.pending, unscorable: group.unscorable, scored: group.right + group.wrong,
      rightRate: group.right + group.wrong ? group.right / (group.right + group.wrong) : null })) };
}
