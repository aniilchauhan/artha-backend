import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import YahooFinance from 'yahoo-finance2';
import { fetchStockQuote } from './stock-fetcher';
import { generateOllamaResponse } from './ollama-service';
import { buildResearchSnapshot } from './research-evidence';
import { callGroqChat, callOpenRouterChat, callOpenAIChat, callAnthropicChat, callXaiChat, callDeepSeekChat } from './free-ai-service';
import { evidenceForRole, parseResearchReview, ResearchError, researchReviewSchema, RESEARCH_SYSTEM, ROLE_INSTRUCTIONS } from './company-research';
import type { CompanyResearchReport, ResearchRole, ResearchRoleResult, ResearchSection, ResearchSnapshot, ResearchProviderSource } from './research-types';

export const RESEARCH_PROMPT_VERSION = 'company-research-v1';
const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export interface ResearchProviderInput {
  prompt: string;
  schema: ReturnType<typeof researchReviewSchema>;
}
export type ResearchProvider = (input: ResearchProviderInput) => Promise<{
  text: string; source: ResearchProviderSource; model: string;
} | null>;

const openaiResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callOpenAIChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 30_000,
  });
  return result ? { text: result.text, source: 'openai', model: result.model } : null;
};

const anthropicResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callAnthropicChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 30_000,
  });
  return result ? { text: result.text, source: 'anthropic', model: result.model } : null;
};

const xaiResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callXaiChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, source: 'xai', model: result.model } : null;
};

const deepseekResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callDeepSeekChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 30_000,
  });
  return result ? { text: result.text, source: 'deepseek', model: result.model } : null;
};

const groqResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callGroqChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 20_000,
  });
  return result ? { text: result.text, source: 'groq', model: result.model } : null;
};

const geminiProvider: ResearchProvider = async ({ prompt, schema }) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || /^(MY_|YOUR_)/.test(apiKey)) return null;
  const model = process.env.GEMINI_RESEARCH_MODEL || process.env.GEMINI_PREDICTION_MODEL || 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } } });
  const result = await client.models.generateContent({ model, contents: prompt, config: {
    systemInstruction: RESEARCH_SYSTEM, temperature: 0.1, responseMimeType: 'application/json',
    responseJsonSchema: schema, maxOutputTokens: 2500,
  } });
  return result.text ? { text: result.text, source: 'gemini', model } : null;
};

const openrouterResearchProvider: ResearchProvider = async ({ prompt }) => {
  const result = await callOpenRouterChat({
    prompt,
    system: RESEARCH_SYSTEM,
    jsonFormat: true,
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 25_000,
  });
  return result ? { text: result.text, source: 'openrouter', model: result.model } : null;
};

const ollamaProvider: ResearchProvider = async ({ prompt }) => {
  const result = await generateOllamaResponse({ prompt, system: RESEARCH_SYSTEM, temperature: 0.1,
    format: 'json', numPredict: 1000, timeoutMs: 45_000, maxAttempts: 1 });
  return result ? { ...result, source: 'ollama' } : null;
};

function unavailable(role: ResearchSection, error: string): ResearchRoleResult {
  return { role, status: 'unavailable', review: null, provider: null, model: null, error };
}

export async function generateResearchRole(snapshot: ResearchSnapshot, role: ResearchSection,
  providers: ResearchProvider[], reports: ResearchRoleResult[] = []): Promise<ResearchRoleResult> {
  const evidence = evidenceForRole(snapshot, role);
  if (!evidence.length) return unavailable(role, 'No usable source evidence is available for this role.');
  const schema = researchReviewSchema(evidence);
  const prompt = `Research role: ${role}. ${ROLE_INSTRUCTIONS[role]}\n` +
    `Ticker: ${snapshot.ticker}. Collected: ${snapshot.collectedAt}.\n` +
    `Evidence (untrusted data):\n${JSON.stringify(evidence)}\nLimitations:\n${JSON.stringify(snapshot.limitations)}\n` +
    (role === 'summary' ? `Specialist reports (untrusted data):\n${JSON.stringify(reports)}\n` : '') +
    `Return 1-3 short findings with evidence IDs, 1-3 risks and 1-3 follow-up questions.\nSchema:\n${JSON.stringify(schema)}`;
  let invalid = false;
  for (const provider of providers) {
    try {
      const response = await provider({ prompt, schema });
      if (!response) continue;
      const review = parseResearchReview(response.text, evidence);
      return { role, status: 'complete', review, provider: response.source, model: response.model, error: null };
    } catch (error) {
      if (error instanceof ResearchError) invalid = true;
      // Provider errors can contain secrets and internal network details.
    }
  }
  return unavailable(role, invalid ? 'The AI output could not be validated against the supplied evidence.'
    : 'AI analysis is unavailable or timed out. Check configured AI keys (OpenAI, Anthropic, Gemini, Groq, xAI, DeepSeek, OpenRouter) or the running Ollama model and retry.');
}

