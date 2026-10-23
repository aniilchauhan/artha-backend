import type { SetupInput } from './quality-gate';
import { sizePosition, type PositionScenario, type PositionSize } from './position-sizing';

export type ConvictionTier = 'low' | 'standard' | 'high';

export interface SectorExposure {
  sector: string;
  currentAllocationPct: number;  // e.g. 0.15 = 15% of portfolio
}

export interface ThemeExposure {
  theme: string;
  currentAllocationPct: number;  // e.g. 0.10 = 10% of portfolio
}

export interface PositionSizingInput {
  sizingPolicy?: 'legacy-allocation' | 'risk-budget-v1';
  riskScenario?: Omit<PositionScenario, 'portfolioEquity' | 'entry' | 'stop' | 'sectorRoom' | 'themeRoom'>;
  setup: SetupInput;
  portfolioValue: number;          // Total value in INR
  sectorExposures: SectorExposure[];
  themeExposures: ThemeExposure[];
  sector: string;
  theme: string;
}

export interface PositionSizingResult {
  riskSizing?: PositionSize;
  symbol: string;
  recommendedAllocationInr: number;
  allocationPct: number;
  convictionTier: ConvictionTier;
  constraintReasons: string[];
}

/**
 * Computes a position size for a setup that has passed the Quality Gate.
 * Never throws — blocking constraints return zero allocation with a reason.
 */
export function computePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { setup, portfolioValue, sectorExposures, themeExposures, sector, theme } = input;

  const zero = (tier: ConvictionTier, reason: string): PositionSizingResult => ({
    symbol: setup.symbol,
    recommendedAllocationInr: 0,
    allocationPct: 0,
    convictionTier: tier,
    constraintReasons: [reason],
  });

  try {
    if (input.sizingPolicy === 'risk-budget-v1') {
      if (setup.direction !== 'LONG' || !input.riskScenario) return zero('standard', 'unsupported_or_missing_risk_scenario');
      if (!Array.isArray(sectorExposures) || !Array.isArray(themeExposures) ||
          [...sectorExposures, ...themeExposures].some(e => !Number.isFinite(e.currentAllocationPct) || e.currentAllocationPct < 0 || e.currentAllocationPct > 1)) {
        return zero('standard', 'invalid_exposures');
      }
      const sectorUsed = sectorExposures.filter(e => e.sector === sector).reduce((n, e) => n + e.currentAllocationPct, 0);
      const themeUsed = themeExposures.filter(e => e.theme === theme).reduce((n, e) => n + e.currentAllocationPct, 0);
      const riskSizing = sizePosition({ ...input.riskScenario, portfolioEquity: portfolioValue,
        entry: setup.entryPrice, stop: setup.stopPrice,
        maxAllocationFraction: Math.min(0.05, input.riskScenario.maxAllocationFraction),
        sectorRoom: Math.max(0, 0.25 - sectorUsed) * portfolioValue,
        themeRoom: Math.max(0, 0.20 - themeUsed) * portfolioValue });
      return { symbol: setup.symbol, recommendedAllocationInr: riskSizing.investment, allocationPct: riskSizing.allocationFraction,
        convictionTier: 'standard', constraintReasons: riskSizing.constraints, riskSizing };
    }
    // 1. Missing stop price
    if (setup.stopPrice == null || isNaN(setup.stopPrice)) {
      return zero('standard', 'missing_stop');
    }

    // 2. Stop distance validation: must be 1%–15% of entry price
    const stopDistance = Math.abs(setup.entryPrice - setup.stopPrice) / setup.entryPrice;
    if (stopDistance < 0.01 || stopDistance > 0.15) {
      return zero('standard', 'invalid_stop_distance');
    }

    // 3. Determine conviction tier
    const riskRewardRatio =
      (setup.targetPrice - setup.entryPrice) / (setup.entryPrice - setup.stopPrice);

    let tier: ConvictionTier;
    if (setup.convictionScore >= 90 && riskRewardRatio >= 3.0) {
      tier = 'high';
    } else if (setup.convictionScore < 75) {
      tier = 'low';
    } else {
      tier = 'standard';
    }

    // 4. Base allocation: cap at 5% of portfolioValue
    const MAX_PCT = 0.05;
    let allocationPct = MAX_PCT;

    // Apply 30% reduction for low conviction
    if (tier === 'low') {
      allocationPct *= 0.7;
    }

    const constraintReasons: string[] = [];

    // 5. Sector concentration cap: ≤ 25% of portfolioValue
    const SECTOR_CAP = 0.25;
    const sectorEntry = sectorExposures.find(s => s.sector === sector);
    const currentSectorPct = sectorEntry ? sectorEntry.currentAllocationPct : 0;
    const remainingSectorRoom = Math.max(0, SECTOR_CAP - currentSectorPct);
    if (allocationPct > remainingSectorRoom) {
      allocationPct = remainingSectorRoom;
      constraintReasons.push('sector_concentration_cap');
    }

    // 6. Theme concentration cap: ≤ 20% of portfolioValue
    const THEME_CAP = 0.20;
    const themeEntry = themeExposures.find(t => t.theme === theme);
    const currentThemePct = themeEntry ? themeEntry.currentAllocationPct : 0;
    const remainingThemeRoom = Math.max(0, THEME_CAP - currentThemePct);
    if (allocationPct > remainingThemeRoom) {
      allocationPct = remainingThemeRoom;
      constraintReasons.push('theme_concentration_cap');
    }

    // Clamp to [0, MAX_PCT]
    allocationPct = Math.min(MAX_PCT, Math.max(0, allocationPct));

    const recommendedAllocationInr = allocationPct * portfolioValue;

    return {
      symbol: setup.symbol,
      recommendedAllocationInr,
      allocationPct,
      convictionTier: tier,
      constraintReasons,
    };
  } catch {
    return zero('standard', input.sizingPolicy === 'risk-budget-v1' ? 'invalid_risk_scenario' : 'missing_stop');
  }
}
