/**
 * Ollama Local AI Inference Service
 * Connects to local or remote Ollama instance (default: http://localhost:11434)
 */

export interface OllamaGenerateOptions {
  model?: string;
  prompt: string;
  system?: string;
  temperature?: number;
  timeoutMs?: number;
  format?: string | Record<string, unknown>;
  numPredict?: number;
  numCtx?: number;
  maxAttempts?: number;
}

export interface AiProviderStatus {
  gemini: {
    available: boolean;
  };
  ollama: {
    available: boolean;
    url: string;
    activeModel: string | null;
    installedModels: string[];
  };
  groq?: {
    available: boolean;
    model: string | null;
    freeTier: true;
    latency: string;
  };
  huggingface?: {
    available: boolean;
    finbertReady: boolean;
    model: string | null;
    freeTier: true;
  };
  openrouter?: {
    available: boolean;
    model: string | null;
    freeTier: true;
  };
  quantEngine?: {
    available: boolean;
    type: string;
  };
  activeProviders?: string[];
}

const OLLAMA_RETRY_ATTEMPTS = 3;

function normalizeModelName(name: string): string {
  return (name || '').trim();
}

export function pickPreferredOllamaModel(models: string[], preferredModel?: string | null): string | null {
  const available = [...new Set(models.filter(Boolean).map(normalizeModelName))];
  if (available.length === 0) return null;

  const preferred = normalizeModelName(preferredModel || '');
  if (preferred) {
    const exactMatch = available.find(model => model.toLowerCase() === preferred.toLowerCase());
    if (exactMatch) return exactMatch;
  }

  const preferredOrder = [
    ...available.filter(model => /(?:^|[-:])instruct(?:$|[-:])/i.test(model) || /instruct/i.test(model)),
    ...available.filter(model => /llama/i.test(model)),
    ...available.filter(model => /mistral/i.test(model)),
    ...available.filter(model => /qwen/i.test(model)),
    ...available,
  ];

  return preferredOrder[0] || available[0];
}

export function getOllamaBaseUrl(): string {
  const url = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  return url.replace(/\/+$/, '');
}

async function fetchOllamaJson<T>(url: string, init: RequestInit, retries = OLLAMA_RETRY_ATTEMPTS): Promise<T | null> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        if (attempt < retries && res.status >= 500) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        return null;
      }

      return await res.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  if (lastError) throw lastError;
  return null;
}

export async function getOllamaModels(): Promise<string[]> {
  try {
    const baseUrl = getOllamaBaseUrl();
    const data = await fetchOllamaJson<{ models?: Array<{ name?: string; model?: string }> }>(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, 1);

    if (!data || !Array.isArray(data.models)) return [];
    return data.models.map((m: any) => normalizeModelName(m.name || m.model)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const baseUrl = getOllamaBaseUrl();
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function cleanJsonText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function generateOllamaResponse(options: OllamaGenerateOptions): Promise<{ text: string; model: string } | null> {
  try {
    const availableModels = await getOllamaModels();
    // A stale environment preference must not disable installed local models.
    // An explicit per-request model is still honored exactly.
    let modelToUse = normalizeModelName(options.model ||
      pickPreferredOllamaModel(availableModels, process.env.OLLAMA_MODEL) || process.env.OLLAMA_MODEL || '');

    if (!modelToUse && availableModels.length === 0) {
      console.log('[Ollama Service] No Ollama models detected. Local AI unavailable.');
      return null;
    }

    if (!modelToUse) {
      modelToUse = pickPreferredOllamaModel(availableModels) || '';
    }

    if (!modelToUse) {
      return null;
    }

    const payload: any = {
      model: modelToUse,
      prompt: options.prompt,
      stream: false,
      options: {
        num_predict: options.numPredict ?? 800,
        temperature: options.temperature ?? 0.2,
        ...(options.numCtx ? { num_ctx: options.numCtx } : {}),
      },
    };
    if (options.system) {
      payload.system = options.system;
    }
    if (options.format) {
      payload.format = options.format;
    }

    const baseUrl = getOllamaBaseUrl();
    let lastResult: { response?: string } | null = null;

    const maxAttempts = Math.max(1, Math.min(OLLAMA_RETRY_ATTEMPTS, options.maxAttempts ?? OLLAMA_RETRY_ATTEMPTS));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(options.timeoutMs || 60000),
        });

        if (!res.ok) {
          if (attempt < maxAttempts - 1 && res.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
            continue;
          }
          console.log('[Ollama Service] Model request failed:', res.status, res.statusText, 'Model:', modelToUse, 'URL:', baseUrl);
          return null;
        }

        lastResult = await res.json();
        if (lastResult?.response) {
          return { text: lastResult.response.trim(), model: modelToUse };
        }
        return null;
      } catch (err: any) {
        if (attempt < maxAttempts - 1) {
          console.log('[Ollama Service] Transient request error, retrying:', err?.message);
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        console.log('[Ollama Service] Request error after retries:', err?.message, 'Model:', modelToUse, 'URL:', baseUrl);
        return null;
      }
    }

    if (lastResult?.response) {
      return { text: lastResult.response.trim(), model: modelToUse };
    }
    return null;
  } catch (err: any) {
    console.log('[Ollama Service] Request error:', err?.message);
    return null;
  }
}

