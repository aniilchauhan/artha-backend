/**
 * Free AI Provider Hub for Axion Market Intelligence & Stock Predictions
 * Integrates all major available free AI services & models:
 * 1. Groq Cloud (Free Tier): Ultra-fast inference with Llama 3.3 70B, DeepSeek R1 Distill, Llama 3.1 8B
 * 2. Hugging Face Inference API (Free Tier): ProsusAI/finbert (Financial Sentiment) & Open-source LLMs
 * 3. OpenRouter (Free Tier): Free open-weight models (DeepSeek R1, Llama 3.3, Mistral)
 * 4. Google Gemini (Free Tier): Gemini 2.5 Flash / 2.0 Flash
 * 5. Local Ollama: 100% private offline inference
 * 6. Autonomous Financial NLP & Quantitative GBDT Baseline
 */

export interface FreeAiProvidersStatus {
  groq: {
    available: boolean;
    model: string | null;
    freeTier: true;
    latency: string;
  };
  gemini: {
    available: boolean;
    model: string | null;
    freeTier: true;
  };
  huggingface: {
    available: boolean;
    finbertReady: boolean;
    model: string | null;
    freeTier: true;
  };
  openrouter: {
    available: boolean;
    model: string | null;
    freeTier: true;
  };
  ollama: {
    available: boolean;
    url: string;
    activeModel: string | null;
    installedModels: string[];
  };
  headroom?: {
    available: boolean;
    url: string;
    version?: string;
  };
  openai?: {
    available: boolean;
    model: string | null;
  };
  anthropic?: {
    available: boolean;
    model: string | null;
  };
  xai?: {
    available: boolean;
    model: string | null;
  };
  deepseek?: {
    available: boolean;
    model: string | null;
  };
  quantEngine: {
    available: boolean;
    type: string;
  };
  activeProviders: string[];
}

export interface FinBertSentimentResult {
  score: number; // -1.0 to +1.0
  label: 'Bullish' | 'Bearish' | 'Neutral';
  confidence: number; // 0.0 to 1.0
  breakdown: {
    positive: number;
    negative: number;
    neutral: number;
  };
  headlineAnalyzed: string;
  model: string;
}

// ─── Key Validators ─────────────────────────────────────────────────────────

export function isApiKeyValid(key: string | undefined): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed.length < 8) return false;
  if (/^(MY_|YOUR_|REPLACE_|ENTER_)/i.test(trimmed)) return false;
  return true;
}

export function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getHuggingFaceApiKey(): string | null {
  const key = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getOpenAIApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getAnthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getXaiApiKey(): string | null {
  const key = process.env.XAI_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

export function getDeepSeekApiKey(): string | null {
  const key = process.env.DEEPSEEK_API_KEY;
  return isApiKeyValid(key) ? key!.trim() : null;
}

// ─── Default Model Selectors ────────────────────────────────────────────────

export function getGroqModel(): string {
  return process.env.GROQ_MODEL || process.env.GROQ_PREDICTION_MODEL || 'llama-3.3-70b-versatile';
}

export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free';
}

export function getGeminiModel(): string {
  return process.env.GEMINI_PREDICTION_MODEL || 'gemini-2.5-flash';
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_PREDICTION_MODEL || process.env.OPENAI_MODEL || 'o3-mini';
}

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_PREDICTION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
}

export function getXaiModel(): string {
  return process.env.XAI_MODEL || 'grok-2-latest';
}

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL || 'deepseek-reasoner';
}

// ─── Groq Cloud API (Free Tier) ─────────────────────────────────────────────

export interface GroqCompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callGroqChat(options: GroqCompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getGroqApiKey();
  if (!apiKey) return null;

  const model = options.model || getGroqModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.jsonFormat) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Hugging Face FinBERT Financial Sentiment (Free Tier) ───────────────────

/**
 * Evaluates financial text using ProsusAI/finbert (state-of-the-art financial NLP).
 * FinBERT is specifically trained on Financial PhraseBank to analyze earnings,
 * analyst reports, and market news headlines.
 */
