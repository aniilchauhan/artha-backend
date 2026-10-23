import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  PredictionCohort,
  ProspectiveObservation,
  ReconciledObservation,
  SessionOutcome,
  CohortEvaluationReport,
  CandleQuoteInput,
} from './paper-prediction-types';

export type { CandleQuoteInput };

import {
  ROUNDTRIP_FEE_BPS,
  SLIPPAGE_BPS,
  TOTAL_COST_PERCENT,
  STRESSED_COST_PERCENT,
  type ExecutionAssumptions,
  EXECUTION_ASSUMPTIONS,
} from './paper-prediction-types';

export {
  ROUNDTRIP_FEE_BPS,
  SLIPPAGE_BPS,
  TOTAL_COST_PERCENT,
  STRESSED_COST_PERCENT,
  type ExecutionAssumptions,
  EXECUTION_ASSUMPTIONS,
};

export function getPaperStorageDir(): string {
  const dir =
    process.env.AXION_PAPER_PREDICTIONS_DIR ||
    path.join(getAxionProjectRoot(), '.axion', 'paper_predictions');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function hashEvidenceBundle(evidence: unknown): string {
  if (!evidence || (Array.isArray(evidence) && evidence.length === 0)) {
    return '';
  }
  const serialized = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Reconciles prospective prediction against executed session candle.
 * Invariant: stop-first if both target and stop are touched on daily candle.
 */
export function reconcileObservationOutcome(
  observation: ProspectiveObservation,
  candle: CandleQuoteInput,
  reconciledAt: string = new Date().toISOString()
): ReconciledObservation {
  const openFill = candle.open > 0 ? candle.open : observation.referenceClose;
  const target = observation.indicativeTargetPrice;
  const stop = observation.indicativeStopLossPrice;

  const targetTouched = candle.high >= target;
  const stopTouched = candle.low <= stop;

  let outcome: SessionOutcome;
  let exitPrice: number;
  let isWin: boolean;

  if (targetTouched && stopTouched) {
    // Conservative rule: Stop-first if both touched intraday
    outcome = 'BOTH_TOUCHED_STOP_FIRST';
    exitPrice = stop;
    isWin = false;
  } else if (stopTouched) {
    outcome = 'STOP_HIT';
    exitPrice = stop;
    isWin = false;
  } else if (targetTouched) {
    outcome = 'TARGET_HIT';
    exitPrice = target;
    isWin = true;
  } else {
    // Neither touched: closed at session EOD
    outcome = 'NEITHER_CLOSED_AT_EOD';
    exitPrice = candle.close;
    isWin = exitPrice > openFill;
  }

  const grossReturnPercent = Math.round(((exitPrice - openFill) / openFill) * 10000) / 100;
  const netReturnPercent = Math.round((grossReturnPercent - TOTAL_COST_PERCENT) * 100) / 100;
  const stressedNetReturnPercent =
    Math.round((grossReturnPercent - STRESSED_COST_PERCENT) * 100) / 100;

  return {
    ...observation,
    openFillPrice: openFill,
    highPrice: candle.high,
    lowPrice: candle.low,
    closePrice: candle.close,
    outcome,
    exitPrice,
    grossReturnPercent,
    netReturnPercent,
    stressedNetReturnPercent,
    isWin,
    reconciledAt,
  };
}

export function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Windows fallback if rename destination exists
    fs.copyFileSync(tmpPath, filePath);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
  }
}

export function acquirePaperLock(jobName = 'paper_reconcile'): boolean {
  const dir = getPaperStorageDir();
  const lockFile = path.join(dir, `${jobName}.lock`);
  try {
    if (fs.existsSync(lockFile)) {
      const stats = fs.statSync(lockFile);
      // Expire stale locks older than 60 seconds
      if (Date.now() - stats.mtimeMs < 60000) {
        return false;
      }
    }
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, lockedAt: new Date().toISOString() }),
      { flag: 'w', encoding: 'utf-8' }
    );
    return true;
  } catch {
    return false;
  }
}

export function releasePaperLock(jobName = 'paper_reconcile'): void {
  const dir = getPaperStorageDir();
  const lockFile = path.join(dir, `${jobName}.lock`);
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // Ignore unlock errors
  }
}

export function saveObservations(
  sessionDate: string,
  observations: ProspectiveObservation[]
): string {
  const dir = getPaperStorageDir();
  const filePath = path.join(dir, `observations-${sessionDate}.json`);
  const existing = loadObservations(sessionDate);
  const byId = new Map<string, ProspectiveObservation>();
  for (const obs of existing) byId.set(obs.id, obs);
  for (const obs of observations) byId.set(obs.id, obs);
  const merged = Array.from(byId.values());
  atomicWriteJson(filePath, merged);
  return filePath;
}

