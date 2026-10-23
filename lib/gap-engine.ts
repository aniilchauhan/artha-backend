import { getAxionProjectRoot } from './project-root';
import type {
  GapItem,
  GapScreenSummary,
  GapDirection,
  GapClassification,
  GapSetupType,
  GapFillStatus,
  GapRiskRating,
  GapTradeLevels,
  GapScanSource,
} from './gap-types';
import { fetchStockQuotes, stockSymbol, TICKER_NAMES } from './stock-fetcher';
import { indiaDay, isProviderStock } from './market-quote';

export interface RawStockQuoteInput {
  ticker: string;
  symbol: string;
  name?: string;
  sector?: string;
  marketCap?: number | null;
  previousClose: number;
  openPrice: number;
  currentPrice: number;
  highPrice: number;
  lowPrice: number;
  volume?: number;
  avgVolume?: number;
}

export function classifyGap(gapPercent: number): {
  direction: GapDirection;
  classification: GapClassification;
} {
  const rounded = Math.round(gapPercent * 100) / 100;
  if (rounded >= 3.0) {
    return { direction: 'GAP_UP', classification: 'STRONG_GAP_UP' };
  } else if (rounded >= 1.0) {
    return { direction: 'GAP_UP', classification: 'MODERATE_GAP_UP' };
  } else if (rounded >= 0.2) {
    return { direction: 'GAP_UP', classification: 'MILD_GAP_UP' };
  } else if (rounded <= -3.0) {
    return { direction: 'GAP_DOWN', classification: 'STRONG_GAP_DOWN' };
  } else if (rounded <= -1.0) {
    return { direction: 'GAP_DOWN', classification: 'MODERATE_GAP_DOWN' };
  } else if (rounded <= -0.2) {
    return { direction: 'GAP_DOWN', classification: 'MILD_GAP_DOWN' };
  }
  return { direction: 'FLAT', classification: 'FLAT' };
}

export function calculateGapFill(
  previousClose: number,
  openPrice: number,
  highPrice: number,
  lowPrice: number,
  direction: GapDirection
): { fillStatus: GapFillStatus; fillPercent: number } {
  if (direction === 'FLAT' || previousClose <= 0 || openPrice <= 0) {
    return { fillStatus: 'UNFILLED', fillPercent: 0 };
  }

  if (direction === 'GAP_UP') {
    const totalGap = openPrice - previousClose;
    if (totalGap <= 0) return { fillStatus: 'UNFILLED', fillPercent: 0 };

    if (lowPrice <= previousClose) {
      return { fillStatus: 'FILLED', fillPercent: 100 };
    }
    if (lowPrice < openPrice) {
      const filledAmount = openPrice - lowPrice;
      const pct = Math.min(100, Math.max(0, (filledAmount / totalGap) * 100));
      return {
        fillStatus: 'PARTIALLY_FILLED',
        fillPercent: Math.round(pct * 10) / 10,
      };
    }
    return { fillStatus: 'UNFILLED', fillPercent: 0 };
  }

  // GAP_DOWN
  const totalGap = previousClose - openPrice;
  if (totalGap <= 0) return { fillStatus: 'UNFILLED', fillPercent: 0 };

  if (highPrice >= previousClose) {
    return { fillStatus: 'FILLED', fillPercent: 100 };
  }
  if (highPrice > openPrice) {
    const filledAmount = highPrice - openPrice;
    const pct = Math.min(100, Math.max(0, (filledAmount / totalGap) * 100));
    return {
      fillStatus: 'PARTIALLY_FILLED',
      fillPercent: Math.round(pct * 10) / 10,
    };
  }
  return { fillStatus: 'UNFILLED', fillPercent: 0 };
}

export function determineSetupType(
  direction: GapDirection,
  openPrice: number,
  currentPrice: number,
  fillPercent: number,
  relativeVolume: number
): GapSetupType {
  if (direction === 'GAP_UP') {
    if (fillPercent >= 70) {
      return 'EXHAUSTION_GAP';
    }
    if (currentPrice < openPrice) {
      return 'GAP_FADE';
    }
    if (relativeVolume >= 1.5 && fillPercent <= 20) {
      return 'BREAKAWAY_GAP';
    }
    return 'GAP_AND_GO';
  }

  if (direction === 'GAP_DOWN') {
    if (fillPercent >= 70) {
      return 'EXHAUSTION_GAP';
    }
    if (currentPrice > openPrice) {
      return 'GAP_FADE'; // Fading the downward gap (rebounding)
    }
    return 'GAP_AND_GO'; // Continuing downward
  }

  return 'GAP_FADE';
}

