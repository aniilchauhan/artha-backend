// ─── Types ────────────────────────────────────────────────────────────────────

export type ExitReason = 'target_hit' | 'stop_hit' | 'manual_exit' | 'expired';

export interface TradeRecord {
  id: string;
  symbol: string;
  sector: string;
  setupType: string;              // e.g. 'breakout', 'pullback'
  setupScore?: number;            // optional ranking score, used in weekly review
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  convictionScore: number;
  marketRegimeAtEntry: 'bull' | 'neutral' | 'bear';
  entryTimestamp: string;         // ISO timestamp
  status?: 'active' | 'closed';

  // Populated on close
  exitPrice?: number;
  exitReason?: ExitReason;
  holdingDays?: number;
  netReturnPct?: number;

  // For daily review: current price of active position
  currentPrice?: number;
}

export interface AggregateMetrics {
  winRatePct: number;
  avgWinReturnPct: number;
  avgLossReturnPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeApproximation: number;
}

export interface TradeFilter {
  sector?: string;
  setupType?: string;
  marketRegime?: 'bull' | 'neutral' | 'bear';
  fromDate?: string;
  toDate?: string;
}

export interface DailyReview {
  date: string;
  activePositions: Array<TradeRecord & { unrealizedReturnPct: number; stopBreached: boolean }>;
}

export interface WeeklyReview {
  weekEnding: string;
  tradesThisWeek: TradeRecord[];
  winRatePct: number;
  avgReturnPct: number;
  topFiveByScore: Array<{ setupId: string; setupScore: number }>;
  bottomFiveByScore: Array<{ setupId: string; setupScore: number }>;
}

export interface MonthlyReview {
  month: string;                   // YYYY-MM
  closedTrades: TradeRecord[];
  aggregateMetrics: AggregateMetrics;
  underperformingStrategies: string[];
}


// ─── computeAggregateMetrics ──────────────────────────────────────────────────

/**
 * Computes aggregate performance metrics across all closed trade records.
 * Returns zero-valued metrics for an empty array — never throws.
 */
export function computeAggregateMetrics(records: TradeRecord[]): AggregateMetrics {
  const zero: AggregateMetrics = {
    winRatePct: 0,
    avgWinReturnPct: 0,
    avgLossReturnPct: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    sharpeApproximation: 0,
  };

  if (records.length === 0) return zero;

  const closed = records.filter(r => r.netReturnPct !== undefined && r.netReturnPct !== null);
  if (closed.length === 0) return zero;

  const returns = closed.map(r => r.netReturnPct as number);
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r <= 0);

  const winRatePct = (wins.length / closed.length) * 100;
  const avgWinReturnPct = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLossReturnPct = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const grossGain = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss === 0 ? (grossGain > 0 ? Infinity : 0) : grossGain / grossLoss;

  // Max drawdown: peak-to-trough on cumulative return curve
  let peak = 0;
  let cumulative = 0;
  let maxDrawdownPct = 0;
  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  // Sharpe approximation: mean / stddev of returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const stddev = Math.sqrt(variance);
  const sharpeApproximation = stddev === 0 ? 0 : mean / stddev;

  return {
    winRatePct,
    avgWinReturnPct,
    avgLossReturnPct,
    profitFactor: isFinite(profitFactor) ? profitFactor : grossGain > 0 ? 999 : 0,
    maxDrawdownPct,
    sharpeApproximation: isFinite(sharpeApproximation) ? sharpeApproximation : 0,
  };
}

// ─── filterTradeRecords ───────────────────────────────────────────────────────

/**
 * Filters an array of TradeRecords by the provided predicates.
 * All filter fields are optional; only non-undefined fields are applied.
 * Returns records in chronological order by entryTimestamp.
 * Returns an empty array (not an error) when no records match.
 */
export function filterTradeRecords(
  records: TradeRecord[],
  filter: TradeFilter
): TradeRecord[] {
  const result = records.filter(record => {
    if (filter.sector !== undefined && record.sector !== filter.sector) return false;
    if (filter.setupType !== undefined && record.setupType !== filter.setupType) return false;
    if (filter.marketRegime !== undefined && record.marketRegimeAtEntry !== filter.marketRegime) return false;
    if (filter.fromDate !== undefined && record.entryTimestamp < filter.fromDate) return false;
    if (filter.toDate !== undefined && record.entryTimestamp > filter.toDate) return false;
    return true;
  });

  // Sort chronologically by entryTimestamp
  result.sort((a, b) => a.entryTimestamp.localeCompare(b.entryTimestamp));

  return result;
}

// ─── Review Functions ─────────────────────────────────────────────────────────

/**
 * Produces a DailyReview for the given date string (YYYY-MM-DD or ISO timestamp).
 * Active positions are those with status 'active' as of the review date.
 * Returns a valid empty review (not an error) for periods with no activity.
 */
