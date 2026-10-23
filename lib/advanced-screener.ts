/**
 * Axion Advanced Multi-Factor Screener and Portfolio Automation Engine
 * 
 * Satisfies Year 2 Backlog Epic 6:
 * "Advanced screener and portfolio automation — filters, strategy presets, position sizing,
 * and plain-language explanation views. Advanced workflows are measurable and explainable."
 */

import { sizePosition, type PositionScenario, type PositionSize } from './position-sizing';

export type ScreenerStrategyPreset =
  | 'MOMENTUM_BREAKOUT'
  | 'CAN_SLIM_GROWTH'
  | 'VALUE_REVERSION'
  | 'DEFENSIVE_QUALITY';

export interface ScreenerCriteria {
  minScore?: number;             // Model probability (0 to 100)
  minRvol?: number;              // Relative volume ratio (e.g. >= 1.5)
  minRsi?: number;               // RSI-14 floor
  maxRsi?: number;               // RSI-14 ceiling
  sectors?: string[];            // Whitelisted sectors
  marketCapCategory?: 'ALL' | 'LARGE' | 'MID' | 'SMALL';
  min1dChangePct?: number;       // Minimum 1-day price change (%)
  maxDebtToEquity?: number;
  preset?: ScreenerStrategyPreset;
}

export interface StockCandidate {
  ticker: string;
  name: string;
  price: number;
  marketCapCategory: 'LARGE' | 'MID' | 'SMALL';
  sector: string;
  modelScore: number;            // 0 to 100
  rvol: number;                  // 20-day relative volume ratio
  rsi14: number;
  oneDayChangePct: number;
  debtToEquity?: number;
  supportLevel?: number;
  resistanceLevel?: number;
}

export interface ScreenerResultItem {
  ticker: string;
  name: string;
  price: number;
  sector: string;
  matchScore: number;            // Composite matching quality (0 to 100)
  explanations: string[];        // Plain-language reasons why it matched
  suggestedPosition?: PositionSize;
}

export const STRATEGY_PRESETS: Record<ScreenerStrategyPreset, ScreenerCriteria> = {
  MOMENTUM_BREAKOUT: {
    minScore: 65,
    minRvol: 1.5,
    minRsi: 55,
    maxRsi: 80,
    min1dChangePct: 1.5,
  },
  CAN_SLIM_GROWTH: {
    minScore: 70,
    minRvol: 1.8,
    minRsi: 52,
    maxRsi: 75,
    min1dChangePct: 0.5,
    maxDebtToEquity: 1.0,
  },
  VALUE_REVERSION: {
    minScore: 60,
    minRsi: 25,
    maxRsi: 45,
    maxDebtToEquity: 0.8,
  },
  DEFENSIVE_QUALITY: {
    minScore: 65,
    minRsi: 40,
    maxRsi: 65,
    maxDebtToEquity: 0.5,
    marketCapCategory: 'LARGE',
  },
};

/**
 * Evaluates a single stock against given screener criteria and generates
 * evidence-backed explanation bullet points.
 */
