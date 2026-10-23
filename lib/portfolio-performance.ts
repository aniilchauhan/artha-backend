import { parseTradeDate, getFinancialYear, getFinancialYearRange } from './date-parser';

export type LedgerRow = {
  id?: string;
  ticker: string;
  displayName?: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  timestamp?: string;
  reportedPnl?: number;
  brokerage?: number;
  taxes?: number;
  netValue?: number;
  holdingDays?: number;
};

export type PerformanceFilter =
  | { type: 'fy'; fy: string } // e.g. '2025-26', '2026-27'
  | { type: 'calendar'; year: number } // e.g. 2026
  | { type: 'custom'; startDate: string; endDate: string } // YYYY-MM-DD
  | { type: 'all' };

export interface ClosedTradeRecord {
  id?: string;
  ticker: string;
  displayName?: string;
  quantity: number;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  grossPnl: number;
  charges: number;
  netPnl: number;
  returnPercent: number;
  holdingDays: number;
  /** @deprecated 365-day heuristic only; not a tax classification. */
  isLtcg: boolean;
}

export interface MonthlyPnlRecord {
  month: string; // e.g. 'Apr 2026'
  yearMonth: string; // e.g. '2026-04'
  grossPnl: number;
  netPnl: number;
  tradesCount: number;
  winRate: number;
}

export interface StockPerformanceContribution {
  ticker: string;
  displayName: string;
  grossPnl: number;
  netPnl: number;
  tradesCount: number;
  winRate: number;
  totalQuantity: number;
}

export interface PortfolioPerformanceOptions {
  actualChargesOverride?: number;
  actualRealizedOverride?: number;
}

export interface PortfolioPerformanceResult {
  realized: number; // Gross Realized P&L (reconciled or calculated)
  rawRealized: number; // Raw FIFO calculated P&L before broker override
  netRealized: number; // Net Realized P&L after broker/estimated charges
  totalCharges: number; // Broker charges (actual or estimated)
  rawEstimatedCharges: number; // Statutory estimated charges
  isReconciled: boolean;
  chargesOverrideApplied: boolean;
  buys: number; // Total shares bought in period
  sells: number; // Total shares sold in period
  buyTurnover: number;
  sellTurnover: number;
  totalTurnover: number;
  totalCostBasis: number; // Total purchase cost of closed trade lots
  returnPercent: number; // Realized return percentage = (realized / totalCostBasis) * 100
  chargesDragPct: number;
  closedTrades: ClosedTradeRecord[];
  winningTrades: number;
  losingTrades: number;
  winRate: number; // %

  // Quant & Trading Discipline metrics
  profitFactor: number;
  totalGains: number;
  totalLosses: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
  expectancyPerTrade: number;
  largestWin: ClosedTradeRecord | null;
  largestLoss: ClosedTradeRecord | null;

  // Deprecated rough tax fields retained for legacy compatibility. Do not display as tax estimates.
  stcgGross: number;
  stcgNet: number;
  estimatedStcgTax: number;
  ltcgGross: number;
  ltcgNet: number;
  estimatedLtcgTax: number;
  avgHoldingDays: number;

  // Visual Breakdown Series
  monthlyPnl: MonthlyPnlRecord[];
  topGainers: StockPerformanceContribution[];
  topLosers: StockPerformanceContribution[];
}

interface FifoLot {
  buyId?: string;
  buyDate: string;
  buyTimestamp: number;
  quantity: number;
  price: number;
}

/**
 * Calculates estimated Indian delivery equity charges (Brokerage, STT, Stamp Duty, GST, Exchange).
 */
export function estimateTradeCharges(turnover: number, isBuy: boolean): number {
  if (turnover <= 0) return 0;
  const brokerage = Math.min(20, turnover * 0.0003);
  const stt = turnover * 0.001; // 0.1% on delivery buy and sell
  const stampDuty = isBuy ? turnover * 0.00015 : 0; // 0.015% only on buy
  const sebiFee = turnover * 0.000001;
  const exchangeCharge = turnover * 0.0000345;
  const gst = (brokerage + exchangeCharge + sebiFee) * 0.18;
  return brokerage + stt + stampDuty + sebiFee + exchangeCharge + gst;
}

