export type AiPredictionVerdict = 'supports_setup' | 'caution' | 'conflicts_with_setup' | 'insufficient_evidence';

export interface PredictionEvidence {
  id: string;
  category: 'price' | 'fundamentals' | 'news' | 'events' | 'market' | 'volume' | 'web' | 'x' | 'instagram';
  label: string;
  value: string | number;
  unit: string | null;
  source: string;
  url: string;
  asOf: string | null;
  retrievedAt: string;
  contentType?: 'search_excerpt' | 'social_post';
  verification?: 'unverified';
}

export interface PredictionAiContext {
  ticker: string;
  quoteAsOf: string;
  historyAsOf: string;
  referencePrice: number;
  quoteStatus: string;
  metrics: Record<string, number>;
  recentCloses: Array<{ date: string; close: number }>;
  baseline: {
    status: 'available' | 'unavailable';
    score: number | null;
    date: string | null;
    reason: string;
  };
  limitations: string[];
  // Optional for immutable reviews saved before multi-source evidence was introduced.
  sources?: PredictionEvidence[];
  coverage?: Array<{ category: PredictionEvidence['category']; status: 'available' | 'unavailable'; detail?: string }>;
}

export interface PredictionDiscovery {
  sources: PredictionEvidence[];
  coverage: NonNullable<PredictionAiContext['coverage']>;
  limitations: string[];
}

export interface PredictionAiReview {
  verdict: AiPredictionVerdict;
  outlook: 'bullish' | 'neutral' | 'bearish' | 'uncertain';
  summary: string;
  evidence: Array<{ metric: string; interpretation: string }>;
  risks: string[];
  invalidation: string;
}

export type PredictionAiSource =
  | 'gemini'
  | 'groq'
  | 'huggingface'
  | 'openrouter'
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'deepseek';

export interface PredictionAiAssessment extends PredictionAiReview {
  promptVersion?: string;
  journal?: PredictionJournalReceipt;
  ticker: string;
  source: PredictionAiSource;
  model: string;
  generatedAt: string;
  horizon: 'next_session';
  context: PredictionAiContext;
  validation: { status: 'unvalidated'; note: string };
}

export interface PredictionJournalReceipt {
  status: 'recorded' | 'existing' | 'unavailable';
  id?: string;
  recordedAt?: string;
  message: string;
}