export async function getAiProviderStatus(): Promise<AiProviderStatus> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiAvailable = !!geminiKey && 
    geminiKey !== 'MY_GEMINI_API_KEY' && 
    geminiKey !== 'YOUR_ACTUAL_GEMINI_API_KEY' && 
    geminiKey !== 'YOUR_GEMINI_API_KEY';

  const baseUrl = getOllamaBaseUrl();
  const models = await getOllamaModels();
  const ollamaAvailable = models.length > 0;
  
  const activeModel = ollamaAvailable ? pickPreferredOllamaModel(models, process.env.OLLAMA_MODEL) : null;

  // Free Cloud AI providers
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const groqAvailable = !!groqKey && !/^(MY_|YOUR_)/i.test(groqKey);

  const hfKey = (process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN)?.trim();
  const hfAvailable = !!hfKey && !/^(MY_|YOUR_)/i.test(hfKey);

  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const openrouterAvailable = !!openrouterKey && !/^(MY_|YOUR_)/i.test(openrouterKey);

  const activeProviders: string[] = [];
  if (groqAvailable) activeProviders.push('Groq (Llama 3.3 / DeepSeek R1)');
  if (geminiAvailable) activeProviders.push('Google Gemini 2.5');
  if (hfAvailable) activeProviders.push('Hugging Face FinBERT');
  if (openrouterAvailable) activeProviders.push('OpenRouter Free');
  if (ollamaAvailable) activeProviders.push(`Ollama Local (${activeModel || 'Ready'})`);
  activeProviders.push('GBDT Quant + Autonomous NLP');

  return {
    gemini: {
      available: geminiAvailable,
    },
    ollama: {
      available: ollamaAvailable,
      url: baseUrl,
      activeModel,
      installedModels: models,
    },
    groq: {
      available: groqAvailable,
      model: groqAvailable ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile') : null,
      freeTier: true,
      latency: '<400ms (LPU)',
    },
    huggingface: {
      available: hfAvailable,
      finbertReady: hfAvailable,
      model: hfAvailable ? 'ProsusAI/finbert' : null,
      freeTier: true,
    },
    openrouter: {
      available: openrouterAvailable,
      model: openrouterAvailable ? (process.env.OPENROUTER_MODEL || 'deepseek/deepseek-r1:free') : null,
      freeTier: true,
    },
    quantEngine: {
      available: true,
      type: 'LightGBM / XGBoost / CatBoost Ensemble + Technical AI',
    },
    activeProviders,
  };
}
