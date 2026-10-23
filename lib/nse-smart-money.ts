/**
 * NSE Smart Money & Delivery Intelligence Engine
 * 
 * Ingests official National Stock Exchange (NSE) daily datasets:
 * 1. Security-wise Delivery Position (sec_bhavdata_full_DDMMYYYY.csv)
 *    - Actual shares delivered into Demat accounts (TTL_TRD_QNTY, DELIV_QTY, DELIV_PER)
 *    - Distinguishes genuine institutional accumulation (>55% delivery) from retail day-trading churn.
 * 2. Participant-wise Open Interest (fao_participant_oi_DDMMYYYY.csv)
 *    - FII, DII, Pro, and Client derivatives position breakdown (Index Futures Long/Short)
 *    - Calculates the institutional FII Long Ratio & smart-money vs retail sentiment divergence.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface NseStockDelivery {
  symbol: string;
  series: string;
  date: string;
  prevClose: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  changePercent: number;
  tradedQuantity: number;
  turnoverLakhs: number;
  numberOfTrades: number;
  deliveryQuantity: number;
  deliveryPercentage: number;
  isInstitutionalAccumulation: boolean;
  isDistribution: boolean;
  turnoverCr: number;
}

export interface ParticipantHolding {
  futureIndexLong: number;
  futureIndexShort: number;
  longRatio: number;
  futureStockLong: number;
  futureStockShort: number;
  sentiment?: 'Strongly Bullish' | 'Bullish' | 'Neutral' | 'Bearish' | 'Oversold Squeeze Candidate';
}

export interface NseParticipantOi {
  date: string;
  fii: ParticipantHolding;
  dii: ParticipantHolding;
  pro: ParticipantHolding;
  client: ParticipantHolding;
  institutionalBias: string;
  marketRegime: string;
}

export interface NseMarketInsights {
  date: string;
  participantOi: NseParticipantOi | null;
  topAccumulationStocks: NseStockDelivery[];
  topDistributionStocks: NseStockDelivery[];
  totalEquitiesTracked: number;
  averageDeliveryPercentage: number;
  source: 'nse-official-archives' | 'cached' | 'fallback';
}

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'nse-archives');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Fetch raw file from NSE archives using standard browser headers.
 */
async function fetchNseArchiveFile(url: string, timeoutMs = 12000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formats a Date object to DDMMYYYY string (e.g. 04102024).
 */
export function formatNseDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

/**
 * Parse Security-wise Bhavcopy with Delivery (sec_bhavdata_full).
 */
export function parseNseDeliveryCsv(csvText: string): Map<string, NseStockDelivery> {
  const map = new Map<string, NseStockDelivery>();
  const lines = csvText.split('\n');
  if (lines.length < 2) return map;

  const header = lines[0].split(',').map(h => h.trim());
  const symbolIdx = header.indexOf('SYMBOL');
  const seriesIdx = header.indexOf('SERIES');
  const dateIdx = header.indexOf('DATE1');
  const prevCloseIdx = header.indexOf('PREV_CLOSE');
  const openIdx = header.indexOf('OPEN_PRICE');
  const highIdx = header.indexOf('HIGH_PRICE');
  const lowIdx = header.indexOf('LOW_PRICE');
  const closeIdx = header.indexOf('CLOSE_PRICE');
  const trdQtyIdx = header.indexOf('TTL_TRD_QNTY');
  const turnoverIdx = header.indexOf('TURNOVER_LACS');
  const tradesIdx = header.indexOf('NO_OF_TRADES');
  const delivQtyIdx = header.indexOf('DELIV_QTY');
  const delivPerIdx = header.indexOf('DELIV_PER');

  if (symbolIdx === -1 || closeIdx === -1 || delivPerIdx === -1) return map;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',').map(p => p.trim());
    const symbol = parts[symbolIdx];
    const series = parts[seriesIdx] || 'EQ';

    // Focus on main-board EQ, BE, and SME series
    if (!['EQ', 'BE', 'SM', 'ST'].includes(series)) continue;

    const prevClose = parseFloat(parts[prevCloseIdx]) || 0;
    const openPrice = parseFloat(parts[openIdx]) || 0;
    const highPrice = parseFloat(parts[highIdx]) || 0;
    const lowPrice = parseFloat(parts[lowIdx]) || 0;
    const closePrice = parseFloat(parts[closeIdx]) || 0;
    const changePercent = prevClose > 0 ? Number((((closePrice - prevClose) / prevClose) * 100).toFixed(2)) : 0;
    const tradedQuantity = parseInt(parts[trdQtyIdx], 10) || 0;
    const turnoverLakhs = parseFloat(parts[turnoverIdx]) || 0;
    const numberOfTrades = parseInt(parts[tradesIdx], 10) || 0;
    const deliveryQuantity = parseInt(parts[delivQtyIdx], 10) || 0;
    const rawDelivPer = parseFloat(parts[delivPerIdx]);
    const deliveryPercentage = Number.isFinite(rawDelivPer) ? rawDelivPer : 0;

    const turnoverCr = Number((turnoverLakhs / 100).toFixed(2));
    const isInstitutionalAccumulation = deliveryPercentage >= 50 && changePercent >= 1.0 && turnoverLakhs >= 50;
    const isDistribution = deliveryPercentage >= 50 && changePercent <= -1.5 && turnoverLakhs >= 50;

    map.set(symbol, {
      symbol,
      series,
      date: parts[dateIdx] || '',
      prevClose,
      openPrice,
      highPrice,
      lowPrice,
      closePrice,
      changePercent,
      tradedQuantity,
      turnoverLakhs,
      numberOfTrades,
      deliveryQuantity,
      deliveryPercentage,
      isInstitutionalAccumulation,
      isDistribution,
      turnoverCr,
    });
  }

  return map;
}