export function computeTradeLevels(
  direction: GapDirection,
  previousClose: number,
  openPrice: number,
  currentPrice: number,
  lowPrice: number,
  highPrice: number,
  isExtendedGap: boolean
): GapTradeLevels {
  const round2 = (num: number) => Math.round(num * 100) / 100;

  if (direction === 'GAP_UP') {
    const entry = currentPrice;
    const target = round2(entry * 1.025); // Target +2.5%
    // Stop loss placed slightly below today's low or open, with gap slippage awareness
    const theoreticalStop = Math.min(openPrice * 0.99, lowPrice * 0.995);
    const stopLoss = round2(Math.max(previousClose * 0.99, theoreticalStop));
    const risk = Math.max(0.1, entry - stopLoss);
    const reward = Math.max(0.1, target - entry);
    const rrr = round2(reward / risk);

    return {
      entryPrice: entry,
      targetPrice: target,
      stopLossPrice: stopLoss,
      rewardRiskRatio: rrr > 0 ? rrr : 1.5,
      maxRiskPercent: round2(((entry - stopLoss) / entry) * 100),
      projectedProfitPercent: round2(((target - entry) / entry) * 100),
      gapSlippageWarning: isExtendedGap,
    };
  }

  // GAP_DOWN (or Short/Fade)
  const entry = currentPrice;
  const target = round2(entry * 0.975); // Target -2.5% for momentum continuation
  const stopLoss = round2(Math.max(openPrice * 1.01, highPrice * 1.005));
  const risk = Math.max(0.1, stopLoss - entry);
  const reward = Math.max(0.1, entry - target);
  const rrr = round2(reward / risk);

  return {
    entryPrice: entry,
    targetPrice: target,
    stopLossPrice: stopLoss,
    rewardRiskRatio: rrr > 0 ? rrr : 1.5,
    maxRiskPercent: round2(((stopLoss - entry) / entry) * 100),
    projectedProfitPercent: round2(((entry - target) / entry) * 100),
    gapSlippageWarning: isExtendedGap,
  };
}

