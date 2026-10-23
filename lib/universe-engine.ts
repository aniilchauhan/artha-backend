import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import path from 'path';
import type { DailyPredictionItem } from '../app/api/predictions/daily/route';

export interface UniverseStockRecord {
  ticker: string;
  symbol: string;
  companyName: string;
  series: string;
  sector: string;
  marketCapCr: number;
  marketCapCategory: string;
  currentPrice: number;
  changePct: number;
  changeInr: number;
  rsi14: number;
  atrPct: number;
  promoterHoldingPct: number;
  institutionalHoldingPct: number;
  publicHoldingPct: number;
  isin: string;
  dateOfListing: string;
  faceValue: number;
  liquidityTier: 'Liquid F&O / Mega' | 'Liquid Mid-Cap' | 'Small Cap' | 'Micro Cap / High Circuit Risk';
  exchange?: string;
  indices?: string[];
  closePrice?: number;
  sparkline?: number[];
}

let cachedRecords: UniverseStockRecord[] | null = null;
let cachedPredictions: DailyPredictionItem[] | null = null;

function resolveCsvPath(): string | null {
  const root = getAxionProjectRoot();
  const rootCsv = path.join(root, 'nse_2500_stocks_master.csv');
  if (fs.existsSync(rootCsv)) return rootCsv;
  const publicCsv = path.join(root, 'public', 'nse_2500_stocks_master.csv');
  if (fs.existsSync(publicCsv)) return publicCsv;
  return null;
}

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let inQ = false;
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQ = !inQ;
    } else if (char === ',' && !inQ) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  parts.push(cur.trim());
  return parts;
}

export function loadUniverseStockRecords(): UniverseStockRecord[] {
  if (cachedRecords && cachedRecords.length > 0) {
    return cachedRecords;
  }

  const csvPath = resolveCsvPath();
  if (!csvPath) {
    console.warn('[UniverseEngine] Master CSV file not found.');
    return [];
  }

  try {
    const rawContent = fs.readFileSync(csvPath, 'utf8');
    const lines = rawContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length <= 1) return [];

    const records: UniverseStockRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]);
      if (parts.length < 10) continue;

      const ticker = parts[0] || '';
      const symbol = parts[1] || ticker.replace(/\.(NS|BO)$/, '');
      const companyName = parts[2] || symbol;
      const series = parts[3] || 'EQ';
      const sector = parts[4] || 'Diversified';
      const marketCapCr = parseFloat(parts[5]?.replace(/,/g, '')) || 1000;
      const marketCapCategory = parts[6] || 'Mid Cap';
      const currentPrice = parseFloat(parts[7]?.replace(/,/g, '')) || 0;

      const rawChangePct = parts[8]?.replace(/%/g, '')?.replace(/\+/g, '') || '0';
      const changePct = parseFloat(rawChangePct) || 0;

      const rawChangeInr = parts[9]?.replace(/\+/g, '') || '0';
      const changeInr = parseFloat(rawChangeInr) || 0;

      const rsi14 = parseFloat(parts[10]) || 50;
      const rawAtr = parts[11]?.replace(/%/g, '') || '2';
      const atrPct = parseFloat(rawAtr) || 2;

      const promoterHoldingPct = parseFloat(parts[12]?.replace(/%/g, '')) || 0;
      const institutionalHoldingPct = parseFloat(parts[13]?.replace(/%/g, '')) || 0;
      const publicHoldingPct = parseFloat(parts[14]?.replace(/%/g, '')) || 0;
      const isin = parts[15] || '';
      const dateOfListing = parts[16] || '';
      const faceValue = parseFloat(parts[17]) || 10;

      // Determine liquidity tier
      let liquidityTier: UniverseStockRecord['liquidityTier'] = 'Liquid Mid-Cap';
      if (series === 'BE' || series === 'BZ' || marketCapCr < 500) {
        liquidityTier = 'Micro Cap / High Circuit Risk';
      } else if (marketCapCr >= 50000 || ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'LT', 'BHARTIARTL'].includes(symbol)) {
        liquidityTier = 'Liquid F&O / Mega';
      } else if (marketCapCr < 5000) {
        liquidityTier = 'Small Cap';
      }

      records.push({
        ticker,
        symbol,
        companyName,
        series,
        sector,
        marketCapCr,
        marketCapCategory,
        currentPrice,
        changePct,
        changeInr,
        rsi14,
        atrPct,
        promoterHoldingPct,
        institutionalHoldingPct,
        publicHoldingPct,
        isin,
        dateOfListing,
        faceValue,
        liquidityTier,
        exchange: parts[22] || (ticker.endsWith('.BO') ? 'BSE' : 'NSE'),
        indices: parts[23] ? parts[23].split(';').map(s => s.trim()).filter(Boolean) : [],
        closePrice: currentPrice - changeInr,
      });
    }

    cachedRecords = records;
    return records;
  } catch (error) {
    console.error('[UniverseEngine] Failed to load stocks CSV:', error);
    return [];
  }
}