/**
 * Parse Participant-wise F&O Open Interest CSV (fao_participant_oi).
 */
export function parseParticipantOiCsv(csvText: string): NseParticipantOi | null {
  const lines = csvText.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 5) return null;

  // Header line is usually line 1 (0-indexed)
  let headerIndex = -1;
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    if (lines[i].includes('Client Type') && lines[i].includes('Future Index Long')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return null;

  const header = lines[headerIndex].split(',').map(h => h.trim());
  const clientTypeIdx = header.indexOf('Client Type');
  const futIdxLongIdx = header.indexOf('Future Index Long');
  const futIdxShortIdx = header.indexOf('Future Index Short');
  const futStockLongIdx = header.indexOf('Future Stock Long');
  const futStockShortIdx = header.indexOf('Future Stock Short');

  const participants: Record<string, ParticipantHolding> = {};

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    const type = parts[clientTypeIdx]?.toLowerCase();
    if (!type || ['total', 'totals'].includes(type)) continue;

    const futLong = parseInt(parts[futIdxLongIdx], 10) || 0;
    const futShort = parseInt(parts[futIdxShortIdx], 10) || 0;
    const stockLong = parseInt(parts[futStockLongIdx], 10) || 0;
    const stockShort = parseInt(parts[futStockShortIdx], 10) || 0;
    const totalFut = futLong + futShort;
    const longRatio = totalFut > 0 ? Number(((futLong / totalFut) * 100).toFixed(2)) : 0;

    let sentiment: ParticipantHolding['sentiment'] = 'Neutral';
    if (longRatio <= 22) sentiment = 'Oversold Squeeze Candidate';
    else if (longRatio >= 72) sentiment = 'Strongly Bullish';
    else if (longRatio >= 55) sentiment = 'Bullish';
    else if (longRatio <= 40) sentiment = 'Bearish';

    participants[type] = {
      futureIndexLong: futLong,
      futureIndexShort: futShort,
      longRatio,
      futureStockLong: stockLong,
      futureStockShort: stockShort,
      sentiment,
    };
  }

  const fii = participants['fii'] || { futureIndexLong: 0, futureIndexShort: 0, longRatio: 50, futureStockLong: 0, futureStockShort: 0, sentiment: 'Neutral' };
  const dii = participants['dii'] || { futureIndexLong: 0, futureIndexShort: 0, longRatio: 50, futureStockLong: 0, futureStockShort: 0, sentiment: 'Neutral' };
  const pro = participants['pro'] || { futureIndexLong: 0, futureIndexShort: 0, longRatio: 50, futureStockLong: 0, futureStockShort: 0, sentiment: 'Neutral' };
  const client = participants['client'] || { futureIndexLong: 0, futureIndexShort: 0, longRatio: 50, futureStockLong: 0, futureStockShort: 0, sentiment: 'Neutral' };

  let institutionalBias = 'Neutral Institutional Position';
  let marketRegime = 'Balanced derivatives market';

  if (fii.longRatio <= 22) {
    institutionalBias = 'Extreme Institutional Short Exposure (High Squeeze Probability)';
    marketRegime = 'Over-hedged / Short-heavy regime — upside explosive risk on short covering';
  } else if (fii.longRatio >= 72) {
    institutionalBias = 'Overbought Institutional Long (Distribution Vulnerability)';
    marketRegime = 'Aggressive long exposure — trailing stops advised, susceptible to pullbacks';
  } else if (fii.longRatio > client.longRatio + 15) {
    institutionalBias = 'Smart Money Long / Retail Short Divergence';
    marketRegime = 'Constructive bullish setup with institutional accumulation';
  } else if (client.longRatio > fii.longRatio + 20) {
    institutionalBias = 'Retail Euphoria / Institutional Hedging Divergence';
    marketRegime = 'Caution warranted — retail heavily long while foreign institutions hedge short';
  }

  return {
    date: new Date().toISOString().split('T')[0],
    fii,
    dii,
    pro,
    client,
    institutionalBias,
    marketRegime,
  };
}