export async function analyzeFinBertSentiment(
  headlines: string[],
  ticker?: string
): Promise<FinBertSentimentResult | null> {
  const apiKey = getHuggingFaceApiKey();
  if (!apiKey || headlines.length === 0) return null;

  const cleanHeadlines = headlines
    .map(h => h.trim())
    .filter(h => h.length > 5)
    .slice(0, 5);

  if (cleanHeadlines.length === 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    // We try the standard inference API
    const response = await fetch(
      'https://api-inference.huggingface.co/models/ProsusAI/finbert',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          inputs: cleanHeadlines,
          options: { wait_for_model: true },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) return null;
    const results = await response.json();

    // FinBERT returns an array of label probabilities for each input sentence:
    // [[{ label: 'positive', score: 0.8 }, { label: 'negative', score: 0.1 }, { label: 'neutral', score: 0.1 }], ...]
    if (!Array.isArray(results) || results.length === 0) return null;

    let totalPos = 0;
    let totalNeg = 0;
    let totalNeu = 0;
    let bestHeadline = cleanHeadlines[0];
    let maxPolarity = 0;

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      if (!Array.isArray(item)) continue;

      let pos = 0, neg = 0, neu = 0;
      for (const row of item) {
        const lbl = String(row.label || '').toLowerCase();
        const sc = Number(row.score || 0);
        if (lbl === 'positive') pos = sc;
        else if (lbl === 'negative') neg = sc;
        else if (lbl === 'neutral') neu = sc;
      }

      totalPos += pos;
      totalNeg += neg;
      totalNeu += neu;

      const polarity = Math.abs(pos - neg);
      if (polarity > maxPolarity) {
        maxPolarity = polarity;
        bestHeadline = cleanHeadlines[i] || bestHeadline;
      }
    }

    const n = Math.max(1, results.length);
    const avgPos = totalPos / n;
    const avgNeg = totalNeg / n;
    const avgNeu = totalNeu / n;

    // Score from -1.0 (strongly negative) to +1.0 (strongly positive)
    const netScore = Math.max(-1.0, Math.min(1.0, (avgPos - avgNeg) * (1 - avgNeu * 0.5)));
    const roundedScore = Math.round(netScore * 1000) / 1000;

    let label: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
    if (roundedScore >= 0.15) label = 'Bullish';
    else if (roundedScore <= -0.15) label = 'Bearish';

    const confidence = Math.round(Math.max(avgPos, avgNeg, avgNeu) * 100) / 100;

    return {
      score: roundedScore,
      label,
      confidence,
      breakdown: {
        positive: Math.round(avgPos * 100) / 100,
        negative: Math.round(avgNeg * 100) / 100,
        neutral: Math.round(avgNeu * 100) / 100,
      },
      headlineAnalyzed: bestHeadline,
      model: 'ProsusAI/finbert',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── OpenRouter API (Free Tier) ─────────────────────────────────────────────

export interface OpenRouterCompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callOpenRouterChat(options: OpenRouterCompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;

  const model = options.model || getOpenRouterModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.jsonFormat) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://axion.local',
        'X-Title': 'Artha AI',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── OpenAI API (o3-mini, GPT-4o, GPT-4o-mini) ───────────────────────────────

export interface OpenAICompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callOpenAIChat(options: OpenAICompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;

  const model = options.model || getOpenAIModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);

  try {
    const isReasoningModel = /^(o1|o3)/i.test(model);
    const messages: Array<{ role: 'system' | 'developer' | 'user'; content: string }> = [];
    if (options.system) {
      messages.push({ role: isReasoningModel ? 'developer' : 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const payload: Record<string, unknown> = {
      model,
      messages,
    };

    if (isReasoningModel) {
      // o1/o3 reasoning models use max_completion_tokens and do not support custom temperature
      payload.max_completion_tokens = options.maxTokens ?? 2048;
    } else {
      payload.temperature = options.temperature ?? 0.1;
      payload.max_tokens = options.maxTokens ?? 2048;
    }

    if (options.jsonFormat) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Anthropic Claude API (Claude 3.7 Sonnet, Claude 3.5 Sonnet/Haiku) ────────

export interface AnthropicCompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callAnthropicChat(options: AnthropicCompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) return null;

  const model = options.model || getAnthropicModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);

  try {
    let system = options.system || '';
    if (options.jsonFormat && !system.includes('JSON')) {
      system = `${system}\nReturn valid JSON only. Do not include markdown codeblocks or text outside the JSON.`.trim();
    }

    const payload: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 2500,
      messages: [{ role: 'user', content: options.prompt }],
    };

    if (system) {
      payload.system = system;
    }

    if (options.temperature !== undefined) {
      payload.temperature = options.temperature;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const textBlock = data?.content?.find((c: any) => c.type === 'text') || data?.content?.[0];
    const content = textBlock?.text;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── xAI Grok API (Grok 2 / Grok 3 / Grok Beta) ──────────────────────────────

export interface XaiCompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callXaiChat(options: XaiCompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getXaiApiKey();
  if (!apiKey) return null;

  const model = options.model || getXaiModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25_000);

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.jsonFormat) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── DeepSeek API Direct (Reasoner R1 / Chat V3) ─────────────────────────────

export interface DeepSeekCompletionOptions {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  jsonFormat?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function callDeepSeekChat(options: DeepSeekCompletionOptions): Promise<{ text: string; model: string } | null> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) return null;

  const model = options.model || getDeepSeekModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30_000);

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (options.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: options.prompt });

    const isReasoner = model.includes('reasoner');
    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (!isReasoner) {
      payload.temperature = options.temperature ?? 0.1;
    }

    if (options.jsonFormat && !isReasoner) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return { text: content.trim(), model };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Multi-Tier Autonomous Cascading Engine ─────────────────────────────────

export interface MultiTierAiOptions {
  prompt: string;
  system?: string;
  jsonFormat?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Queries all available free AI tools in priority order of speed and capability:
 * 1. Groq (sub-second LPU speed, Llama 3.3 70B / DeepSeek R1 Distill)
 * 2. OpenRouter (free tier models)
 * Returns the first successful response along with provider metadata.
 */
export async function queryFreeAiModels(
  options: MultiTierAiOptions
): Promise<{ text: string; source: 'groq' | 'openrouter'; model: string } | null> {
  // 1. Try Groq (ultra fast, high intelligence)
  const groqResult = await callGroqChat({
    prompt: options.prompt,
    system: options.system,
    jsonFormat: options.jsonFormat,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });
  if (groqResult) {
    return { text: groqResult.text, source: 'groq', model: groqResult.model };
  }

  // 2. Try OpenRouter free models
  const openRouterResult = await callOpenRouterChat({
    prompt: options.prompt,
    system: options.system,
    jsonFormat: options.jsonFormat,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });
  if (openRouterResult) {
    return { text: openRouterResult.text, source: 'openrouter', model: openRouterResult.model };
  }

  return null;
}

// ─── Free AI Status Aggregate ───────────────────────────────────────────────

export async function getFreeAiStatus(): Promise<FreeAiProvidersStatus> {
  const groqKey = getGroqApiKey();
  const geminiKey = getGeminiApiKey();
  const hfKey = getHuggingFaceApiKey();
  const openRouterKey = getOpenRouterApiKey();

  // Ollama detection
  const ollamaUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
  let ollamaAvailable = false;
  let installedModels: string[] = [];
  let activeOllamaModel: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      installedModels = (data.models || []).map((m: any) => m.name || '').filter(Boolean);
      ollamaAvailable = installedModels.length > 0;
      activeOllamaModel = process.env.OLLAMA_MODEL || (installedModels.length > 0 ? installedModels[0] : null);
    }
  } catch {
    ollamaAvailable = false;
  }

  // Headroom Context Optimization detection
  const headroomUrl = (process.env.HEADROOM_PROXY_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '').replace(/\/v1$/, '');
  let headroomAvailable = false;
  let headroomVersion: string | undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch(`${headroomUrl}/livez`, { signal: controller.signal });
    clearTimeout(timeout);
    if (resp.ok) {
      const data = await resp.json();
      headroomAvailable = data?.alive === true || data?.status === 'healthy';
      headroomVersion = data?.version;
    }
  } catch {
    headroomAvailable = false;
  }

  const activeProviders: string[] = [];
  const openaiKey = getOpenAIApiKey();
  const anthropicKey = getAnthropicApiKey();
  const xaiKey = getXaiApiKey();
  const deepseekKey = getDeepSeekApiKey();

  if (openaiKey) activeProviders.push(`OpenAI (${getOpenAIModel()})`);
  if (anthropicKey) activeProviders.push(`Anthropic (${getAnthropicModel()})`);
  if (xaiKey) activeProviders.push(`xAI Grok (${getXaiModel()})`);
  if (deepseekKey) activeProviders.push(`DeepSeek (${getDeepSeekModel()})`);
  if (groqKey) activeProviders.push('Groq (Llama 3.3 / DeepSeek R1)');
  if (geminiKey) activeProviders.push('Google Gemini 2.5');
  if (hfKey) activeProviders.push('Hugging Face FinBERT');
  if (openRouterKey) activeProviders.push('OpenRouter Free');
  if (ollamaAvailable) activeProviders.push(`Ollama Local (${activeOllamaModel || 'Ready'})`);
  if (headroomAvailable) activeProviders.push(`Headroom Context Optimization (v${headroomVersion || '0.39.1'})`);
  activeProviders.push('GBDT Quant + Autonomous NLP');

  return {
    groq: {
      available: !!groqKey,
      model: groqKey ? getGroqModel() : null,
      freeTier: true,
      latency: '<400ms (LPU)',
    },
    gemini: {
      available: !!geminiKey,
      model: geminiKey ? getGeminiModel() : null,
      freeTier: true,
    },
    huggingface: {
      available: !!hfKey,
      finbertReady: !!hfKey,
      model: hfKey ? 'ProsusAI/finbert' : null,
      freeTier: true,
    },
    openrouter: {
      available: !!openRouterKey,
      model: openRouterKey ? getOpenRouterModel() : null,
      freeTier: true,
    },
    ollama: {
      available: ollamaAvailable,
      url: ollamaUrl,
      activeModel: activeOllamaModel,
      installedModels,
    },
    headroom: {
      available: headroomAvailable,
      url: headroomUrl,
      version: headroomVersion,
    },
    openai: {
      available: !!openaiKey,
      model: openaiKey ? getOpenAIModel() : null,
    },
    anthropic: {
      available: !!anthropicKey,
      model: anthropicKey ? getAnthropicModel() : null,
    },
    xai: {
      available: !!xaiKey,
      model: xaiKey ? getXaiModel() : null,
    },
    deepseek: {
      available: !!deepseekKey,
      model: deepseekKey ? getDeepSeekModel() : null,
    },
    quantEngine: {
      available: true,
      type: 'LightGBM / XGBoost / CatBoost Ensemble + Technical AI',
    },
    activeProviders,
  };
}
