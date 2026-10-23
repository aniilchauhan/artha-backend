export const RESEARCH_ROLES = [
  { id: 'fundamentals', name: 'Company analyst', description: 'Business, profitability, growth and valuation.' },
  { id: 'technical', name: 'Technical analyst', description: 'Completed price history, trend and momentum.' },
  { id: 'news', name: 'News researcher', description: 'Recent company headlines and questions to verify.' },
  { id: 'risk', name: 'Risk reviewer', description: 'Downside, conflicting evidence and information gaps.' },
] as const;

export type ResearchRole = typeof RESEARCH_ROLES[number]['id'];
export type ResearchSection = ResearchRole | 'summary';

export interface ResearchEvidence {
  id: string;
  category: 'price' | 'fundamentals' | 'news';
  label: string;
  value: string | number;
  unit: string | null;
  source: string;
  url: string;
  asOf: string | null;
  retrievedAt: string;
}

export interface ResearchSnapshot {
  ticker: string;
  collectedAt: string;
  evidence: ResearchEvidence[];
  limitations: string[];
}

export interface ResearchReview {
  outlook: 'positive' | 'mixed' | 'negative' | 'uncertain';
  summary: string;
  findings: Array<{ text: string; evidenceIds: string[] }>;
  risks: string[];
  questions: string[];
}

export type ResearchProviderSource =
  | 'gemini'
  | 'groq'
  | 'huggingface'
  | 'openrouter'
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'deepseek';

export interface ResearchRoleResult {
  role: ResearchSection;
  status: 'complete' | 'unavailable';
  review: ResearchReview | null;
  provider: ResearchProviderSource | null;
  model: string | null;
  error: string | null;
}

export interface CompanyResearchReport {
  kind?: 'ai' | 'framework';
  framework?: import('./framework-types').FrameworkReport;
  ticker: string;
  generatedAt: string;
  promptVersion: string;
  status: 'complete' | 'partial';
  snapshot: ResearchSnapshot;
  roles: ResearchRoleResult[];
  synthesis: ResearchRoleResult;
  validation: string;
}

export interface ResearchSaveReceipt {
  status: 'saved' | 'existing' | 'unavailable';
  id?: string;
  savedAt?: string;
  message: string;
}

export interface ResearchHistoryItem {
  id: string;
  ticker: string;
  savedAt: string;
  generatedAt: string;
  roles: ResearchRole[];
  status: CompanyResearchReport['status'];
  summary: string;
}

export interface ResearchHistoryPage {
  items: ResearchHistoryItem[];
  nextCursor: string | null;
}

export interface SavedResearchReport {
  id: string;
  savedAt: string;
  report: CompanyResearchReport;
}