export function processStockGap(input: RawStockQuoteInput): GapItem | null {
  const {
    ticker,
    symbol,
    name = symbol,
    sector = 'Equities',
    marketCap = null,
    previousClose,
    openPrice,
    currentPrice,
    highPrice,
    lowPrice,
    volume = 0,
    avgVolume,
  } = input;

  if (
    !previousClose ||
    !openPrice ||
    !currentPrice ||
    previousClose <= 0 ||
    openPrice <= 0 ||
    currentPrice <= 0
  ) {
    return null;
  }

  const gapAmount = Math.round((openPrice - previousClose) * 100) / 100;
  const gapPercent = Math.round(((openPrice - previousClose) / previousClose) * 10000) / 100;
  const currentChangePercent = Math.round(((currentPrice - previousClose) / previousClose) * 10000) / 100;
  const dayChangeFromOpenPercent = Math.round(((currentPrice - openPrice) / openPrice) * 10000) / 100;

  const { direction, classification } = classifyGap(gapPercent);
  const { fillStatus, fillPercent } = calculateGapFill(
    previousClose,
    openPrice,
    highPrice,
    lowPrice,
    direction
  );

  const relativeVolume = avgVolume && avgVolume > 0 ? Math.round((volume / avgVolume) * 100) / 100 : null;
  const setupType = determineSetupType(
    direction,
    openPrice,
    currentPrice,
    fillPercent,
    relativeVolume ?? 0
  );

  // Core risk policy check: gap > 3% is classified as EXTREME_CHASE per Axion validation standards
  const isExtendedGap = Math.abs(gapPercent) > 3.0;
  let riskRating: GapRiskRating = 'MODERATE';
  if (isExtendedGap) {
    riskRating = 'EXTREME_CHASE';
  } else if (Math.abs(gapPercent) <= 1.0) {
    riskRating = 'LOW';
  } else if (fillStatus === 'PARTIALLY_FILLED' && currentPrice < openPrice) {
    riskRating = 'HIGH';
  }

  const tradeLevels = computeTradeLevels(
    direction,
    previousClose,
    openPrice,
    currentPrice,
    lowPrice,
    highPrice,
    isExtendedGap
  );

  let category: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP' | 'UNKNOWN' = 'UNKNOWN';
  if (marketCap !== null && marketCap !== undefined) {
    if (marketCap >= 50000) category = 'LARGE_CAP';
    else if (marketCap >= 15000) category = 'MID_CAP';
    else category = 'SMALL_CAP';
  }

  let summary = '';
  if (isExtendedGap) {
    summary = `Observed ${Math.abs(gapPercent)}% opening gap, above the screener's 3% extended-gap threshold.`;
  } else if (setupType === 'GAP_AND_GO') {
    summary = `Price is ${dayChangeFromOpenPercent >= 0 ? '+' : ''}${dayChangeFromOpenPercent}% from the open; ${relativeVolume === null ? 'relative volume is unavailable.' : `session volume is ${relativeVolume}x the trailing daily average.`}`;
  } else if (setupType === 'BREAKAWAY_GAP') {
    summary = `Price is ${dayChangeFromOpenPercent >= 0 ? '+' : ''}${dayChangeFromOpenPercent}% from the open with session volume at ${relativeVolume}x the trailing daily average.`;
  } else if (setupType === 'GAP_FADE') {
    summary = `Price is ${dayChangeFromOpenPercent >= 0 ? '+' : ''}${dayChangeFromOpenPercent}% from the open; ${fillPercent}% of the opening gap has been filled.`;
  } else {
    summary = `${fillPercent}% of the opening gap has been filled as of the latest observation.`;
  }

  return {
    ticker,
    symbol,
    name,
    sector,
    marketCap,
    marketCapCategory: category,
    previousClose,
    openPrice,
    currentPrice,
    highPrice,
    lowPrice,
    gapAmount,
    gapPercent,
    currentChangePercent,
    dayChangeFromOpenPercent,
    direction,
    classification,
    setupType,
    fillStatus,
    fillPercent,
    volume,
    relativeVolume,
    tradeLevels,
    riskRating,
    isExtendedGap,
    analysisSummary: summary,
  };
}

export function generateGapScreenSummary(items: GapItem[]): GapScreenSummary {
  const validGaps = items.filter(i => i.direction !== 'FLAT');
  const gapUps = items.filter(i => i.direction === 'GAP_UP');
  const gapDowns = items.filter(i => i.direction === 'GAP_DOWN');
  const filled = validGaps.filter(i => i.fillStatus === 'FILLED');
  const unfilled = validGaps.filter(i => i.fillStatus === 'UNFILLED');

  let avgGap = 0;
  if (validGaps.length > 0) {
    avgGap =
      Math.round(
        (validGaps.reduce((acc, curr) => acc + Math.abs(curr.gapPercent), 0) / validGaps.length) * 100
      ) / 100;
  }

  let maxUp: { symbol: string; percent: number } | null = null;
  if (gapUps.length > 0) {
    const top = gapUps.reduce((prev, curr) => (curr.gapPercent > prev.gapPercent ? curr : prev));
    maxUp = { symbol: top.symbol, percent: top.gapPercent };
  }

  let maxDown: { symbol: string; percent: number } | null = null;
  if (gapDowns.length > 0) {
    const lowest = gapDowns.reduce((prev, curr) =>
      curr.gapPercent < prev.gapPercent ? curr : prev
    );
    maxDown = { symbol: lowest.symbol, percent: lowest.gapPercent };
  }

  const gapAndGo = items.filter(i => i.setupType === 'GAP_AND_GO');
  const gapFade = items.filter(i => i.setupType === 'GAP_FADE');

  return {
    totalScanned: items.length,
    totalGaps: validGaps.length,
    gapUpCount: gapUps.length,
    gapDownCount: gapDowns.length,
    filledCount: filled.length,
    unfilledCount: unfilled.length,
    avgGapPercent: avgGap,
    maxGapUp: maxUp,
    maxGapDown: maxDown,
    gapAndGoCount: gapAndGo.length,
    gapFadeCount: gapFade.length,
    lastUpdated: new Date().toISOString(),
  };
}

