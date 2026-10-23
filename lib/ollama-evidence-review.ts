import { createHash } from 'node:crypto';
import { generateOllamaResponse } from './ollama-service';
import { parsePredictionReview, predictionReviewSchema, PREDICTION_AI_SYSTEM } from './prediction-ai';
import { promptFor, PREDICTION_AI_PROMPT_VERSION } from './prediction-ai-service';
import type { PredictionAiAssessment, PredictionAiContext } from './prediction-ai-types';

export const OLLAMA_EVIDENCE_POLICY = 'ollama-evidence-v1';
export interface HoldingConsideration {
  sessions: number;
  status: 'supporting_observations' | 'risk_observations' | 'insufficient_evidence';
  reason: string;
  evidenceIds: string[];
}
export interface SavedOllamaReview {
  id: string;
  modelDigest: string;
  policyVersion: string;
  assessment: PredictionAiAssessment;
  holdingConsiderations: HoldingConsideration[];
}

export function prepareOllamaEvidence(context: PredictionAiContext): PredictionAiContext {
  let remaining = 6000;
  const sources = (context.sources ?? []).slice(0, 40).map(source => {
    if (typeof source.value !== 'string') return source;
    const value = source.value.slice(0, Math.min(1200, remaining));
    remaining -= value.length;
    return { ...source, value };
  }).filter(source => typeof source.value !== 'string' || source.value.length > 0);
  return { ...context, sources, limitations: [...context.limitations,
    'AI input retains at most forty sources, twelve hundred characters per text observation, and six thousand text characters overall. Full articles and filings are not supplied.'] };
}

export function evidenceReviewId(context: PredictionAiContext, modelDigest: string) {
  // Retrieval time alone must not create a different inference job.
  return createHash('sha256').update(JSON.stringify({
    ticker: context.ticker, historyAsOf: context.historyAsOf, metrics: context.metrics,
    sources: context.sources?.map(({ retrievedAt: _retrievedAt, ...source }) => source),
    baseline: context.baseline, coverage: context.coverage, limitations: context.limitations,
    modelDigest, promptVersion: PREDICTION_AI_PROMPT_VERSION, policy: OLLAMA_EVIDENCE_POLICY,
  })).digest('hex');
}

export function parseOllamaEvidence(text: string, context: PredictionAiContext) {
  if (text.length > 24000) throw new Error('Oversized review');
  const parsed = JSON.parse(text.trim());
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid review');
  const { holdingConsiderations, ...review } = parsed;
  const assessment = parsePredictionReview(JSON.stringify(review), context);
  const prose = [assessment.summary, assessment.invalidation, ...assessment.risks, ...assessment.evidence.map(e => e.interpretation)];
  if (prose.some(value => /\d/.test(value))) throw new Error('Numeric claims must use supplied evidence values, not generated prose');
  if (!Array.isArray(holdingConsiderations) || holdingConsiderations.length !== 5) throw new Error('Missing holding coverage');
  const validIds = new Set((context.sources ?? []).filter(s => s.category === 'fundamentals').map(s => s.id));
  for (let i = 0; i < 5; i++) {
    const item = holdingConsiderations[i];
    if (!item || Object.keys(item).some(k => !['sessions', 'status', 'reason', 'evidenceIds'].includes(k)) ||
      item.sessions !== i + 1 || !['supporting_observations', 'risk_observations', 'insufficient_evidence'].includes(item.status) ||
      typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 600 || /\d/.test(item.reason) ||
      !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 5 ||
      !item.evidenceIds.every((id: unknown) => typeof id === 'string' && validIds.has(id)) ||
      (item.status !== 'insufficient_evidence' && !item.evidenceIds.length)) throw new Error('Unsupported company holding consideration');
    // Company description/sector alone cannot establish a financial holding thesis.
    if (item.status !== 'insufficient_evidence' && !item.evidenceIds.some((id: string) =>
      context.sources?.some(s => s.id === id && typeof s.value === 'number'))) throw new Error('Financial evidence required');
  }
  return { review: assessment, holdingConsiderations: holdingConsiderations as HoldingConsideration[] };
}

export async function generateOllamaEvidence(context: PredictionAiContext, model: string, modelDigest: string): Promise<SavedOllamaReview> {
  const base = predictionReviewSchema(context);
  const companyIds = (context.sources ?? []).filter(s => s.category === 'fundamentals').map(s => s.id);
  const proseString = { type: 'string', pattern: '^[^0-9]*$', minLength: 1, maxLength: 600 };
  const format = { ...base, properties: { ...base.properties,
    summary: proseString, invalidation: proseString,
    risks: { ...base.properties.risks, items: proseString },
    evidence: { ...base.properties.evidence, items: { ...base.properties.evidence.items,
      properties: { ...base.properties.evidence.items.properties, interpretation: proseString } } },
    holdingConsiderations: {
    type: 'array', minItems: 5, maxItems: 5, items: { type: 'object', additionalProperties: false,
      properties: { sessions: { type: 'integer', minimum: 1, maximum: 5 },
        status: { type: 'string', enum: ['supporting_observations', 'risk_observations', 'insufficient_evidence'] },
        reason: proseString, evidenceIds: { type: 'array', maxItems: 5,
          items: companyIds.length ? { type: 'string', enum: companyIds } : { type: 'string' }, ...(companyIds.length ? {} : { maxItems: 0 }) } },
      required: ['sessions', 'status', 'reason', 'evidenceIds'] } } }, required: [...base.required, 'holdingConsiderations'] };
  const requestedTimeout = Number(process.env.OLLAMA_REVIEW_TIMEOUT_SECONDS);
  const timeoutMs = (Number.isInteger(requestedTimeout) && requestedTimeout > 0 ? Math.min(requestedTimeout, 180) : 120) * 1000;
  const result = await generateOllamaResponse({ model, temperature: 0, format, timeoutMs, maxAttempts: 1, numPredict: 1800, numCtx: 8192,
    system: PREDICTION_AI_SYSTEM,
    prompt: promptFor(context, format) +
      '\nInclude exactly five company holding considerations ordered by sessions 1 to 5. These are financial observations, not return forecasts or buy/hold instructions. ' +
      'Use only supplied fundamentals IDs, with at least one numeric financial observation for supporting/risk status. Company profile alone is insufficient. ' +
      'Unknown reporting periods and missing filings must remain explicit. Do not invent numerical prose. Missing financial evidence requires insufficient_evidence.' });
  if (!result) throw new Error('Local Ollama is unavailable or timed out.');
  const parsed = parseOllamaEvidence(result.text, context);
  return { id: evidenceReviewId(context, modelDigest), modelDigest, policyVersion: OLLAMA_EVIDENCE_POLICY,
    holdingConsiderations: parsed.holdingConsiderations,
    assessment: { ...parsed.review, ticker: context.ticker, source: 'ollama', model: result.model,
      generatedAt: new Date().toISOString(), horizon: 'next_session', context, promptVersion: PREDICTION_AI_PROMPT_VERSION,
      validation: { status: 'unvalidated', note: 'Evidence review is unvalidated. Holding observations and AI verdicts are not probabilities of returns.' } } };
}
