import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAxionProjectRoot } from './project-root';
import { atomicSnapshotFile, readSnapshot, runSnapshotJob } from './backend-snapshots';
import { getOllamaBaseUrl, pickPreferredOllamaModel } from './ollama-service';
import { collectPredictionAiContext } from './prediction-ai-service';
import { normalizePredictionTicker } from './prediction-ai';
import { generateOllamaEvidence, evidenceReviewId, prepareOllamaEvidence, type SavedOllamaReview } from './ollama-evidence-review';
import type { RapidMoveBatch } from './rapid-move-types';

export interface OllamaEvidenceBatch {
  day: string;
  universe: string[];
  attempts: Record<string, { state: 'started' | 'ready' | 'failed'; at: string }>;
  reviews: Record<string, SavedOllamaReview>;
  runtime: 'healthy' | 'unavailable';
}
const recordsRoot = () => path.join(getAxionProjectRoot(), 'data/backend-snapshots/ollama-evidence-records');
export function reviewBudget(value: string | undefined, fallback: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}
export function isReviewWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? '';
  return !['Sat', 'Sun'].includes(get('weekday')) && Number(get('hour')) * 60 + Number(get('minute')) >= 16 * 60;
}
export async function ollamaRuntime() {
  const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Ollama unavailable');
  const data = await response.json() as { models?: Array<{ name: string; digest: string }> };
  const models = (data.models ?? []).filter(m => typeof m.name === 'string' && typeof m.digest === 'string' && m.digest.length > 0);
  const selected = pickPreferredOllamaModel(models.map(m => m.name), process.env.OLLAMA_MODEL);
  const model = models.find(m => m.name === selected);
  if (!model) throw new Error('No installed Ollama model');
  return model;
}

export async function readSavedOllamaReview(input: unknown) {
  const ticker = normalizePredictionTicker(input);
  try {
    const snapshot = await readSnapshot<OllamaEvidenceBatch>('ollama-evidence');
    const review = snapshot.data.reviews[ticker] ?? null;
    return { review, state: snapshot.data.attempts[ticker]?.state ?? (snapshot.data.universe.includes(ticker) ? 'pending' : 'outside_pilot'),
      runtime: snapshot.data.runtime, stale: !!review && Date.now() - Date.parse(review.assessment.generatedAt) > 36 * 3600000,
      generatedAt: snapshot.generatedAt };
  } catch {
    return { review: null, state: 'unavailable', runtime: 'unavailable', stale: false, generatedAt: null };
  }
}

/** Independent worker lock; never holds up the market scanners or invokes a cloud provider. */
export async function runOllamaEvidenceCycle(force = false) {
  if (!force && !isReviewWindow()) return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const cap = reviewBudget(process.env.OLLAMA_REVIEW_DAILY_CAP, 20, 20);
  try {
    const previous = (await readSnapshot<OllamaEvidenceBatch>('ollama-evidence')).data;
    if (previous.day === day && !Object.values(previous.attempts).some(a => a.state === 'started') &&
      (Object.keys(previous.attempts).length >= cap ||
      (previous.universe.length > 0 && previous.universe.every(t => previous.attempts[t])))) return false;
  } catch {}
  return runSnapshotJob('ollama-evidence', async () => {
    let previous: OllamaEvidenceBatch | null = null;
    try { previous = (await readSnapshot<OllamaEvidenceBatch>('ollama-evidence')).data; } catch {}
    const radar = await readSnapshot<RapidMoveBatch>('rapid-moves');
    if (Date.now() - Date.parse(radar.generatedAt) > 36 * 3600000) throw new Error('Pilot scanner snapshot is stale. Previous reviews retained.');
    const configured = process.env.OLLAMA_REVIEW_TICKERS?.split(',').map(t => normalizePredictionTicker(t));
    const ranked = [...radar.data.candidates].sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
    const universe = previous?.day === day ? previous.universe : [...new Set(configured ?? ranked.map(c => c.ticker))].slice(0, cap);
    const batch: OllamaEvidenceBatch = { day, universe, attempts: previous?.day === day ? { ...previous.attempts } : {},
      reviews: { ...previous?.reviews }, runtime: 'unavailable' };
    for (const attempt of Object.values(batch.attempts)) if (attempt.state === 'started') attempt.state = 'failed';
    const output = () => ({ data: batch, marketDataAsOf: Object.values(batch.reviews).map(r => r.assessment.context.historyAsOf).sort()[0] ?? null,
      coverage: { evaluated: universe.filter(t => batch.attempts[t]?.state === 'ready').length, total: universe.length } });
    const checkpoint = async () => atomicSnapshotFile('ollama-evidence.json', { ...output(), version: 1, job: 'ollama-evidence', generatedAt: new Date().toISOString() });
    let runtime: Awaited<ReturnType<typeof ollamaRuntime>>;
    try { runtime = await ollamaRuntime(); batch.runtime = 'healthy'; } catch { return output(); }
    const deadline = Date.now() + reviewBudget(process.env.OLLAMA_REVIEW_CYCLE_SECONDS, 300, 600) * 1000;
    for (const ticker of universe) {
      if (batch.attempts[ticker] || Object.keys(batch.attempts).length >= cap || Date.now() >= deadline) continue;
      // Reserve durably before work. An interrupted attempt counts toward the daily cap.
      batch.attempts[ticker] = { state: 'started', at: new Date().toISOString() };
      await checkpoint();
      try {
        const context = prepareOllamaEvidence(await collectPredictionAiContext(ticker));
        const historyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(context.historyAsOf));
        if (historyDay !== day) throw new Error('No completed price evidence for the current review day');
        const id = evidenceReviewId(context, runtime.digest);
        let review: SavedOllamaReview;
        await fs.mkdir(recordsRoot(), { recursive: true });
        const file = path.join(recordsRoot(), id + '.json');
        try { review = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          review = await generateOllamaEvidence(context, runtime.name, runtime.digest);
          const current = await ollamaRuntime();
          if (current.digest !== runtime.digest || current.name !== runtime.name) throw new Error('Model changed during review');
          await atomicSnapshotFile('ollama-evidence-records/' + id + '.json', review);
        }
        batch.reviews[ticker] = review;
        batch.attempts[ticker].state = 'ready';
      } catch { batch.attempts[ticker].state = 'failed'; }
      await checkpoint();
    }
    return output();
  });
}
