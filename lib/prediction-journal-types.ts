import type { PredictionAiAssessment } from './prediction-ai-types';
import type { normalizeChart } from './market-quote';

export const JOURNAL_POLICY_VERSION = 'next-session-high-touch-v1';
export const JOURNAL_MODEL_SCORE_THRESHOLD = 0.6;
export const JOURNAL_EVENT_RETURN = 0.02;

export type JournalQuote = NonNullable<ReturnType<typeof normalizeChart>>;

export type JournalOutcome = {
  status: 'pending' | 'excluded';
  reason: string;
  evaluatedAt: string;
  targetDay?: string;
} | {
  status: 'completed';
  reason: string;
  evaluatedAt: string;
  referenceDay: string;
  targetDay: string;
  targetOpenAt: string;
  referencePrice: number;
  targetHigh: number;
  targetClose: number;
  eventOccurred: boolean;
  closeReturnPercent: number;
  dataAsOf: string;
  fetchedAt: string;
  benchmarkDataAsOf: string;
  benchmarkFetchedAt: string;
};

export interface JournalEntry {
  id: string;
  ticker: string;
  recordedAt: string;
  assessment: PredictionAiAssessment;
  policyVersion: string;
  promptVersion: string;
  outcome?: JournalOutcome;
}

export interface JournalEventStats {
  count: number;
  eventCount: number;
  /** Observed research event fraction, never a calibrated probability or trade win rate. */
  eventRate: number | null;
}

export interface JournalSelectionStats extends JournalEventStats {
  /** Selected completed rows divided by eligible completed rows in this comparison. */
  coverage: number | null;
}

export interface JournalCohortSummary {
  cohortId: string;
  policyVersion: string;
  promptVersion: string;
  source: PredictionAiAssessment['source'];
  model: string;
  total: number;
  pending: number;
  excluded: number;
  completed: number;
  reviewedUniverse: JournalEventStats;
  aiSupported: JournalSelectionStats;
  matched: {
    count: number;
    quantitative: JournalEventStats;
    aiSupported: JournalSelectionStats;
  };
}

export interface JournalSummary {
  total: number;
  pending: number;
  excluded: number;
  completed: number;
  cohorts: JournalCohortSummary[];
}
