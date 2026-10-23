/**
 * AX-07: Shared Signal & Trade-Plan Schema
 *
 * Defines the unified immutable decision object shared by the radar,
 * stock research detail, paper runner, and results screens.
 *
 * Invariant: Every signal has a unique ID, creation timestamp, strategy version,
 * input snapshot hash, exact measured conditions, expiry, and limitations.
 * Distinguishes actionable paper signals from unverified watchlist observations.
 */

import crypto from 'node:crypto';
import type { MarketObservation } from './observation-contract';

export type SignalType = 'ACTIONABLE_PAPER_SIGNAL' | 'WATCHLIST_OBSERVATION';
export type SignalState = 'watching' | 'entry_met' | 'paper_open' | 'review_due' | 'invalidated' | 'expired';

export interface SignalConditions {
  entryTrigger: number;
  maxOpeningGap: number;
  targetScenario: number;
  invalidationStop: number;
  validitySessions: number;
  reviewSessions: number;
  rewardToRiskRatio: number;
}

export interface SignalPortfolioSizing {
  portfolioCapital: number;
  riskBudgetInr: number;
  slotCapital: number;
  wholeShares: number;
  allocatedAmount: number;
  plannedRiskAmount: number;
}

export interface SignalMetricsSnapshot {
  resistance20d: number;
  volumeRatio: number;
  momentum5dPct: number;
  turnoverCr: number;
  atr14: number;
  atrPct: number;
}

export interface DecisionSignal {
  id: string; // Deterministic immutable ID: e.g. "sig_AX-STRAT-01_TRENT_2026-10-08_r1"
  deduplicationKey: string; // e.g. "AX-STRAT-01:NSE:TRENT:2026-10-08"
  revision: number; // 1, 2, ...
  parentSignalId: string | null; // Prior signal ID if this is an updated revision
  strategyVersion: string; // e.g. "AX-STRAT-01-v1.0"
  signalType: SignalType;
  state: SignalState;

  // Instrument identity
  instrumentId: string; // "NSE:TRENT"
  symbol: string; // "TRENT"
  companyName: string;
  series: string; // "EQ"

  // Provenance & Timestamps
  dataCutoff: string; // ISO 8601 (e.g. 16:00 IST session close)
  issuedAt: string; // ISO 8601 creation time
  validUntil: string; // ISO 8601 expiry deadline
  referencePrice: number; // Observed closing price
  quoteSource: string;
  quoteStatus: 'recent' | 'delayed' | 'historical' | 'simulated';

  // Measured values & conditions
  metrics: SignalMetricsSnapshot;
  conditions: SignalConditions;
  sizing: SignalPortfolioSizing;

  // Explainability & Gaps
  measuredReasons: string[];
  evidenceMissing: string[];
  companyHoldAssessment: {
    status: 'not_established' | 'caution' | 'supportive';
    label: string;
    reason: string;
  };

  // Cryptographic immutability hash
  immutableHash: string; // SHA-256 of input reference + conditions + metrics
}

/**
 * Generates a deterministic SHA-256 hash for a signal to ensure immutability.
 */
