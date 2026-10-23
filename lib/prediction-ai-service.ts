import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { getArtifactProvenance } from './artifact-provenance';
import { getLatestPredictions } from './stock-ai-service';
import { fetchPredictionInputs } from './prediction-evidence-service';
import { enrichPredictionContext } from './prediction-evidence';
import { attachPredictionDiscovery } from './prediction-discovery';
import { generateOllamaResponse } from './ollama-service';
import { callGroqChat, callOpenRouterChat, callOpenAIChat, callAnthropicChat, callXaiChat, callDeepSeekChat } from './free-ai-service';
import { buildPredictionAiContext, normalizePredictionTicker, parsePredictionReview,
  PREDICTION_AI_SYSTEM, PredictionAiError, predictionReviewSchema } from './prediction-ai';
import type { PredictionAiAssessment, PredictionAiContext, PredictionAiSource } from './prediction-ai-types';

export type PredictionAiProvider = (context: PredictionAiContext) => Promise<{
  text: string; source: PredictionAiSource; model: string;
} | null>;

// Bump when changing instructions, evidence construction, or response semantics.
export const PREDICTION_AI_PROMPT_VERSION = 'web-social-evidence-v4';

export function promptFor(context: PredictionAiContext, schema: Record<string, unknown> = predictionReviewSchema(context)): string {
  const m = context.metrics;
  const compare = (key: string) => `close is ${m.close > m[key] ? 'above' : m.close < m[key] ? 'below' : 'equal to'} ${key}.`;
  const facts = [
    ...['sma20', 'sma50', 'low20dClose', 'high20dClose'].map(compare),
    `rsi14 is ${m.rsi14 < 30 ? 'below 30 (oversold)' : m.rsi14 > 70 ? 'above 70 (overbought)' : 'between 30 and 70 (neither oversold nor overbought)'}.`,
    ...['return1dPct', 'return5dPct', 'return20dPct'].map(key => `${key} is ${m[key] > 0 ? 'positive' : m[key] < 0 ? 'negative' : 'zero'}.`),
  ];
  // Use calculated observations, so a small local model need not reconstruct arithmetic
  // from a long candle table. The full source snapshot remains attached to the result.
  const { recentCloses: _recentCloses, ...evidence } = context;
  return `Assess the bullish breakout setup using this evidence snapshot.\n${JSON.stringify(evidence)}\n` +
    `These comparisons are already calculated and must not be contradicted:\n${facts.join('\n')}\n` +
    'Explain implications and uncertainty; do not recompute comparisons or repeat numerical values in prose. ' +
    'A low price or falling RSI alone is not evidence of a bullish breakout.\n' +
    `Return JSON matching this schema:\n${JSON.stringify(schema)}`;
}

const openaiProvider: PredictionAiProvider = async context => {
  const result = await callOpenAIChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, model: result.model, source: 'openai' } : null;
};

const anthropicProvider: PredictionAiProvider = async context => {
  const result = await callAnthropicChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, model: result.model, source: 'anthropic' } : null;
};

const xaiProvider: PredictionAiProvider = async context => {
  const result = await callXaiChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, model: result.model, source: 'xai' } : null;
};

const deepseekProvider: PredictionAiProvider = async context => {
  const result = await callDeepSeekChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, model: result.model, source: 'deepseek' } : null;
};

const groqProvider: PredictionAiProvider = async context => {
  const result = await callGroqChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 15_000,
  });
  return result ? { text: result.text, model: result.model, source: 'groq' } : null;
};

const geminiProvider: PredictionAiProvider = async context => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || /^(MY_|YOUR_)/.test(apiKey)) return null;
  const model = process.env.GEMINI_PREDICTION_MODEL || 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } } });
  const result = await client.models.generateContent({
    model, contents: promptFor(context),
    config: { systemInstruction: PREDICTION_AI_SYSTEM, temperature: 0.1,
      responseMimeType: 'application/json', responseJsonSchema: predictionReviewSchema(context), maxOutputTokens: 4096 },
  });
  return result.text ? { text: result.text, model, source: 'gemini' } : null;
};