/**
 * Downloads or loads cached NSE daily delivery and participant open interest data.
 */
export async function getLatestNseMarketInsights(): Promise<NseMarketInsights> {
  ensureCacheDir();

  // Try past 10 calendar days until finding the most recent completed market session
  const now = new Date();
  let deliveryMap: Map<string, NseStockDelivery> | null = null;
  let participantOi: NseParticipantOi | null = null;
  let resolvedDateStr = '';
  let source: NseMarketInsights['source'] = 'cached';

  for (let offset = 0; offset < 10; offset++) {
    const targetDate = new Date(now.getTime() - offset * 86400000);
    const day = targetDate.getDay();
    if (day === 0 || day === 6) continue; // Skip weekends

    const dateKey = formatNseDate(targetDate);
    const deliveryCacheFile = path.join(CACHE_DIR, `sec_bhavdata_full_${dateKey}.csv`);
    const oiCacheFile = path.join(CACHE_DIR, `fao_participant_oi_${dateKey}.csv`);

    let deliveryCsvText: string | null = null;
    let oiCsvText: string | null = null;

    if (fs.existsSync(deliveryCacheFile)) {
      deliveryCsvText = fs.readFileSync(deliveryCacheFile, 'utf8');
    } else {
      const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dateKey}.csv`;
      deliveryCsvText = await fetchNseArchiveFile(url);
      if (deliveryCsvText && deliveryCsvText.includes('SYMBOL') && deliveryCsvText.includes('DELIV_PER')) {
        fs.writeFileSync(deliveryCacheFile, deliveryCsvText, 'utf8');
        source = 'nse-official-archives';
      } else {
        deliveryCsvText = null;
      }
    }

    if (fs.existsSync(oiCacheFile)) {
      oiCsvText = fs.readFileSync(oiCacheFile, 'utf8');
    } else {
      const url = `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${dateKey}.csv`;
      oiCsvText = await fetchNseArchiveFile(url);
      if (oiCsvText && oiCsvText.includes('Future Index Long')) {
        fs.writeFileSync(oiCacheFile, oiCsvText, 'utf8');
      } else {
        oiCsvText = null;
      }
    }

    if (deliveryCsvText) {
      deliveryMap = parseNseDeliveryCsv(deliveryCsvText);
      resolvedDateStr = `${dateKey.slice(0, 2)}-${dateKey.slice(2, 4)}-${dateKey.slice(4)}`;
      if (oiCsvText) {
        participantOi = parseParticipantOiCsv(oiCsvText);
      }
      break;
    }
  }

  // Fallback if network or archives are unreachable
  if (!deliveryMap || deliveryMap.size === 0) {
    return getFallbackNseInsights();
  }

  const allEquities = Array.from(deliveryMap.values());
  const topAccumulationStocks = allEquities
    .filter(s => s.turnoverLakhs >= 100 && s.deliveryPercentage >= 50 && s.changePercent > 0)
    .sort((a, b) => b.deliveryPercentage - a.deliveryPercentage || b.turnoverLakhs - a.turnoverLakhs)
    .slice(0, 15);

  const topDistributionStocks = allEquities
    .filter(s => s.turnoverLakhs >= 100 && s.deliveryPercentage >= 50 && s.changePercent < -1.0)
    .sort((a, b) => b.deliveryPercentage - a.deliveryPercentage || b.turnoverLakhs - a.turnoverLakhs)
    .slice(0, 15);

  const totalDeliverySum = allEquities.reduce((acc, s) => acc + s.deliveryPercentage, 0);
  const averageDeliveryPercentage = allEquities.length > 0
    ? Number((totalDeliverySum / allEquities.length).toFixed(1))
    : 45.0;

  return {
    date: resolvedDateStr,
    participantOi,
    topAccumulationStocks,
    topDistributionStocks,
    totalEquitiesTracked: allEquities.length,
    averageDeliveryPercentage,
    source,
  };
}

/**
 * Queries delivery statistics for a specific NSE ticker symbol.
 */
export async function getNseStockDelivery(symbol: string): Promise<NseStockDelivery | null> {
  const cleanSymbol = symbol.trim().toUpperCase().replace(/\.NS$/, '');
  const insights = await getLatestNseMarketInsights();
  const dateKey = insights.date.replace(/-/g, '');
  const deliveryCacheFile = path.join(CACHE_DIR, `sec_bhavdata_full_${dateKey}.csv`);

  if (fs.existsSync(deliveryCacheFile)) {
    const map = parseNseDeliveryCsv(fs.readFileSync(deliveryCacheFile, 'utf8'));
    return map.get(cleanSymbol) || null;
  }

  return null;
}

/**
 * Deterministic fallback when exchange data is offline or during testing.
 */
function getFallbackNseInsights(): NseMarketInsights {
  return {
    date: 'Historical Benchmark Session',
    participantOi: {
      date: 'Latest',
      fii: { futureIndexLong: 304662, futureIndexShort: 221675, longRatio: 57.88, futureStockLong: 2495456, futureStockShort: 1781399, sentiment: 'Bullish' },
      dii: { futureIndexLong: 98432, futureIndexShort: 175873, longRatio: 35.88, futureStockLong: 105342, futureStockShort: 3262548, sentiment: 'Bearish' },
      pro: { futureIndexLong: 79706, futureIndexShort: 116571, longRatio: 40.61, futureStockLong: 646144, futureStockShort: 205183, sentiment: 'Bearish' },
      client: { futureIndexLong: 381416, futureIndexShort: 350097, longRatio: 52.14, futureStockLong: 2265568, futureStockShort: 263380, sentiment: 'Neutral' },
      institutionalBias: 'Moderate Foreign Institutional Long Exposure',
      marketRegime: 'Constructive accumulation regime — FIIs net buyers in equity futures',
    },
    topAccumulationStocks: [
      {
        symbol: 'RELIANCE', series: 'EQ', date: 'Session', prevClose: 2813.95, openPrice: 2807.85, highPrice: 2834.70, lowPrice: 2763.55,
        closePrice: 2842.00, changePercent: 1.0, tradedQuantity: 18536438, turnoverLakhs: 518307, numberOfTrades: 534690,
        deliveryQuantity: 10930510, deliveryPercentage: 58.97, isInstitutionalAccumulation: true, isDistribution: false, turnoverCr: 5183.07
      },
      {
        symbol: 'TCS', series: 'EQ', date: 'Session', prevClose: 4210.00, openPrice: 4225.00, highPrice: 4290.00, lowPrice: 4210.00,
        closePrice: 4280.00, changePercent: 1.66, tradedQuantity: 3200000, turnoverLakhs: 136960, numberOfTrades: 120000,
        deliveryQuantity: 2150000, deliveryPercentage: 67.18, isInstitutionalAccumulation: true, isDistribution: false, turnoverCr: 1369.60
      }
    ],
    topDistributionStocks: [],
    totalEquitiesTracked: 2740,
    averageDeliveryPercentage: 46.2,
    source: 'fallback',
  };
}
