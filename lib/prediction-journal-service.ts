import { createHash } from 'node:crypto';
import connectToDatabase from './mongodb';
import PredictionJournal from '../models/PredictionJournal';
import { fetchProviderChart, indiaDay, normalizeChart } from './market-quote';
import { evaluateJournalEntry, summarizeJournal } from './prediction-journal-evaluation';
import { JOURNAL_POLICY_VERSION } from './prediction-journal-types';
import type { JournalEntry } from './prediction-journal-types';
import type { PredictionAiAssessment, PredictionJournalReceipt } from './prediction-ai-types';

const JOURNAL_LIMIT = 500;
const RECONCILE_LIMIT = 25;

export function predictionJournalKey(assessment: PredictionAiAssessment): string {
  return createHash('sha256').update(JSON.stringify([
    JOURNAL_POLICY_VERSION, assessment.promptVersion, assessment.source, assessment.model,
    assessment.ticker, indiaDay(new Date(assessment.context.historyAsOf)),
  ])).digest('hex');
}

function entryFromDocument(doc: any): JournalEntry {
  return { id: String(doc._id), ticker: doc.ticker,
    recordedAt: new Date(doc.recordedAt).toISOString(), assessment: doc.assessment,
    policyVersion: doc.policyVersion, promptVersion: doc.promptVersion, outcome: doc.outcome };
}

export async function recordPredictionAssessment(assessment: PredictionAiAssessment): Promise<PredictionJournalReceipt> {
  try {
    if (!assessment.promptVersion) throw new Error('Unversioned assessment');
    const id = predictionJournalKey(assessment);
    await connectToDatabase();
    const recordedAt = new Date();
    // Strip any previous save receipt from the immutable evidence snapshot.
    const { journal: _journal, ...snapshot } = assessment;
    let inserted = false;
    try {
      const result = await PredictionJournal.updateOne({ _id: id }, { $setOnInsert: {
        ticker: assessment.ticker, recordedAt, assessment: snapshot,
        policyVersion: JOURNAL_POLICY_VERSION, promptVersion: assessment.promptVersion,
        outcome: { status: 'pending', evaluatedAt: recordedAt.toISOString(), reason: 'Waiting for the next completed exchange session.' },
      } }, { upsert: true });
      inserted = result.upsertedCount === 1;
    } catch (error) {
      // Concurrent first inserts race on _id; both callers read the winning record.
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error;
    }
    const stored = await PredictionJournal.findById(id).lean();
    if (!stored) throw new Error('Journal insert was not confirmed');
    return { status: inserted ? 'recorded' : 'existing', id,
      recordedAt: new Date(stored.recordedAt).toISOString(),
      message: inserted ? 'Saved for outcome tracking. Eligibility is checked against the next session’s opening time.'
        : 'The first assessment for this stock, session and model is already saved. Later reviews do not replace it.' };
  } catch {
    return { status: 'unavailable', message: 'This assessment was not saved: the prediction journal is unavailable. Check the database connection before collecting results.' };
  }
}

export async function getPredictionJournal() {
  await connectToDatabase();
  const [documents, totalRecords] = await Promise.all([
    PredictionJournal.find({}).sort({ recordedAt: -1 }).limit(JOURNAL_LIMIT).lean(),
    PredictionJournal.countDocuments({}),
  ]);
  const entries = documents.map(entryFromDocument);
  return { entries, summary: summarizeJournal(entries), totalRecords, limit: JOURNAL_LIMIT };
}

async function fetchJournalQuote(symbol: string) {
  const chart = await fetchProviderChart(symbol);
  return chart ? normalizeChart(symbol, chart) : null;
}

let inFlightReconciliation: Promise<{ checked: number; completed: number; excluded: number; pending: number }> | null = null;

async function reconcileBatch() {
  await connectToDatabase();
  // Check the least recently attempted rows first so missing data cannot starve newer rows.
  const documents = await PredictionJournal.find({ 'outcome.status': 'pending' })
    .sort({ lastCheckedAt: 1, recordedAt: 1 }).limit(RECONCILE_LIMIT).lean();
  const result = { checked: 0, completed: 0, excluded: 0, pending: 0 };
  if (!documents.length) return result;
  const benchmark = await fetchJournalQuote('^NSEI');
  const quoteRequests = new Map<string, ReturnType<typeof fetchJournalQuote>>();
  for (let i = 0; i < documents.length; i += 5) {
    await Promise.all(documents.slice(i, i + 5).map(async (doc: any) => {
      const entry = entryFromDocument(doc);
      if (!quoteRequests.has(entry.ticker)) quoteRequests.set(entry.ticker, fetchJournalQuote(`${entry.ticker}.NS`));
      const stock = await quoteRequests.get(entry.ticker)!;
      const outcome = evaluateJournalEntry(entry, stock, benchmark);
      // A completed/excluded outcome is never overwritten by a racing request.
      const update = await PredictionJournal.updateOne({ _id: entry.id, 'outcome.status': 'pending' },
        { $set: { outcome, lastCheckedAt: new Date() } });
      if (update.modifiedCount === 1) {
        result.checked++;
        result[outcome.status]++;
      }
    }));
  }
  return result;
}

export async function reconcilePredictionJournal() {
  if (inFlightReconciliation) return inFlightReconciliation;
  inFlightReconciliation = reconcileBatch();
  try { return await inFlightReconciliation; }
  finally { inFlightReconciliation = null; }
}