const openrouterProvider: PredictionAiProvider = async context => {
  const result = await callOpenRouterChat({
    prompt: promptFor(context),
    system: PREDICTION_AI_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2048,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, model: result.model, source: 'openrouter' } : null;
};

const huggingfaceProvider: PredictionAiProvider = async context => {
  const apiKey = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN)?.trim();
  if (!apiKey || /^(MY_|YOUR_)/.test(apiKey)) return null;
  const model = process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: `${PREDICTION_AI_SYSTEM}\n\n${promptFor(context)}`,
        parameters: { max_new_tokens: 1500, temperature: 0.1, return_full_text: false },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;
    return text ? { text, model, source: 'huggingface' } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const ollamaPredictionProvider: PredictionAiProvider = async context => {
  const result = await generateOllamaResponse({ prompt: promptFor(context), system: PREDICTION_AI_SYSTEM,
    temperature: 0, format: predictionReviewSchema(context), numPredict: 1800, timeoutMs: 90_000, maxAttempts: 1 });
  return result ? { ...result, source: 'ollama' } : null;
};

// Provider failures or malformed model output can only fall back to another actual model.
export async function generatePredictionAssessment(
  context: PredictionAiContext,
  providers: PredictionAiProvider[] = [
    openaiProvider,
    anthropicProvider,
    geminiProvider,
    groqProvider,
    xaiProvider,
    deepseekProvider,
    openrouterProvider,
    huggingfaceProvider,
    ollamaPredictionProvider,
  ],
): Promise<PredictionAiAssessment> {
  let invalidOutput = false;
  for (const provider of providers) {
    try {
      const response = await provider(context);
      if (!response) continue;
      const review = parsePredictionReview(response.text, context);
      return { ...review, promptVersion: PREDICTION_AI_PROMPT_VERSION, ticker: context.ticker, source: response.source, model: response.model,
        generatedAt: new Date().toISOString(), horizon: 'next_session', context,
        validation: { status: 'unvalidated', note: 'AI judgment has not been validated against future outcomes. No improvement in prediction accuracy is established.' } };
    } catch (error) {
      if (error instanceof PredictionAiError && error.status === 502) invalidOutput = true;
      // Do not expose provider errors: they can contain credentials or transport details.
    }
  }
  if (invalidOutput) throw new PredictionAiError('AI providers returned unsupported assessments. Please try again.', 502);
  throw new PredictionAiError('AI analysis is unavailable or timed out. Check the configured AI keys (OpenAI, Anthropic, Gemini, Groq, xAI, DeepSeek, OpenRouter) or running Ollama model, then try again. The first local run may take longer while the model loads.');
}

const cache = new Map<string, { expires: number; data: PredictionAiAssessment }>();
const pending = new Map<string, Promise<PredictionAiAssessment>>();

export async function getPredictionAiAssessment(input: unknown): Promise<PredictionAiAssessment> {
  const ticker = normalizePredictionTicker(input);
  const key = createHash('sha256').update(JSON.stringify({ version: PREDICTION_AI_PROMPT_VERSION, ticker,
    openaiKey: process.env.OPENAI_API_KEY, openaiModel: process.env.OPENAI_PREDICTION_MODEL || process.env.OPENAI_MODEL,
    anthropicKey: process.env.ANTHROPIC_API_KEY, anthropicModel: process.env.ANTHROPIC_PREDICTION_MODEL || process.env.ANTHROPIC_MODEL,
    xaiKey: process.env.XAI_API_KEY, xaiModel: process.env.XAI_MODEL,
    deepseekKey: process.env.DEEPSEEK_API_KEY, deepseekModel: process.env.DEEPSEEK_MODEL,
    groqKey: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL,
    openrouterKey: process.env.OPENROUTER_API_KEY, openrouterModel: process.env.OPENROUTER_MODEL,
    hfKey: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN,
    geminiModel: process.env.GEMINI_PREDICTION_MODEL, geminiKey: process.env.GEMINI_API_KEY,
    braveKey: process.env.BRAVE_SEARCH_API_KEY, xToken: process.env.X_BEARER_TOKEN,
    ollamaModel: process.env.OLLAMA_MODEL, ollamaUrl: process.env.OLLAMA_BASE_URL })).digest('hex');
  const now = Date.now();
  for (const [id, item] of cache) if (item.expires <= now) cache.delete(id);
  const cached = cache.get(key);
  if (cached) return cached.data;
  const inProgress = pending.get(key);
  if (inProgress) return inProgress;
  if (pending.size >= 4) throw new PredictionAiError('AI analysis is busy. Wait for an assessment to finish and try again.', 429);
  const task = (async () => {
    const context = await collectPredictionAiContext(ticker);
    return generatePredictionAssessment(context);
  })().then(data => {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 90_000, data });
    return data;
  });
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

export async function collectPredictionAiContext(input: unknown): Promise<PredictionAiContext> {
    const ticker = normalizePredictionTicker(input);
    const { quote, summary, news, benchmark, discovery } = await fetchPredictionInputs(ticker);
    // Quantitative files are optional evidence, including when a file is corrupt or unreadable.
    let baseline = null;
    let verified = false;
    try {
      verified = getArtifactProvenance('latest_predictions.json').status === 'verified';
      baseline = verified ? getLatestPredictions().find(prediction =>
        prediction.Ticker.toUpperCase().replace(/\.NS$/, '') === ticker) ?? null : null;
    } catch { verified = false; }
    const priceContext = buildPredictionAiContext(ticker, quote, baseline, verified);
    const context = attachPredictionDiscovery(enrichPredictionContext(priceContext, quote!, summary, news, benchmark), discovery);
    return context;
}