export function loadObservations(sessionDate: string): ProspectiveObservation[] {
  const dir = getPaperStorageDir();
  const filePath = path.join(dir, `observations-${sessionDate}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function loadReconciledObservationsForDate(sessionDate: string): ReconciledObservation[] {
  const dir = getPaperStorageDir();
  const filePath = path.join(dir, `reconciled-${sessionDate}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReconciledObservations(
  sessionDate: string,
  reconciled: ReconciledObservation[]
): string {
  const dir = getPaperStorageDir();
  const filePath = path.join(dir, `reconciled-${sessionDate}.json`);
  const existing = loadReconciledObservationsForDate(sessionDate);
  const byId = new Map<string, ReconciledObservation>();
  for (const rec of existing) byId.set(rec.id, rec);
  for (const rec of reconciled) byId.set(rec.id, rec);
  const merged = Array.from(byId.values());
  atomicWriteJson(filePath, merged);
  return filePath;
}

export function loadAllReconciledObservations(): ReconciledObservation[] {
  const dir = getPaperStorageDir();
  const files = fs.readdirSync(dir).filter(f => f.startsWith('reconciled-') && f.endsWith('.json'));
  const all: ReconciledObservation[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        all.push(...items);
      }
    } catch {
      // Skip corrupt files
    }
  }
  return all;
}

/**
 * Computes cohort performance metrics and gating validation against CLEAN_PREDICTION_EXECUTION_PLAN criteria
 */
export function evaluateCohortPerformance(
  cohort: PredictionCohort,
  records: ReconciledObservation[]
): CohortEvaluationReport {
  const cohortRecords = records.filter(r => r.cohort === cohort);
  const totalPredictions = cohortRecords.length;

  if (totalPredictions === 0) {
    return {
      cohort,
      totalPredictions: 0,
      completedSessions: 0,
      closedTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRatePercent: 0,
      meanGrossReturnPercent: 0,
      meanNetReturnPercent: 0,
      meanStressedNetReturnPercent: 0,
      brierScore: 0,
      maxDrawdownPercent: 0,
      gatingChecklist: {
        minimumSessionsMet: false,
        minimumTradesMet: false,
        positiveNetReturn: false,
        positiveStressedReturn: false,
        drawdownUnderLimit: false,
      },
      eligibleForPromotion: false,
    };
  }

  const distinctSessions = new Set(cohortRecords.map(r => r.sessionDate)).size;
  const winCount = cohortRecords.filter(r => r.isWin).length;
  const lossCount = totalPredictions - winCount;
  const winRatePercent = Math.round((winCount / totalPredictions) * 10000) / 100;

  const totalGross = cohortRecords.reduce((sum, r) => sum + r.grossReturnPercent, 0);
  const totalNet = cohortRecords.reduce((sum, r) => sum + r.netReturnPercent, 0);
  const totalStressed = cohortRecords.reduce((sum, r) => sum + r.stressedNetReturnPercent, 0);

  const meanGross = Math.round((totalGross / totalPredictions) * 100) / 100;
  const meanNet = Math.round((totalNet / totalPredictions) * 100) / 100;
  const meanStressed = Math.round((totalStressed / totalPredictions) * 100) / 100;

  // Brier score: mean of (calibratedProb - outcomeActual)^2
  const brierSum = cohortRecords.reduce((sum, r) => {
    const actual = r.isWin ? 1.0 : 0.0;
    const diff = r.calibratedProbability - actual;
    return sum + diff * diff;
  }, 0);
  const brierScore = Math.round((brierSum / totalPredictions) * 10000) / 10000;

  // Maximum Drawdown computation across cumulative net return series
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of cohortRecords) {
    cumulative += r.netReturnPercent;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const dd = peak - cumulative;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }
  }
  const maxDrawdownPercent = Math.round(maxDrawdown * 100) / 100;

  // Promotion Gating Checklist (Phase 6 of Clean Prediction Execution Plan)
  const minimumSessionsMet = distinctSessions >= 60;
  const minimumTradesMet = totalPredictions >= 100;
  const positiveNetReturn = meanNet > 0;
  const positiveStressedReturn = meanStressed > 0;
  const drawdownUnderLimit = maxDrawdownPercent <= 8.0;

  const eligibleForPromotion =
    minimumSessionsMet &&
    minimumTradesMet &&
    positiveNetReturn &&
    positiveStressedReturn &&
    drawdownUnderLimit;

  return {
    cohort,
    totalPredictions,
    completedSessions: distinctSessions,
    closedTrades: totalPredictions,
    winCount,
    lossCount,
    winRatePercent,
    meanGrossReturnPercent: meanGross,
    meanNetReturnPercent: meanNet,
    meanStressedNetReturnPercent: meanStressed,
    brierScore,
    maxDrawdownPercent,
    gatingChecklist: {
      minimumSessionsMet,
      minimumTradesMet,
      positiveNetReturn,
      positiveStressedReturn,
      drawdownUnderLimit,
    },
    eligibleForPromotion,
  };
}