export async function scanMarketGaps(): Promise<{
  summary: GapScreenSummary;
  items: GapItem[];
  coverage: {evaluated:number;total:number};
  source: GapScanSource | null;
}> {
  const universe = Object.keys(TICKER_NAMES)
    .map(ticker => ({ ticker, providerSymbol: stockSymbol(ticker) }))
    .filter((entry): entry is { ticker: string; providerSymbol: string } => entry.providerSymbol !== null && entry.providerSymbol.endsWith('.NS'));
  const quotes = await fetchStockQuotes(universe.map(entry => entry.providerSymbol));
  const observations = quotes.flatMap((quote, index) => {
    if (!quote || !isProviderStock(quote) || !quote.quoteAsOf || typeof quote.previousClose !== 'number' || quote.previousClose <= 0) return [];
    const sessionDate = indiaDay(new Date(quote.quoteAsOf));
    const history = quote.history as Array<{ date: string; price: number; open?: number; high?: number; low?: number; close?: number; volume?: number }>;
    const bar = history.findLast(row => indiaDay(new Date(row.date)) === sessionDate);
    if (!bar || typeof bar.open !== 'number' || typeof bar.high !== 'number' || typeof bar.low !== 'number' || typeof bar.volume !== 'number' || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.volume < 0 || bar.high < Math.max(bar.open, quote.currentPrice) || bar.low > Math.min(bar.open, quote.currentPrice)) return [];
    return [{ quote, history, bar: { date: bar.date, open: bar.open, high: bar.high, low: bar.low, volume: bar.volume }, previousClose: quote.previousClose, sessionDate, ticker: universe[index].ticker }];
  });

  const dateCounts = new Map<string, number>();
  for (const observation of observations) dateCounts.set(observation.sessionDate, (dateCounts.get(observation.sessionDate) ?? 0) + 1);
  const sessionDate = [...dateCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  const sessionObservations = sessionDate ? observations.filter(observation => observation.sessionDate === sessionDate) : [];
  const items: GapItem[] = [];
  for (const { quote, history, bar, previousClose, ticker } of sessionObservations) {
    const priorVolumes = history
      .filter(row => indiaDay(new Date(row.date)) < sessionDate!)
      .slice(-20)
      .map(row => row.volume)
      .filter((volume): volume is number => typeof volume === 'number' && Number.isFinite(volume) && volume > 0);
    const avgVolume = priorVolumes.length >= 10
      ? priorVolumes.reduce((sum, volume) => sum + volume, 0) / priorVolumes.length
      : undefined;
    const gap = processStockGap({
      ticker: quote.ticker || ticker,
      symbol: ticker.replace(/\.NS$|\.BO$/, ''),
      name: quote.name || TICKER_NAMES[ticker] || ticker,
      sector: quote.sector || 'Equities',
      previousClose,
      openPrice: bar.open,
      currentPrice: quote.currentPrice,
      highPrice: bar.high,
      lowPrice: bar.low,
      volume: bar.volume,
      avgVolume,
    });

    if (gap && Math.abs(gap.gapPercent) >= 0.2) {
      items.push(gap);
    }
  }

  // Sort by gap absolute magnitude descending
  items.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));

  const summary = generateGapScreenSummary(items);
  summary.totalScanned = sessionObservations.length;
  const quoteTimes = sessionObservations.map(row => row.quote.quoteAsOf!).sort();
  const source: GapScanSource | null = sessionDate && quoteTimes.length ? {
    dataSource: 'provider',
    provider: 'Yahoo Finance chart',
    sessionDate,
    quoteAsOf: quoteTimes[0],
    latestQuoteAsOf: quoteTimes[quoteTimes.length - 1],
    evaluated: sessionObservations.length,
    total: universe.length,
  } : null;
  return { summary, items, coverage: { evaluated: sessionObservations.length, total: universe.length }, source };
}