export function produceDailyReview(
  records: TradeRecord[],
  date: string
): DailyReview {
  const reviewDate = date.slice(0, 10); // normalize to YYYY-MM-DD

  const activePositions = records
    .filter(r => {
      // Active: no exitReason / exitPrice, or status explicitly 'active'
      const isActive = r.status === 'active' || (r.exitPrice === undefined && r.exitReason === undefined);
      // Opened on or before the review date
      const enteredBeforeOrOn = r.entryTimestamp.slice(0, 10) <= reviewDate;
      return isActive && enteredBeforeOrOn;
    })
    .map(r => {
      const currentPrice = r.currentPrice ?? r.entryPrice;
      const unrealizedReturnPct =
        r.entryPrice > 0 ? ((currentPrice - r.entryPrice) / r.entryPrice) * 100 : 0;
      const stopBreached = currentPrice <= r.stopPrice;
      return { ...r, unrealizedReturnPct, stopBreached };
    });

  return { date: reviewDate, activePositions };
}

/**
 * Produces a WeeklyReview covering the 7 calendar days ending on `weekEnding` (YYYY-MM-DD).
 * Includes trades opened or closed in that window.
 * Returns a valid empty review for periods with no activity.
 */
export function produceWeeklyReview(
  records: TradeRecord[],
  weekEnding: string
): WeeklyReview {
  const endDate = weekEnding.slice(0, 10);
  const endMs = new Date(endDate).getTime();
  const startMs = endMs - 7 * 24 * 60 * 60 * 1000;
  const startDate = new Date(startMs).toISOString().slice(0, 10);

  const tradesThisWeek = records.filter(r => {
    const openedInWindow =
      r.entryTimestamp.slice(0, 10) >= startDate &&
      r.entryTimestamp.slice(0, 10) <= endDate;
    // Treat closed: we check if exitReason is set (closed trade)
    const closedInWindow =
      r.exitReason !== undefined &&
      r.entryTimestamp.slice(0, 10) <= endDate; // rough proxy; entryTimestamp used as we don't store exitTimestamp
    return openedInWindow || closedInWindow;
  });

  const closedThisWeek = tradesThisWeek.filter(r => r.netReturnPct !== undefined);
  const wins = closedThisWeek.filter(r => (r.netReturnPct ?? 0) > 0);
  const winRatePct = closedThisWeek.length > 0 ? (wins.length / closedThisWeek.length) * 100 : 0;
  const avgReturnPct =
    closedThisWeek.length > 0
      ? closedThisWeek.reduce((sum, r) => sum + (r.netReturnPct ?? 0), 0) / closedThisWeek.length
      : 0;

  // Sort by setupScore descending for top/bottom 5
  const withScore = tradesThisWeek
    .filter(r => r.setupScore !== undefined)
    .map(r => ({ setupId: r.id, setupScore: r.setupScore as number }))
    .sort((a, b) => b.setupScore - a.setupScore);

  const topFiveByScore = withScore.slice(0, 5);
  const bottomFiveByScore = withScore.slice(-5).reverse();

  return {
    weekEnding: endDate,
    tradesThisWeek,
    winRatePct,
    avgReturnPct,
    topFiveByScore,
    bottomFiveByScore,
  };
}

/**
 * Produces a MonthlyReview for the calendar month given as 'YYYY-MM'.
 * Includes all closed trades for that month and computes aggregate metrics.
 * Flags setup types with negative average net return as underperforming_strategy.
 * Returns a valid empty review for periods with no activity.
 */
export function produceMonthlyReview(
  records: TradeRecord[],
  month: string  // YYYY-MM
): MonthlyReview {
  const prefix = month.slice(0, 7); // ensure YYYY-MM format

  const closedTrades = records.filter(r => {
    const isClosed = r.netReturnPct !== undefined && r.exitReason !== undefined;
    // Use entryTimestamp month as the grouping key (or could use exit; entry is what's available)
    const inMonth = r.entryTimestamp.slice(0, 7) === prefix;
    return isClosed && inMonth;
  });

  const aggregateMetrics = computeAggregateMetrics(closedTrades);

  // Group by setupType, find types with negative average return
  const byType = new Map<string, number[]>();
  for (const r of closedTrades) {
    const returns = byType.get(r.setupType) ?? [];
    returns.push(r.netReturnPct as number);
    byType.set(r.setupType, returns);
  }

  const underperformingStrategies: string[] = [];
  for (const [setupType, returns] of byType.entries()) {
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    if (avg < 0) underperformingStrategies.push(setupType);
  }

  return { month: prefix, closedTrades, aggregateMetrics, underperformingStrategies };
}
