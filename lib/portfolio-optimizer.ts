import type { SetupInput } from './quality-gate';
import type { RankedSetup } from './ranking-engine';
import type { SectorExposure, ThemeExposure } from './risk-model';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranchePlan {
  initialPct: number;    // e.g. 0.6 (60%)
  followOnPct: number;   // e.g. 0.4 (40%)
}

export type AllocationFlag = 'target_exceeded' | 'stop_breached';
export type PortfolioBucket = 'CORE' | 'SATELLITE';

export interface AllocationItem {
  symbol: string;
  allocatedInr: number;
  allocationPct: number;
  bucket?: PortfolioBucket;
  tranchePlan?: TranchePlan;
  flags: AllocationFlag[];
}

export interface AllocationPlan {
  items: AllocationItem[];
  totalAllocatedPct: number;
  cashReservePct: number;
  coreAllocatedPct?: number;      // Asset Yogi Core bucket (Target: ~65-75%)
  satelliteAllocatedPct?: number; // Asset Yogi Satellite bucket (Target: ~25-35%)
}

export interface CurrentPositionInput {
  symbol: string;
  currentReturnPct: number;
  stopPrice: number;
  currentPrice: number;
  targetReturnPct?: number;
}

export interface OptimizerInput {
  rankedSetups: Array<RankedSetup & { setup: SetupInput; sector: string; theme: string }>;
  portfolioValue: number;
  riskBudgetPct: number;           // e.g. 0.80 (use at most 80% of portfolio)
  currentPositions?: CurrentPositionInput[];
  sectorExposures: SectorExposure[];
  themeExposures: ThemeExposure[];
  enableStagedEntries?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_SINGLE_STOCK_PCT = 0.05;  // 5% max per symbol
export const SECTOR_CAP_PCT = 0.25;        // 25% max per sector
export const THEME_CAP_PCT = 0.20;         // 20% max per theme
export const MIN_CASH_FLOOR_PCT = 0.10;    // 10% minimum cash reserve
export const MAX_TOTAL_ALLOC_PCT = 1 - MIN_CASH_FLOOR_PCT; // 0.90 max total allocation

// ─── optimizePortfolio ────────────────────────────────────────────────────────

/**
 * Optimizes portfolio allocation across ranked setups subject to:
 * - Risk budget cap (totalAllocatedPct <= riskBudgetPct)
 * - 10% minimum cash floor (totalAllocatedPct <= 0.90)
 * - Single-stock 5% cap
 * - Sector <= 25% and Theme <= 20% concentration limits
 * - Staged entry plans (60/40) when enabled
 * - Position rebalancing flags ('target_exceeded', 'stop_breached')
 * 
 * Never throws; returns safe zero-allocation plan on invalid input.
 */
export function optimizePortfolio(input: OptimizerInput): AllocationPlan {
  try {
    const {
      rankedSetups = [],
      portfolioValue = 0,
      riskBudgetPct = 0,
      currentPositions = [],
      sectorExposures = [],
      themeExposures = [],
      enableStagedEntries = false,
    } = input || {};

    // 1. If risk budget is 0 or portfolio value is non-positive, return zero allocation with 100% cash
    if (!riskBudgetPct || riskBudgetPct <= 0 || portfolioValue <= 0 || !Array.isArray(rankedSetups)) {
      const zeroItems: AllocationItem[] = Array.isArray(rankedSetups)
        ? rankedSetups.map(s => {
            const flags = computeFlagsForSymbol(s.setup?.symbol ?? s.setupId, s, currentPositions);
            return {
              symbol: s.setup?.symbol ?? s.setupId,
              allocatedInr: 0,
              allocationPct: 0,
              tranchePlan: undefined,
              flags,
            };
          })
        : [];

      return {
        items: zeroItems,
        totalAllocatedPct: 0,
        cashReservePct: 1,
      };
    }

    // Effective risk budget capped by cash floor (max total allocation = 90%)
    const effectiveRiskBudget = Math.min(riskBudgetPct, MAX_TOTAL_ALLOC_PCT);

    // Sort setups by score descending / rank ascending (respecting rank order)
    const sortedSetups = [...rankedSetups].sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) {
        return a.rank - b.rank;
      }
      return (b.setupScore ?? 0) - (a.setupScore ?? 0);
    });

    // Tracking allocations
    const sectorAllocations = new Map<string, number>();
    const themeAllocations = new Map<string, number>();
    let totalAllocatedPct = 0;
    const items: AllocationItem[] = [];

    for (const setupItem of sortedSetups) {
      const symbol = setupItem.setup?.symbol ?? setupItem.setupId;
      const sector = setupItem.sector;
      const theme = setupItem.theme;

      // Check position flags for this symbol
      const flags = computeFlagsForSymbol(symbol, setupItem, currentPositions);

      // If setup is marked rejected, do not allocate
      if (setupItem.rejected) {
        items.push({
          symbol,
          allocatedInr: 0,
          allocationPct: 0,
          tranchePlan: undefined,
          flags,
        });
        continue;
      }

      // Compute remaining room across all constraints
      const remainingBudget = Math.max(0, effectiveRiskBudget - totalAllocatedPct);
      const remainingCashFloor = Math.max(0, MAX_TOTAL_ALLOC_PCT - totalAllocatedPct);

      const currentSectorExposure = sectorExposures.find(s => s.sector === sector)?.currentAllocationPct ?? 0;
      const planSectorAlloc = sectorAllocations.get(sector) ?? 0;
      const remainingSector = Math.max(0, SECTOR_CAP_PCT - currentSectorExposure - planSectorAlloc);

      const currentThemeExposure = themeExposures.find(t => t.theme === theme)?.currentAllocationPct ?? 0;
      const planThemeAlloc = themeAllocations.get(theme) ?? 0;
      const remainingTheme = Math.max(0, THEME_CAP_PCT - currentThemeExposure - planThemeAlloc);

      let allocPct = Math.min(
        MAX_SINGLE_STOCK_PCT,
        remainingBudget,
        remainingCashFloor,
        remainingSector,
        remainingTheme
      );

      // Handle floating-point precision near zero
      if (allocPct < 1e-7) {
        allocPct = 0;
      }

      totalAllocatedPct += allocPct;
      if (sector) {
        sectorAllocations.set(sector, planSectorAlloc + allocPct);
      }
      if (theme) {
        themeAllocations.set(theme, planThemeAlloc + allocPct);
      }

      const allocatedInr = allocPct * portfolioValue;
      const tranchePlan: TranchePlan | undefined =
        enableStagedEntries && allocPct > 0
          ? { initialPct: 0.6, followOnPct: 0.4 }
          : undefined;

      const bucket: PortfolioBucket = (setupItem.setupScore >= 70 && (setupItem.setup?.convictionScore ?? 0) >= 70)
        ? 'CORE'
        : 'SATELLITE';

      items.push({
        symbol,
        allocatedInr,
        allocationPct: allocPct,
        bucket,
        tranchePlan,
        flags,
      });
    }

    const cashReservePct = Math.max(MIN_CASH_FLOOR_PCT, 1 - totalAllocatedPct);
    const coreAllocatedPct = Number(items.filter(i => i.bucket === 'CORE').reduce((sum, i) => sum + i.allocationPct, 0).toFixed(4));
    const satelliteAllocatedPct = Number(items.filter(i => i.bucket === 'SATELLITE').reduce((sum, i) => sum + i.allocationPct, 0).toFixed(4));

    return {
      items,
      totalAllocatedPct,
      cashReservePct,
      coreAllocatedPct,
      satelliteAllocatedPct,
    };
  } catch {
    return {
      items: [],
      totalAllocatedPct: 0,
      cashReservePct: 1,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeFlagsForSymbol(
  symbol: string,
  setupItem: any,
  currentPositions: CurrentPositionInput[]
): AllocationFlag[] {
  const flags: AllocationFlag[] = [];
  if (!currentPositions || !Array.isArray(currentPositions)) {
    return flags;
  }

  const pos = currentPositions.find(p => p.symbol === symbol);
  if (!pos) {
    return flags;
  }

  // 1. target_exceeded: currentReturnPct >= targetReturnPct + 0.10
  let targetReturnPct = pos.targetReturnPct;
  if (targetReturnPct === undefined) {
    const entryPrice = setupItem?.setup?.entryPrice;
    const targetPrice = setupItem?.setup?.targetPrice;
    if (entryPrice && targetPrice && entryPrice > 0) {
      targetReturnPct = (targetPrice - entryPrice) / entryPrice;
    }
  }

  if (
    typeof pos.currentReturnPct === 'number' &&
    typeof targetReturnPct === 'number' &&
    !isNaN(pos.currentReturnPct) &&
    !isNaN(targetReturnPct)
  ) {
    if (pos.currentReturnPct >= targetReturnPct + 0.10) {
      flags.push('target_exceeded');
    }
  }

  // 2. stop_breached: currentPrice <= stopPrice * 0.95
  const stopPrice = pos.stopPrice ?? setupItem?.setup?.stopPrice;
  if (
    typeof pos.currentPrice === 'number' &&
    typeof stopPrice === 'number' &&
    !isNaN(pos.currentPrice) &&
    !isNaN(stopPrice)
  ) {
    if (pos.currentPrice <= stopPrice * 0.95) {
      flags.push('stop_breached');
    }
  }

  return flags;
}