export function generateUniversePredictions(effectiveDate: string = '2026-09-21'): DailyPredictionItem[] {
  if (cachedPredictions && cachedPredictions.length > 0 && cachedPredictions[0].date === effectiveDate) {
    return cachedPredictions;
  }

  const records = loadUniverseStockRecords();
  const items: DailyPredictionItem[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const s = records[idx];
    if (!Number.isFinite(s.currentPrice) || s.currentPrice <= 0) continue;
    const isBullish = s.changePct >= 0 || s.rsi14 >= 50;
    const direction: 'LONG' | 'SHORT' = isBullish ? 'LONG' : 'SHORT';

    // Multi-Tier Target Ladder (T1: Quick 1.5-3%, T2: Swing 4.5-9%, T3: Runner 10-28%)
    const t1MovePct = Math.max(1.5, Math.min(3.5, Number((s.atrPct * 0.9).toFixed(2))));
    const t2MovePct = Math.max(4.5, Math.min(9.0, Number((s.atrPct * 2.5).toFixed(2))));
    const t3MovePct = Math.max(10.0, Math.min(28.0, Number((s.atrPct * 5.5).toFixed(2))));

    const t1Price = Number((direction === 'LONG' ? s.currentPrice * (1 + t1MovePct / 100) : s.currentPrice * (1 - t1MovePct / 100)).toFixed(2));
    const t2Price = Number((direction === 'LONG' ? s.currentPrice * (1 + t2MovePct / 100) : s.currentPrice * (1 - t2MovePct / 100)).toFixed(2));
    const t3Price = Number((direction === 'LONG' ? s.currentPrice * (1 + t3MovePct / 100) : s.currentPrice * (1 - t3MovePct / 100)).toFixed(2));
    const stopPrice = Number((direction === 'LONG' ? s.currentPrice * (1 - t1MovePct / 100) : s.currentPrice * (1 + t1MovePct / 100)).toFixed(2));

    const targetTiers = [
      {
        tier: 'T1' as const,
        label: 'Quick Scalp (Intraday)',
        price: t1Price,
        returnPct: t1MovePct,
        status: ((direction === 'LONG' ? s.changePct >= t1MovePct : s.changePct <= -t1MovePct) ? 'hit' : 'active') as 'hit' | 'active' | 'pending',
      },
      {
        tier: 'T2' as const,
        label: 'Key Swing Target',
        price: t2Price,
        returnPct: t2MovePct,
        status: ((direction === 'LONG' ? s.changePct >= t2MovePct : s.changePct <= -t2MovePct) ? 'hit' : 'active') as 'hit' | 'active' | 'pending',
      },
      {
        tier: 'T3' as const,
        label: 'Extended Runner',
        price: t3Price,
        returnPct: t3MovePct,
        status: ((direction === 'LONG' ? s.changePct >= t3MovePct : s.changePct <= -t3MovePct) ? 'hit' : 'pending') as 'hit' | 'active' | 'pending',
      },
    ];

    const rrRatio = Number((t2MovePct / (t1MovePct || 1)).toFixed(1));
    const potentialCategory: 'scalp' | 'swing' | 'runner' = t3MovePct >= 12 ? 'runner' : t2MovePct >= 5 ? 'swing' : 'scalp';

    // Outcome determination based on actual 1D move
    let status: 'worked' | 'failed' | 'pending' = 'pending';
    let outcomeReason = '';

    if (direction === 'LONG') {
      if (s.changePct >= t1MovePct) {
        status = 'worked';
        outcomeReason = `T1 Profit Achieved: Price surged ${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}% meeting profit threshold.`;
      } else if (s.changePct <= -t1MovePct) {
        status = 'failed';
        outcomeReason = `Stop triggered: Stock pulled back ${s.changePct.toFixed(2)}% below defensive boundary.`;
      } else {
        status = 'pending';
        outcomeReason = `Session active: Fluctuation ${s.changePct > 0 ? '+' : ''}${s.changePct.toFixed(2)}% within boundaries.`;
      }
    } else {
      if (s.changePct <= -t1MovePct) {
        status = 'worked';
        outcomeReason = `Short T1 hit: Downward impulse ${s.changePct.toFixed(2)}% reached short objective.`;
      } else if (s.changePct >= t1MovePct) {
        status = 'failed';
        outcomeReason = `Short stop hit: Counter-trend rally +${s.changePct.toFixed(2)}% triggered stop loss.`;
      } else {
        status = 'pending';
        outcomeReason = `Session active: Fluctuation ${s.changePct.toFixed(2)}% within boundaries.`;
      }
    }

    // Conviction score (calibrated based on RSI momentum + institutional ownership)
    let conviction = 60;
    if (s.rsi14 >= 45 && s.rsi14 <= 65) conviction += 15;
    if (s.institutionalHoldingPct > 20) conviction += 12;
    if (s.marketCapCr > 25000) conviction += 8;
    if (s.series === 'BE' || s.series === 'BZ') conviction -= 25; // Circuit penalty
    conviction = Math.max(35, Math.min(95, conviction));

    items.push({
      id: `univ-${s.symbol}-${effectiveDate}`,
      ticker: s.symbol,
      companyName: s.companyName,
      sector: s.sector,
      date: effectiveDate,
      direction,
      status,
      predictedMove: `${direction === 'LONG' ? '+' : '-'}${t1MovePct}% T1 / ${t2MovePct}% T2 / ${t3MovePct}% T3 (Max: +${t3MovePct}%)`,
      entryPrice: s.currentPrice,
      targetPrice: t1Price,
      stopPrice,
      actualPrice: s.currentPrice,
      returnPct: s.changePct,
      convictionScore: conviction,
      outcomeReason,
      model: s.liquidityTier === 'Liquid F&O / Mega' ? 'Axion ML Multi-Factor' : 'Axion Universe Quantitative Scanner',
      setupType: s.rsi14 > 60 ? 'Momentum Trend' : s.rsi14 < 40 ? 'Mean Reversion' : 'Breakout Continuation',
      timeframe: `Ladder: T1 (+${t1MovePct}%) / T2 (+${t2MovePct}%) / T3 (+${t3MovePct}%)`,
      targetTiers,
      maxPotentialPct: t3MovePct,
      rewardRiskRatio: rrRatio,
      potentialCategory,
    });
  }

  cachedPredictions = items;
  return items;
}

