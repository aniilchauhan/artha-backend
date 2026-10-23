import { createHash } from 'node:crypto';
import connectToDatabase from './mongodb';
import History from '../models/ForwardPredictionHistory';
import { indiaDate } from './opportunity-analysis';
import type { ShareOpportunity } from './opportunity-types';
import type { ForwardHistoryChart, ForwardHistoryEntry } from './forward-history-types';
import { evaluateForwardHistory } from './forward-history-evaluation';

function entry(doc: any): ForwardHistoryEntry {
  return { id: String(doc._id), ticker: doc.ticker, name: doc.name, horizon: doc.horizon,
    recordedAt: new Date(doc.recordedAt).toISOString(), quoteAsOf: doc.quoteAsOf,
    inputDate: doc.inputDate, modelVersion: doc.modelVersion, policyVersion: doc.policyVersion,
    reference: doc.reference, target: doc.target, estimate: doc.estimate,
    evidenceCount: doc.evidenceCount, outcome: doc.outcome };
}

export async function saveForwardHistory(owner: string, data: ShareOpportunity[], horizon: 'today' | 'next', modelVersion: string) {
  if (!data.length) return { status: 'empty', saved: 0, message: 'No candidates were issued to save.' };
  try {
    await connectToDatabase();
    const recordedAt = new Date();
    const policyVersion = horizon === 'today' ? 'after-recorded-quote-high-2pct-v1' : 'next-open-target-before-stop-2pct-v1';
    let saved = 0;
    for (const item of data) {
      const inputDate = horizon === 'next' ? item.asOf : undefined;
      // Keep the first record in each five-minute observation slot; refreshing cannot overwrite it.
      const slot = horizon === 'today' ? String(Math.floor(recordedAt.getTime() / 300_000)) : inputDate;
      const id = createHash('sha256').update(JSON.stringify([owner, horizon, modelVersion, policyVersion, slot, item.ticker])).digest('hex');
      try {
        const result = await History.updateOne({ _id: id, owner }, { $setOnInsert: {
          owner, ticker: item.ticker, name: item.name, horizon, recordedAt,
          quoteAsOf: item.asOf, inputDate, modelVersion, policyVersion,
          reference: item.reference, target: item.target, estimate: item.estimate,
          evidenceCount: item.evidenceCount, snapshot: item,
          outcome: { status: 'pending', reason: 'Awaiting the scoring deadline.', evaluatedAt: recordedAt.toISOString() },
        } }, { upsert: true });
        saved += result.upsertedCount || 0;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error;
      }
    }
    return { status: 'saved', saved, message: `${saved} new observations saved. Existing records keep their original timestamps and targets.` };
  } catch {
    return { status: 'unavailable', saved: null, message: 'History saving could not be confirmed. Check the database connection before relying on these results for evaluation.' };
  }
}

export async function getForwardHistory(owner: string, from: string, to: string, page = 1) {
  await connectToDatabase();
  const query = { owner, recordedAt: { $gte: new Date(`${from}T00:00:00+05:30`), $lt: new Date(Date.parse(`${to}T00:00:00+05:30`) + 86400000) } };
  const [docs, total, groups] = await Promise.all([
    History.find(query).sort({ recordedAt: -1, _id: -1 }).skip((page - 1) * 50).limit(50).lean(),
    History.countDocuments(query),
    // Summaries cover ALL matching records, independently of detail pagination.
    History.aggregate([
      { $match: query },
      { $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$recordedAt', timezone: 'Asia/Kolkata' } },
          horizon: '$horizon', modelVersion: '$modelVersion', policyVersion: '$policyVersion' },
        saved: { $sum: 1 },
        right: { $sum: { $cond: [{ $eq: ['$outcome.status', 'right'] }, 1, 0] } },
        wrong: { $sum: { $cond: [{ $eq: ['$outcome.status', 'wrong'] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ['$outcome.status', 'pending'] }, 1, 0] } },
        unscorable: { $sum: { $cond: [{ $eq: ['$outcome.status', 'unscorable'] }, 1, 0] } },
      } }, { $sort: { '_id.date': -1, '_id.horizon': 1, '_id.modelVersion': 1 } },
    ]),
  ]);
  return { from, to, page, pageSize: 50, total, entries: docs.map(entry), days: groups.map(g => ({
    ...g._id, saved: g.saved, right: g.right, wrong: g.wrong, pending: g.pending, unscorable: g.unscorable,
    scored: g.right + g.wrong, rightRate: g.right + g.wrong ? g.right / (g.right + g.wrong) : null,
  })) };
}

async function fetchHistoryChart(symbol: string, horizon: 'today' | 'next'): Promise<ForwardHistoryChart | null> {
  try {
    const interval = horizon === 'today' ? '5m' : '1d';
    const range = horizon === 'today' ? '1mo' : '3mo';
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const chart = (await response.json()).chart?.result?.[0];
    const meta = chart?.meta, values = chart?.indicators?.quote?.[0];
    if (!meta || !values || meta.symbol !== symbol || meta.currency !== 'INR' || !Number.isFinite(meta.regularMarketTime)) return null;
    return { symbol, currency: meta.currency, fetchedAt: new Date().toISOString(), observedAt: new Date(meta.regularMarketTime * 1000).toISOString(),
      sessionStart: meta.currentTradingPeriod?.regular?.start, sessionEnd: meta.currentTradingPeriod?.regular?.end,
      barSeconds: horizon === 'today' ? 300 : 86400,
      bars: (chart.timestamp || []).map((timestamp: number, i: number) => ({ timestamp,
        open: values.open?.[i], high: values.high?.[i], low: values.low?.[i], close: values.close?.[i] })) };
  } catch { return null; }
}

export async function reconcileForwardHistory(owner: string) {
  await connectToDatabase();
  const docs = await History.find({ owner, 'outcome.status': 'pending' }).sort({ lastCheckedAt: 1, recordedAt: 1 }).limit(20).lean();
  const benchmark = docs.some(d => d.horizon === 'next') ? await fetchHistoryChart('^NSEI', 'next') : null;
  const requests = new Map<string, Promise<ForwardHistoryChart | null>>();
  const result = { checked: 0, right: 0, wrong: 0, pending: 0, unscorable: 0 };
  for (let i = 0; i < docs.length; i += 5) {
    await Promise.all(docs.slice(i, i + 5).map(async doc => {
      const record = entry(doc);
      const key = `${record.ticker}:${record.horizon}`;
      if (!requests.has(key)) requests.set(key, fetchHistoryChart(record.ticker, record.horizon));
      const chart = await requests.get(key)!;
      const outcome = evaluateForwardHistory(record, chart, benchmark);
      const updated = await History.updateOne({ _id: record.id, owner, 'outcome.status': 'pending' }, { $set: { outcome, lastCheckedAt: new Date() } });
      if (updated.modifiedCount) { result.checked++; result[outcome.status]++; }
    }));
  }
  return result;
}

export function defaultHistoryRange(now = new Date()) {
  return { from: indiaDate(new Date(now.getTime() - 29 * 86400000)), to: indiaDate(now) };
}