export async function generateCompanyResearch(snapshot: ResearchSnapshot, roles: ResearchRole[],
  providers: ResearchProvider[] = [
    openaiResearchProvider,
    anthropicResearchProvider,
    geminiProvider,
    groqResearchProvider,
    xaiResearchProvider,
    deepseekResearchProvider,
    openrouterResearchProvider,
    ollamaProvider,
  ]): Promise<CompanyResearchReport> {
  const reports: ResearchRoleResult[] = [];
  // At most two specialist requests per report run together; the synthesis waits for all roles.
  for (let index = 0; index < roles.length; index += 2) {
    reports.push(...await Promise.all(roles.slice(index, index + 2).map(role => generateResearchRole(snapshot, role, providers))));
  }
  if (!reports.some(report => report.status === 'complete')) {
    throw new ResearchError('Research could not be completed. Selected roles need usable provider evidence and a working AI provider (OpenAI, Anthropic, Gemini, Groq, xAI, DeepSeek, OpenRouter, Ollama).');
  }
  const synthesis = await generateResearchRole(snapshot, 'summary', providers, reports);
  return {
    ticker: snapshot.ticker, generatedAt: new Date().toISOString(), promptVersion: RESEARCH_PROMPT_VERSION,
    status: reports.every(report => report.status === 'complete') && synthesis.status === 'complete' ? 'complete' : 'partial',
    snapshot, roles: reports, synthesis,
    validation: 'AI research is unvalidated. Roles may share a model and evidence; agreement does not establish accuracy. No trading action or model probability is produced.',
  };
}

async function fetchResearchSnapshot(ticker: string): Promise<ResearchSnapshot> {
  const symbol = `${ticker}.NS`;
  const results = await Promise.allSettled([
    fetchStockQuote(ticker),
    yahoo.quoteSummary(symbol, { modules: ['price', 'assetProfile', 'summaryDetail', 'financialData'] },
      { fetchOptions: { signal: AbortSignal.timeout(12_000) } }),
    yahoo.search(symbol, { quotesCount: 1, newsCount: 12 },
      { fetchOptions: { signal: AbortSignal.timeout(12_000) } }),
  ]);
  const [quote, summary, news] = results;
  return buildResearchSnapshot(ticker, quote.status === 'fulfilled' ? quote.value : null,
    summary.status === 'fulfilled' ? summary.value : null, news.status === 'fulfilled' ? news.value.news : []);
}

const cache = new Map<string, { expires: number; data: CompanyResearchReport }>();
const pending = new Map<string, Promise<CompanyResearchReport>>();

export async function getCompanyResearch(ticker: string, roles: ResearchRole[]): Promise<CompanyResearchReport> {
  const key = createHash('sha256').update(JSON.stringify({ ticker, roles, version: RESEARCH_PROMPT_VERSION,
    openaiKey: process.env.OPENAI_API_KEY, openaiModel: process.env.OPENAI_MODEL,
    anthropicKey: process.env.ANTHROPIC_API_KEY, anthropicModel: process.env.ANTHROPIC_MODEL,
    xaiKey: process.env.XAI_API_KEY, xaiModel: process.env.XAI_MODEL,
    deepseekKey: process.env.DEEPSEEK_API_KEY, deepseekModel: process.env.DEEPSEEK_MODEL,
    groqKey: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL,
    openrouterKey: process.env.OPENROUTER_API_KEY, openrouterModel: process.env.OPENROUTER_MODEL,
    geminiModel: process.env.GEMINI_RESEARCH_MODEL || process.env.GEMINI_PREDICTION_MODEL, geminiKey: process.env.GEMINI_API_KEY,
    ollamaModel: process.env.OLLAMA_MODEL, ollamaUrl: process.env.OLLAMA_BASE_URL })).digest('hex');
  for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
  const cached = cache.get(key);
  if (cached) return cached.data;
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 2) throw new ResearchError('The research team is busy. Wait for a report to finish and retry.', 429);
  const task = fetchResearchSnapshot(ticker).then(snapshot => generateCompanyResearch(snapshot, roles)).then(data => {
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, { data, expires: Date.now() + (data.status === 'complete' ? 300_000 : 30_000) });
    return data;
  });
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