/**
 * Helper to check if a date falls within the selected PerformanceFilter.
 */
function isDateInFilter(date: Date, filter: PerformanceFilter): boolean {
  if (filter.type === 'all') return true;

  if (filter.type === 'calendar') {
    return date.getFullYear() === filter.year;
  }

  if (filter.type === 'fy') {
    const range = getFinancialYearRange(filter.fy);
    if (!range) return getFinancialYear(date) === filter.fy;
    const t = date.getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
  }

  if (filter.type === 'custom') {
    const start = filter.startDate ? new Date(`${filter.startDate}T00:00:00`).getTime() : -Infinity;
    const end = filter.endDate ? new Date(`${filter.endDate}T23:59:59.999`).getTime() : Infinity;
    const t = date.getTime();
    return t >= start && t <= end;
  }

  return true;
}

/**
 * Robust chronological portfolio performance engine.
 * Supports:
 * - Chronological sorting: Oldest trades first.
 * - Same-day ordering: BUYs strictly before SELLs.
 * - FIFO lot matching for precise realized P&L calculation.
 * - Respects broker reported P&L when available.
 * - Supports Indian Financial Year, Calendar Year, Custom Date Range, and All-Time.
 */
export function calculatePortfolioPerformance(
  rows: readonly LedgerRow[],
  filter: PerformanceFilter = { type: 'all' },
  options?: PortfolioPerformanceOptions
): PortfolioPerformanceResult {
  // 1. Prepare and parse dates for all rows
  interface PreparedRow {
    raw: LedgerRow;
    date: Date | null;
    timestampMs: number;
    isoDate: string;
    originalIndex: number;
  }

  const prepared: PreparedRow[] = rows.map((row, idx) => {
    const parsed = parseTradeDate(row.timestamp);
    return {
      raw: row,
      date: parsed?.date ?? null,
      timestampMs: parsed?.date?.getTime() ?? 0,
      isoDate: parsed?.isoDate ?? '',
      originalIndex: idx,
    };
  });

  // 2. Sort chronologically:
  // - Ascending timestampMs (oldest first)
  // - If same timestamp: BUY before SELL (-1 for BUY, 1 for SELL)
  // - Stable tie-breaker: originalIndex
  prepared.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) {
      // Put undated at the very beginning so they can establish opening positions
      if (a.timestampMs === 0) return -1;
      if (b.timestampMs === 0) return 1;
      return a.timestampMs - b.timestampMs;
    }
    // Same day/timestamp: BUY before SELL
    if (a.raw.action !== b.raw.action) {
      return a.raw.action === 'BUY' ? -1 : 1;
    }
    return a.originalIndex - b.originalIndex;
  });

  // 3. FIFO position tracking per stock
  const fifoInventory: Record<string, FifoLot[]> = {};
  const closedTrades: ClosedTradeRecord[] = [];

  let totalRealized = 0;
  let totalBuyTurnover = 0;
  let totalSellTurnover = 0;
  let totalBuysCount = 0;
  let totalSellsCount = 0;
  let totalCharges = 0;

  for (const item of prepared) {
    const { raw, date, isoDate, timestampMs } = item;
    const ticker = raw.ticker;
    const qty = raw.quantity;
    const price = raw.price;

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (!fifoInventory[ticker]) {
      fifoInventory[ticker] = [];
    }

    const inFilter = date ? isDateInFilter(date, filter) : false;

    if (raw.action === 'BUY') {
      fifoInventory[ticker].push({
        buyId: raw.id,
        buyDate: isoDate || 'Opening Lot',
        buyTimestamp: timestampMs || 0,
        quantity: qty,
        price: price,
      });

      if (inFilter) {
        totalBuysCount += qty;
        totalBuyTurnover += qty * price;
      }
    } else if (raw.action === 'SELL') {
      let remainingToSell = qty;
      let sellGrossPnl = 0;
      let totalCostOfSold = 0;
      let weightedBuyDate = isoDate;
      let weightedHoldingDays = 0;

      // Check if broker provided reported P&L directly
      const hasReportedPnl = Number.isFinite(raw.reportedPnl);

      // Match against FIFO lots
      while (remainingToSell > 0 && fifoInventory[ticker].length > 0) {
        const lot = fifoInventory[ticker][0];
        const matchQty = Math.min(remainingToSell, lot.quantity);

        const buyCost = matchQty * lot.price;
        const sellVal = matchQty * price;
        const pnl = sellVal - buyCost;

        sellGrossPnl += pnl;
        totalCostOfSold += buyCost;

        // Holding period
        const holdingMs = timestampMs > lot.buyTimestamp ? timestampMs - lot.buyTimestamp : 0;
        let days = Math.max(0, Math.floor(holdingMs / (1000 * 60 * 60 * 24)));
        // Guard against corrupted/ancient dates (> 3650 days when trading in modern era)
        if (raw.holdingDays !== undefined && raw.holdingDays >= 0) {
          days = raw.holdingDays;
        } else if (days > 3650 && lot.buyTimestamp < new Date('2015-01-01').getTime()) {
          days = 0;
        }
        weightedHoldingDays += days * (matchQty / qty);
        weightedBuyDate = lot.buyDate;

        lot.quantity -= matchQty;
        remainingToSell -= matchQty;

        if (lot.quantity <= 0) {
          fifoInventory[ticker].shift();
        }
      }

      // If broker explicitly reported P&L on this row, prioritize it
      const finalGrossPnl = hasReportedPnl ? raw.reportedPnl! : sellGrossPnl;
      const effectiveBuyPrice = qty > 0 && totalCostOfSold > 0 ? totalCostOfSold / (qty - remainingToSell) : price - (finalGrossPnl / qty);

      const buyCharges = estimateTradeCharges(effectiveBuyPrice * qty, true);
      const sellCharges = estimateTradeCharges(price * qty, false);
      const tradeCharges = (raw.brokerage ?? 0) + (raw.taxes ?? 0) > 0
        ? (raw.brokerage ?? 0) + (raw.taxes ?? 0)
        : buyCharges + sellCharges;

      const netPnl = finalGrossPnl - tradeCharges;
      const returnPct = effectiveBuyPrice > 0 ? ((price - effectiveBuyPrice) / effectiveBuyPrice) * 100 : 0;
      const finalHoldingDays = raw.holdingDays !== undefined && raw.holdingDays >= 0
        ? raw.holdingDays
        : (weightedHoldingDays > 3650 ? 0 : Math.round(weightedHoldingDays));

      if (inFilter) {
        totalSellsCount += qty;
        totalSellTurnover += qty * price;
        totalRealized += finalGrossPnl;
        totalCharges += tradeCharges;

        closedTrades.push({
          id: raw.id,
          ticker,
          displayName: raw.displayName || ticker,
          quantity: qty,
          buyDate: weightedBuyDate,
          sellDate: isoDate || 'Unknown',
          buyPrice: effectiveBuyPrice,
          sellPrice: price,
          grossPnl: finalGrossPnl,
          charges: tradeCharges,
          netPnl,
          returnPercent: returnPct,
          holdingDays: finalHoldingDays,
          isLtcg: finalHoldingDays > 365,
        });
      }
    }
  }

  const winningTradesList = closedTrades.filter(t => t.grossPnl > 0);
  const losingTradesList = closedTrades.filter(t => t.grossPnl < 0);
  const winningTrades = winningTradesList.length;
  const losingTrades = losingTradesList.length;
  const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

  const totalGains = Math.round(winningTradesList.reduce((sum, t) => sum + t.grossPnl, 0) * 100) / 100;
  const totalLosses = Math.round(Math.abs(losingTradesList.reduce((sum, t) => sum + t.grossPnl, 0)) * 100) / 100;
  const profitFactor = totalLosses > 0 ? Math.round((totalGains / totalLosses) * 100) / 100 : (totalGains > 0 ? 99.9 : 0);
  const avgWin = winningTrades > 0 ? Math.round((totalGains / winningTrades) * 100) / 100 : 0;
  const avgLoss = losingTrades > 0 ? Math.round((totalLosses / losingTrades) * 100) / 100 : 0;
  const payoffRatio = avgLoss > 0 ? Math.round((avgWin / avgLoss) * 100) / 100 : (avgWin > 0 ? 99.9 : 0);

  const rawRealized = Math.round(totalRealized * 100) / 100;
  const rawEstimatedCharges = Math.round(totalCharges * 100) / 100;

  const hasRealizedOverride = options?.actualRealizedOverride !== undefined && options.actualRealizedOverride !== null && Number.isFinite(Number(options.actualRealizedOverride)) && Number(options.actualRealizedOverride) !== 0;
  const hasChargesOverride = options?.actualChargesOverride !== undefined && options.actualChargesOverride !== null && Number.isFinite(Number(options.actualChargesOverride)) && Number(options.actualChargesOverride) > 0;

  if (hasRealizedOverride) {
    totalRealized = Number(options!.actualRealizedOverride);
  }
  if (hasChargesOverride) {
    totalCharges = Number(options!.actualChargesOverride);
  }

  const netRealized = Math.round(((Number(totalRealized) || 0) - (Number(totalCharges) || 0)) * 100) / 100;
  const expectancyPerTrade = closedTrades.length > 0 ? Math.round(((Number(totalRealized) || 0) / closedTrades.length) * 100) / 100 : 0;

  // Best and worst trades
  const sortedByPnl = [...closedTrades].sort((a, b) => b.grossPnl - a.grossPnl);
  const largestWin = sortedByPnl.length > 0 && sortedByPnl[0].grossPnl > 0 ? sortedByPnl[0] : null;
  const largestLoss = sortedByPnl.length > 0 && sortedByPnl[sortedByPnl.length - 1].grossPnl < 0 ? sortedByPnl[sortedByPnl.length - 1] : null;

  // Legacy approximation only; eligibility and financial-year aggregation are not validated.
  const stcgTrades = closedTrades.filter(t => !t.isLtcg);
  const ltcgTrades = closedTrades.filter(t => t.isLtcg);

  const stcgGross = Math.round(stcgTrades.reduce((sum, t) => sum + t.grossPnl, 0) * 100) / 100;
  const stcgCharges = stcgTrades.reduce((sum, t) => sum + t.charges, 0);
  const stcgNet = Math.round((stcgGross - stcgCharges) * 100) / 100;
  const estimatedStcgTax = stcgNet > 0 ? Math.round(stcgNet * 0.20 * 100) / 100 : 0;

  const ltcgGross = Math.round(ltcgTrades.reduce((sum, t) => sum + t.grossPnl, 0) * 100) / 100;
  const ltcgCharges = ltcgTrades.reduce((sum, t) => sum + t.charges, 0);
  const ltcgNet = Math.round((ltcgGross - ltcgCharges) * 100) / 100;
  // Historical simplified calculation retained for compatibility, not tax advice.
  const estimatedLtcgTax = ltcgNet > 125000 ? Math.round((ltcgNet - 125000) * 0.125 * 100) / 100 : 0;

  const avgHoldingDays = closedTrades.length > 0 
    ? Math.round(closedTrades.reduce((sum, t) => sum + t.holdingDays, 0) / closedTrades.length)
    : 0;

  const totalCostBasis = Math.round(closedTrades.reduce((sum, t) => sum + (t.buyPrice * t.quantity), 0) * 100) / 100;
  const returnPercent = totalCostBasis > 0 ? Math.round(((totalRealized / totalCostBasis) * 100) * 100) / 100 : 0;
  const totalTurnover = Math.round((totalBuyTurnover + totalSellTurnover) * 100) / 100;
  const chargesDragPct = totalRealized > 0 ? Math.round((totalCharges / totalRealized) * 1000) / 10 : 0;

  // Monthly Breakdown
  const monthMap = new Map<string, { yearMonth: string; monthLabel: string; gross: number; net: number; count: number; wins: number }>();
  for (const trade of closedTrades) {
    const [year, month] = trade.sellDate.split('-');
    if (year && month) {
      const ym = `${year}-${month}`;
      const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      const cur = monthMap.get(ym) || { yearMonth: ym, monthLabel: label, gross: 0, net: 0, count: 0, wins: 0 };
      cur.gross += trade.grossPnl;
      cur.net += trade.netPnl;
      cur.count += 1;
      if (trade.grossPnl > 0) cur.wins += 1;
      monthMap.set(ym, cur);
    }
  }

  const monthlyPnl: MonthlyPnlRecord[] = Array.from(monthMap.values())
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
    .map(m => ({
      month: m.monthLabel,
      yearMonth: m.yearMonth,
      grossPnl: Math.round(m.gross * 100) / 100,
      netPnl: Math.round(m.net * 100) / 100,
      tradesCount: m.count,
      winRate: m.count > 0 ? Math.round((m.wins / m.count) * 1000) / 10 : 0,
    }));

  // Stock-level aggregation
  const stockMap = new Map<string, { ticker: string; displayName: string; gross: number; net: number; count: number; wins: number; qty: number }>();
  for (const trade of closedTrades) {
    const cur = stockMap.get(trade.ticker) || {
      ticker: trade.ticker,
      displayName: trade.displayName || trade.ticker,
      gross: 0,
      net: 0,
      count: 0,
      wins: 0,
      qty: 0,
    };
    cur.gross += trade.grossPnl;
    cur.net += trade.netPnl;
    cur.count += 1;
    if (trade.grossPnl > 0) cur.wins += 1;
    cur.qty += trade.quantity;
    stockMap.set(trade.ticker, cur);
  }

  const allStocks = Array.from(stockMap.values()).map(s => ({
    ticker: s.ticker,
    displayName: s.displayName,
    grossPnl: Math.round(s.gross * 100) / 100,
    netPnl: Math.round(s.net * 100) / 100,
    tradesCount: s.count,
    winRate: s.count > 0 ? Math.round((s.wins / s.count) * 1000) / 10 : 0,
    totalQuantity: s.qty,
  }));

  const topGainers = allStocks.filter(s => s.grossPnl > 0).sort((a, b) => b.grossPnl - a.grossPnl).slice(0, 5);
  const topLosers = allStocks.filter(s => s.grossPnl < 0).sort((a, b) => a.grossPnl - b.grossPnl).slice(0, 5);

  return {
    realized: Number(Math.round(totalRealized * 100) / 100) || 0,
    rawRealized: Number(rawRealized) || 0,
    netRealized: Number(netRealized) || 0,
    totalCharges: Number(Math.round(totalCharges * 100) / 100) || 0,
    rawEstimatedCharges: Number(rawEstimatedCharges) || 0,
    isReconciled: Boolean(hasRealizedOverride || hasChargesOverride),
    chargesOverrideApplied: Boolean(hasChargesOverride),
    buys: Number(totalBuysCount) || 0,
    sells: Number(totalSellsCount) || 0,
    buyTurnover: Number(Math.round(totalBuyTurnover * 100) / 100) || 0,
    sellTurnover: Number(Math.round(totalSellTurnover * 100) / 100) || 0,
    totalTurnover: Number(totalTurnover) || 0,
    totalCostBasis: Number(totalCostBasis) || 0,
    returnPercent: Number(returnPercent) || 0,
    chargesDragPct: Number(chargesDragPct) || 0,
    closedTrades,
    winningTrades: Number(winningTrades) || 0,
    losingTrades: Number(losingTrades) || 0,
    winRate: Number(Math.round(winRate * 10) / 10) || 0,
    profitFactor: Number(profitFactor) || 0,
    totalGains: Number(totalGains) || 0,
    totalLosses: Number(totalLosses) || 0,
    avgWin: Number(avgWin) || 0,
    avgLoss: Number(avgLoss) || 0,
    payoffRatio: Number(payoffRatio) || 0,
    expectancyPerTrade: Number(expectancyPerTrade) || 0,
    largestWin,
    largestLoss,
    stcgGross: Number(stcgGross) || 0,
    stcgNet: Number(stcgNet) || 0,
    estimatedStcgTax: Number(estimatedStcgTax) || 0,
    ltcgGross: Number(ltcgGross) || 0,
    ltcgNet: Number(ltcgNet) || 0,
    estimatedLtcgTax: Number(estimatedLtcgTax) || 0,
    avgHoldingDays: Number(avgHoldingDays) || 0,
    monthlyPnl,
    topGainers,
    topLosers,
  };
}

/**
 * Backward-compatible wrapper for calendar year performance.
 */
export function calculateYearPerformance(rows: readonly LedgerRow[], year: number) {
  const result = calculatePortfolioPerformance(rows, { type: 'calendar', year });
  return {
    realized: result.realized,
    buys: result.buys,
    sells: result.sells,
  };
}