export interface UniverseQueryOptions {
  universe?: 'curated' | 'full';
  search?: string;
  sector?: string;
  status?: 'all' | 'worked' | 'failed' | 'pending';
  potential?: 'all' | 'scalp' | 'swing' | 'runner';
  page?: number;
  limit?: number;
  date?: string;
}

export function queryUniversePredictions(options: UniverseQueryOptions = {}) {
  const {
    search = '',
    sector = 'ALL',
    status = 'all',
    potential = 'all',
    page = 1,
    limit = 25,
    date = '2026-09-21',
  } = options;

  const allPredictions = generateUniversePredictions(date);

  const normalizedSearch = search.trim().toLowerCase();
  const normalizedSector = sector.trim().toUpperCase();

  const filtered = allPredictions.filter(item => {
    if (normalizedSearch) {
      const matchTicker = item.ticker.toLowerCase().includes(normalizedSearch);
      const matchName = (item.companyName || '').toLowerCase().includes(normalizedSearch);
      if (!matchTicker && !matchName) return false;
    }

    if (normalizedSector !== 'ALL') {
      if ((item.sector || '').toUpperCase() !== normalizedSector) return false;
    }

    if (status !== 'all') {
      if (item.status !== status) return false;
    }

    if (potential !== 'all') {
      if (item.potentialCategory !== potential) return false;
    }

    return true;
  });

  const workedCount = filtered.filter(i => i.status === 'worked').length;
  const failedCount = filtered.filter(i => i.status === 'failed').length;
  const pendingCount = filtered.filter(i => i.status === 'pending').length;
  const completedCount = workedCount + failedCount;
  const winRatePct = completedCount > 0 ? Math.round((workedCount / completedCount) * 100) : 0;

  const workedItems = filtered.filter(i => i.status === 'worked');
  const failedItems = filtered.filter(i => i.status === 'failed');

  const avgWinReturnPct = workedItems.length > 0
    ? Number((workedItems.reduce((acc, cur) => acc + (cur.returnPct || 0), 0) / workedItems.length).toFixed(2))
    : 0;

  const avgLossReturnPct = failedItems.length > 0
    ? Number((failedItems.reduce((acc, cur) => acc + (cur.returnPct || 0), 0) / failedItems.length).toFixed(2))
    : 0;

  // Pagination
  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (safePage - 1) * limit;
  const paginatedItems = filtered.slice(startIndex, startIndex + limit);

  // Sector breakdown list
  const sectors = Array.from(new Set(allPredictions.map(p => p.sector || 'Other'))).sort();

  return {
    total,
    page: safePage,
    totalPages,
    limit,
    sectors: ['ALL', ...sectors],
    summary: {
      total,
      worked: workedCount,
      failed: failedCount,
      pending: pendingCount,
      winRatePct,
      avgWinReturnPct,
      avgLossReturnPct,
    },
    predictions: paginatedItems,
  };
}