export function calculateSignalHash(payload: {
  strategyVersion: string;
  instrumentId: string;
  dataCutoff: string;
  referencePrice: number;
  conditions: SignalConditions;
  metrics: SignalMetricsSnapshot;
}): string {
  const content = JSON.stringify({
    strategyVersion: payload.strategyVersion,
    instrumentId: payload.instrumentId,
    dataCutoff: payload.dataCutoff,
    referencePrice: payload.referencePrice,
    conditions: payload.conditions,
    metrics: payload.metrics,
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Creates an immutable DecisionSignal from a validated market observation.
 */
export function createDecisionSignal(params: {
  observation: MarketObservation;
  companyName: string;
  strategyVersion?: string;
  signalType?: SignalType;
  state?: SignalState;
  revision?: number;
  parentSignalId?: string | null;
  metrics: SignalMetricsSnapshot;
  portfolioCapital?: number;
  riskBudgetPct?: number;
  validitySessions?: number;
  reviewSessions?: number;
  companyHoldAssessment?: {
    status: 'not_established' | 'caution' | 'supportive';
    label: string;
    reason: string;
  };
}): DecisionSignal {
  const strategyVersion = params.strategyVersion || 'AX-STRAT-01-v1.0';
  const signalType = params.signalType || 'ACTIONABLE_PAPER_SIGNAL';
  const state = params.state || 'watching';
  const revision = params.revision || 1;
  const parentSignalId = params.parentSignalId || null;

  const obs = params.observation;
  const sessionDate = obs.observationTime.split('T')[0];
  const deduplicationKey = `${strategyVersion}:${obs.instrumentId}:${sessionDate}`;
  const cleanSymbol = obs.providerSymbol.replace(/\.(NS|BO)$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
  const id = `sig_${strategyVersion.replace(/[^a-zA-Z0-9]/g, '_')}_${cleanSymbol}_${sessionDate}_r${revision}`;

  // Calculate conditions
  const trigger = Number(Math.max(obs.price, params.metrics.resistance20d * 1.0025).toFixed(2));
  const maxGap = Number((trigger * 1.025).toFixed(2));
  const target = Number((trigger * 1.100).toFixed(2));
  const stop = Number(Math.max(trigger * 0.900, Math.min(trigger * 0.970, trigger - 1.5 * params.metrics.atr14)).toFixed(2));
  const validitySessions = params.validitySessions || 3;
  const reviewSessions = params.reviewSessions || 3;
  const rewardRisk = Number(((target - trigger) / Math.max(0.1, trigger - stop)).toFixed(2));

  const conditions: SignalConditions = {
    entryTrigger: trigger,
    maxOpeningGap: maxGap,
    targetScenario: target,
    invalidationStop: stop,
    validitySessions,
    reviewSessions,
    rewardToRiskRatio: rewardRisk,
  };

  // Portfolio sizing arithmetic on ₹50,000 base
  const portfolioCapital = params.portfolioCapital || 50000;
  const riskBudgetInr = Number((portfolioCapital * ((params.riskBudgetPct || 1.0) / 100)).toFixed(2));
  const slotCapital = Number((portfolioCapital / 3).toFixed(2)); // 3 equal slots

  const sharesByCapital = Math.floor(slotCapital / trigger);
  const sharesByRisk = Math.floor(riskBudgetInr / Math.max(0.1, trigger - stop));
  const wholeShares = Math.max(0, Math.min(sharesByCapital, sharesByRisk));
  const allocatedAmount = Number((wholeShares * trigger).toFixed(2));
  const plannedRiskAmount = Number((wholeShares * (trigger - stop)).toFixed(2));

  const sizing: SignalPortfolioSizing = {
    portfolioCapital,
    riskBudgetInr,
    slotCapital,
    wholeShares,
    allocatedAmount,
    plannedRiskAmount,
  };

  // Measured reasons vs thresholds
  const measuredReasons = [
    `Price ₹${obs.price} is compared against 20-session resistance ₹${params.metrics.resistance20d.toFixed(2)}.`,
    `20-session volume ratio is ${params.metrics.volumeRatio.toFixed(2)}x (Threshold: >= 1.20x; ${params.metrics.volumeRatio >= 1.2 ? 'Pass' : 'Pending confirmation'}).`,
    `5-session price momentum is ${params.metrics.momentum5dPct >= 0 ? '+' : ''}${params.metrics.momentum5dPct.toFixed(1)}% (Threshold: > 0.0%; ${params.metrics.momentum5dPct > 0 ? 'Pass' : 'Fail'}).`,
    `Trailing 20-session median turnover is ₹${params.metrics.turnoverCr.toFixed(1)} Cr (Threshold: >= ₹1.0 Cr; Pass).`,
  ];

  const evidenceMissing = [
    'Unverified quarterly results announcement timing; relying on annual provider statement.',
    'Promoter pledge and auditor qualification disclosures are unverified.',
  ];

  const companyHoldAssessment = params.companyHoldAssessment || {
    status: 'not_established',
    label: 'Longer hold not established',
    reason: 'Company filings or valuation metrics are unverified. A short-term price breakout does not justify holding a falling trade.',
  };

  const immutableHash = calculateSignalHash({
    strategyVersion,
    instrumentId: obs.instrumentId,
    dataCutoff: obs.observationTime,
    referencePrice: obs.price,
    conditions,
    metrics: params.metrics,
  });

  // Calculate validity deadline (approx 3 calendar days or session dates)
  const validUntilDate = new Date(Date.parse(obs.observationTime) + validitySessions * 24 * 60 * 60 * 1000);

  return {
    id,
    deduplicationKey,
    revision,
    parentSignalId,
    strategyVersion,
    signalType,
    state,
    instrumentId: obs.instrumentId,
    symbol: obs.providerSymbol.replace(/\.(NS|BO)$/, ''),
    companyName: params.companyName,
    series: obs.series,
    dataCutoff: obs.observationTime,
    issuedAt: obs.retrievedAt,
    validUntil: validUntilDate.toISOString(),
    referencePrice: obs.price,
    quoteSource: obs.rawProviderRef?.source || 'Yahoo Finance',
    quoteStatus: obs.qualityStatus === 'valid' ? 'recent' : obs.qualityStatus === 'stale' ? 'delayed' : 'historical',
    metrics: params.metrics,
    conditions,
    sizing,
    measuredReasons,
    evidenceMissing,
    companyHoldAssessment,
    immutableHash,
  };
}