export function evaluateCandidate(
  candidate: StockCandidate,
  criteria: ScreenerCriteria
): { passed: boolean; matchScore: number; explanations: string[] } {
  const explanations: string[] = [];
  let scoreSum = 0;
  let checksCount = 0;

  // 1. Model score filter
  if (criteria.minScore !== undefined) {
    checksCount++;
    if (candidate.modelScore < criteria.minScore) return { passed: false, matchScore: 0, explanations: [] };
    explanations.push(`Calibrated model score ${(candidate.modelScore).toFixed(1)}% satisfies minimum threshold of ${criteria.minScore}%.`);
    scoreSum += Math.min(100, (candidate.modelScore / criteria.minScore) * 80);
  }

  // 2. Relative volume (RVOL)
  if (criteria.minRvol !== undefined) {
    checksCount++;
    if (candidate.rvol < criteria.minRvol) return { passed: false, matchScore: 0, explanations: [] };
    explanations.push(`Institutional volume expansion: RVOL is ${candidate.rvol.toFixed(1)}x (above ${criteria.minRvol}x minimum).`);
    scoreSum += Math.min(100, (candidate.rvol / criteria.minRvol) * 80);
  }

  // 3. RSI bounds
  if (criteria.minRsi !== undefined) {
    checksCount++;
    if (candidate.rsi14 < criteria.minRsi) return { passed: false, matchScore: 0, explanations: [] };
    scoreSum += 85;
  }
  if (criteria.maxRsi !== undefined) {
    checksCount++;
    if (candidate.rsi14 > criteria.maxRsi) return { passed: false, matchScore: 0, explanations: [] };
    scoreSum += 85;
  }
  if (criteria.minRsi !== undefined || criteria.maxRsi !== undefined) {
    explanations.push(`RSI(14) at ${candidate.rsi14.toFixed(1)} is within target momentum corridor [${criteria.minRsi ?? 0}–${criteria.maxRsi ?? 100}].`);
  }

  // 4. Market Cap category
  if (criteria.marketCapCategory && criteria.marketCapCategory !== 'ALL') {
    if (candidate.marketCapCategory !== criteria.marketCapCategory) {
      return { passed: false, matchScore: 0, explanations: [] };
    }
    explanations.push(`Belongs to requested ${candidate.marketCapCategory}-cap equity universe.`);
  }

  // 5. Sector whitelist
  if (criteria.sectors && criteria.sectors.length > 0) {
    if (!criteria.sectors.includes(candidate.sector)) {
      return { passed: false, matchScore: 0, explanations: [] };
    }
    explanations.push(`Sector '${candidate.sector}' is on active focus list.`);
  }

  // 6. Debt to Equity ceiling
  if (criteria.maxDebtToEquity !== undefined) {
    checksCount++;
    if (candidate.debtToEquity !== undefined && candidate.debtToEquity > criteria.maxDebtToEquity) {
      return { passed: false, matchScore: 0, explanations: [] };
    }
    if (candidate.debtToEquity !== undefined) {
      explanations.push(`Healthy balance sheet: D/E ratio of ${candidate.debtToEquity.toFixed(2)} is well below conservative ceiling of ${criteria.maxDebtToEquity}.`);
      scoreSum += 90;
    }
  }

  const matchScore = checksCount > 0 ? Math.min(100, Math.round(scoreSum / checksCount)) : 75;

  return {
    passed: true,
    matchScore,
    explanations,
  };
}

/**
 * Runs the screener engine over a candidate universe with automated position sizing.
 */
export function runAdvancedScreener(
  candidates: StockCandidate[],
  criteria: ScreenerCriteria,
  portfolioContext?: { portfolioEquity: number; availableCash: number; riskFraction?: number }
): ScreenerResultItem[] {
  // Apply preset if specified
  const effectiveCriteria: ScreenerCriteria = criteria.preset
    ? { ...STRATEGY_PRESETS[criteria.preset], ...criteria }
    : criteria;

  const results: ScreenerResultItem[] = [];

  for (const candidate of candidates) {
    const evalResult = evaluateCandidate(candidate, effectiveCriteria);
    if (!evalResult.passed) continue;

    let suggestedPosition: PositionSize | undefined;

    if (portfolioContext && candidate.price > 0) {
      try {
        const stopPrice = candidate.supportLevel && candidate.supportLevel < candidate.price
          ? candidate.supportLevel
          : candidate.price * 0.96; // 4% default protective stop

        const scenario: PositionScenario = {
          portfolioEquity: portfolioContext.portfolioEquity,
          availableCash: portfolioContext.availableCash,
          entry: candidate.price,
          stop: stopPrice,
          riskFraction: portfolioContext.riskFraction ?? 0.015, // 1.5% portfolio risk
          maxAllocationFraction: 0.15, // Max 15% per position
          entryCostFraction: 0.001,
          exitCostFraction: 0.001,
          stopSlippageFraction: 0.005,
        };

        suggestedPosition = sizePosition(scenario);
      } catch {
        // Graceful fallback if sizing inputs fail sanity checks
      }
    }

    results.push({
      ticker: candidate.ticker,
      name: candidate.name,
      price: candidate.price,
      sector: candidate.sector,
      matchScore: evalResult.matchScore,
      explanations: evalResult.explanations,
      suggestedPosition,
    });
  }

  // Sort descending by match score
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}
