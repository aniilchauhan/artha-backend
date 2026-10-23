/**
 * Axion Corporate Action and Split-Aware Outcome Reconciler
 * 
 * Satisfies Year 2 Backlog Phase 2:
 * "Verify split-based outcome tracking — protects paper portfolio and prediction ledger
 * from false stop-loss liquidations caused by corporate stock splits or bonus share issues."
 */

import type {
  CandleQuoteInput,
  ProspectiveObservation,
  ReconciledObservation,
  SessionOutcome,
} from './paper-prediction-types';

import {
  TOTAL_COST_PERCENT,
  STRESSED_COST_PERCENT,
} from './paper-prediction-types';

export interface SplitDetectionResult {
  hasSplit: boolean;
  splitRatio: number;
  reason: string;
}

/**
 * Standard Indian market stock split ratios:
 * 2:1 (halves price), 5:1 (fifths price), 10:1 (tenths price), 3:1, 4:1.
 */
const COMMON_SPLIT_RATIOS = [2, 3, 4, 5, 10];

/**
 * Detects whether a price drop between previous reference close and session open
 * is consistent with a corporate stock split rather than market movement.
 */
export function detectSplitRatio(
  referenceClose: number,
  sessionOpen: number
): SplitDetectionResult {
  if (referenceClose <= 0 || sessionOpen <= 0) {
    return { hasSplit: false, splitRatio: 1.0, reason: 'Invalid prices' };
  }

  const rawDropFactor = referenceClose / sessionOpen;

  // Normal market trading moves are bounded by 20% circuit filters on NSE/BSE.
  // A drop factor >= 1.7 almost certainly indicates a split or demerger.
  if (rawDropFactor < 1.7) {
    return { hasSplit: false, splitRatio: 1.0, reason: 'Normal price fluctuation within circuit bounds' };
  }

  // Find the closest standard corporate action ratio
  for (const ratio of COMMON_SPLIT_RATIOS) {
    const impliedPrice = referenceClose / ratio;
    const deviationFromImplied = Math.abs(sessionOpen - impliedPrice) / impliedPrice;

    // If within 15% of the split-adjusted price, confirm split ratio
    if (deviationFromImplied <= 0.15) {
      return {
        hasSplit: true,
        splitRatio: ratio,
        reason: `Detected ${ratio}:1 corporate stock split / bonus adjustment (pre-split ₹${referenceClose.toFixed(2)} -> adjusted ₹${impliedPrice.toFixed(2)})`,
      };
    }
  }

  // Arbitrary split ratio fallback (rounded)
  const roundedRatio = Math.round(rawDropFactor);
  if (roundedRatio >= 2) {
    return {
      hasSplit: true,
      splitRatio: roundedRatio,
      reason: `Detected ${roundedRatio}:1 corporate action adjustment`,
    };
  }

  return { hasSplit: false, splitRatio: 1.0, reason: 'Price movement unconfirmed as split' };
}

/**
 * Adjusts prospective observation target and stop thresholds by the split ratio.
 */
export function adjustObservationForSplit(
  observation: ProspectiveObservation,
  splitRatio: number
): ProspectiveObservation {
  if (splitRatio <= 1.0) return observation;

  return {
    ...observation,
    referenceClose: parseFloat((observation.referenceClose / splitRatio).toFixed(2)),
    indicativeTargetPrice: parseFloat((observation.indicativeTargetPrice / splitRatio).toFixed(2)),
    indicativeStopLossPrice: parseFloat((observation.indicativeStopLossPrice / splitRatio).toFixed(2)),
  };
}

/**
 * Reconciles prospective prediction against executed session candle with automatic
 * or explicit corporate stock split adjustment.
 */
export function reconcileObservationWithSplitAwareness(
  observation: ProspectiveObservation,
  candle: CandleQuoteInput,
  explicitSplitRatio?: number,
  reconciledAt: string = new Date().toISOString()
): ReconciledObservation & { splitRatioApplied: number } {
  // Determine split ratio: explicit override > auto-detection
  let splitRatio = explicitSplitRatio || 1.0;
  if (!explicitSplitRatio && candle.open > 0) {
    const detection = detectSplitRatio(observation.referenceClose, candle.open);
    if (detection.hasSplit) {
      splitRatio = detection.splitRatio;
    }
  }

  const adjustedObs = adjustObservationForSplit(observation, splitRatio);

  const openFill = candle.open > 0 ? candle.open : adjustedObs.referenceClose;
  const target = adjustedObs.indicativeTargetPrice;
  const stop = adjustedObs.indicativeStopLossPrice;

  const targetTouched = candle.high >= target;
  const stopTouched = candle.low <= stop;

  let outcome: SessionOutcome;
  let exitPrice: number;
  let isWin: boolean;

  if (targetTouched && stopTouched) {
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
    outcome = 'NEITHER_CLOSED_AT_EOD';
    exitPrice = candle.close;
    isWin = exitPrice > openFill;
  }

  const grossReturnPercent = Math.round(((exitPrice - openFill) / openFill) * 10000) / 100;
  const netReturnPercent = Math.round((grossReturnPercent - TOTAL_COST_PERCENT) * 100) / 100;
  const stressedNetReturnPercent = Math.round((grossReturnPercent - STRESSED_COST_PERCENT) * 100) / 100;

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
    splitRatioApplied: splitRatio,
  };
}
