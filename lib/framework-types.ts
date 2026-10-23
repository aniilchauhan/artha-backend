import type { PositionScenario, PositionSize } from './position-sizing';

export type FrameworkId = 'momentum-rs55' | 'sma44-pullback';
export type ResearchHorizon = 'week' | 'month' | 'year' | 'multibagger';
export interface HorizonAssessment {
  horizon: ResearchHorizon;
  label: string;
  flag: string;
  status: 'candidate' | 'wait' | 'insufficient_evidence' | 'no_match';
  assessedAt: string;
  referencePrice: number | null;
  benchmarkReferencePrice: number | null;
  entryTriggerPrice: number | null;
  invalidationPrice: number | null;
  entryValiditySessions: number | null;
  deadline: string;
  outcomeDefinition: string;
  thesis: string;
  bullCase: string;
  baseCase: string;
  bearCase: string;
  entryCondition: string;
  invalidation: string;
  reviewPlan: string;
  evidence: string[];
  missingEvidence: string[];
  probability: null;
}
export type CheckStatus = 'pass' | 'fail' | 'unavailable' | 'not_applicable';
export interface FrameworkCheck {
  id: string;
  label: string;
  status: CheckStatus;
  required: boolean;
  observed: string | number | null;
  unit: string | null;
  rule: string;
  explanation: string;
  evidenceIds: string[];
}
export interface FrameworkBar {
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface FrameworkHistory {
  symbol: string;
  currency: 'INR';
  source: string;
  url: string;
  retrievedAt: string;
  observedAt: string;
  cutoff: string;
  origin: 'provider';
  adjustment: 'provider-ohlc-post-split';
  bars: FrameworkBar[];
  limitations: string[];
}
export interface FrameworkEvidence {
  id: string;
  label: string;
  source: string;
  url: string;
  asOf: string;
  retrievedAt: string;
  origin: 'provider';
  symbol: string;
  unit: string;
  observations: number;
}
export interface FrameworkEvaluation {
  id: FrameworkId;
  version: string;
  name: string;
  status: 'candidate' | 'no_match' | 'unavailable';
  checks: FrameworkCheck[];
  // Reference levels only: neither an order nor a confirmed entry.
  levels: { trigger: number; stop: number; expiresAfterSessions: number; rounding: string } | null;
}
export interface FrameworkReport {
  horizonAssessment?: HorizonAssessment;
  financials?: import('./framework-financials').FinancialEvidence;
  backtest?: import('./framework-backtest').FrameworkBacktest;
  version: 'framework-report-v1';
  ticker: string;
  generatedAt: string;
  cutoff: string | null;
  status: 'complete' | 'partial';
  summary: string;
  validation: 'untested';
  strategies: FrameworkEvaluation[];
  evidence: FrameworkEvidence[];
  // Freeze normalized input bars to reproduce historical calculations without refetching.
  inputs: { stock: FrameworkHistory | null; benchmark: FrameworkHistory | null };
  limitations: string[];
  scenario: { origin: 'manual'; input: PositionScenario; result: PositionSize } | null;
}
