/**
 * MULTI-CATEGORY WEIGHTED COMPOSITE ENGINE
 * 
 * DESIGN PROTOCOL:
 * Orchestrates multi-indicator queries, weights their signal inputs (+1 to -1),
 * normalizes the result, and returns a robust transparent Buy/Hold/Sell decision.
 */

import { HistoricalPrice } from '@/lib/stock-data';
import { DEFAULT_INDICATOR_WEIGHTS, DEFAULT_THRESHOLDS, IndicatorWeights } from './config';
import { evaluateSMACrossover, evaluateMACD, evaluateADX, calculateEMA } from './trend';
import { evaluateRSI, evaluateStochastic, evaluateRateOfChange } from './momentum';
import { evaluateBollingerBands, evaluateATR } from './volatility';
import { evaluateOBV, evaluateMFI } from './volume';
import { evaluatePERatio, evaluateDebtToEquity, evaluateDividendYield, evaluateRevenueGrowth } from './fundamentals';

export interface IndicatorScorePayload {
  name: string;
  category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Fundamentals';
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // raw value (-1 to +1)
  weight: number;
  weightedScore: number;
  details: string;
}

export interface EngineResult {
  action: 'BUY' | 'HOLD' | 'SELL';
  confidence: number; // 0 to 100%
  compositeScore: number; // normalized score (-1 to +1)
  breakdown: IndicatorScorePayload[];
  categoryScores: Record<string, number>;
  reasoning: string;
}

/**
 * Executes all indicators and weights them according to configuration.
 */
export function calculateCompositeSuggestion(
  ticker: string,
  history: HistoricalPrice[],
  fundamentals: {
    peRatio: number;
    sector: string;
    debtToEquity: number;
    dividendYield: number;
    revenueGrowth: number;
  },
  customWeights: Partial<IndicatorWeights> = {}
): EngineResult {
  const weights = { ...DEFAULT_INDICATOR_WEIGHTS, ...customWeights };
  const closePrices = history.map(h => h.close);
  const lastPrice = closePrices[closePrices.length - 1];
  
  // 1. Calculate and evaluate Trend Indicators
  const smaCrossover = evaluateSMACrossover(closePrices);
  const macd = evaluateMACD(closePrices);
  const adx = evaluateADX(history);
  
  // Custom EMA trend check (is price above 20-day EMA?)
  const ema20 = calculateEMA(closePrices, 20);
  const lastEma20 = ema20[ema20.length - 1] || lastPrice;
  const isAboveEma = lastPrice > lastEma20;
  const emaTrendScore = isAboveEma ? 1.0 : -1.0;
  const emaTrendDetails = isAboveEma 
    ? `Price ($${lastPrice.toFixed(2)}) is trading above the 20-day EMA ($${lastEma20.toFixed(2)}), validating immediate technical trend safety.`
    : `Price ($${lastPrice.toFixed(2)}) is trading below the 20-day EMA ($${lastEma20.toFixed(2)}), alerting of a short-term correction risk.`;

  // 2. Calculate and evaluate Momentum Indicators
  const rsi = evaluateRSI(closePrices);
  const stochastic = evaluateStochastic(history);
  const roc = evaluateRateOfChange(closePrices);

  // 3. Calculate and evaluate Volatility Indicators
  const bb = evaluateBollingerBands(closePrices);
  const atr = evaluateATR(history);

  // 4. Calculate and evaluate Volume Indicators
  const obv = evaluateOBV(history);
  const mfi = evaluateMFI(history);

  // 5. Calculate and evaluate Fundamental Indicators
  const pe = evaluatePERatio(fundamentals.peRatio, fundamentals.sector);
  const de = evaluateDebtToEquity(fundamentals.debtToEquity);
  const div = evaluateDividendYield(fundamentals.dividendYield);
  const rev = evaluateRevenueGrowth(fundamentals.revenueGrowth);

  // Collect all indicator score payloads
  const rawBreakdown: Omit<IndicatorScorePayload, 'weightedScore'>[] = [
    // Trend
    {
      name: 'SMA Crossover (20 vs 50)',
      category: 'Trend',
      signal: smaCrossover.signal,
      score: smaCrossover.score,
      weight: weights.smaCrossover,
      details: smaCrossover.details,
    },
    {
      name: 'MACD (12, 26, 9)',
      category: 'Trend',
      signal: macd.signal,
      score: macd.score,
      weight: weights.macdSignal,
      details: macd.details,
    },
    {
      name: 'EMA-20 Trend Alignment',
      category: 'Trend',
      signal: isAboveEma ? 'BULLISH' : 'BEARISH',
      score: emaTrendScore,
      weight: weights.emaTrend,
      details: emaTrendDetails,
    },
    {
      name: 'ADX Trend Strength',
      category: 'Trend',
      signal: adx.signal,
      score: adx.score,
      weight: weights.adxStrength,
      details: adx.details,
    },
    // Momentum
    {
      name: 'RSI-14 Momentum Oscillator',
      category: 'Momentum',
      signal: rsi.signal,
      score: rsi.score,
      weight: weights.rsi14,
      details: rsi.details,
    },
    {
      name: 'Stochastic Oscillator (%K vs %D)',
      category: 'Momentum',
      signal: stochastic.signal,
      score: stochastic.score,
      weight: weights.stochastic,
      details: stochastic.details,
    },
    {
      name: 'Price Rate of Change (ROC-12)',
      category: 'Momentum',
      signal: roc.signal,
      score: roc.score,
      weight: weights.rateOfChange,
      details: roc.details,
    },
    // Volatility
    {
      name: 'Bollinger Bands Envelopes',
      category: 'Volatility',
      signal: bb.signal,
      score: bb.score,
      weight: weights.bollingerBands,
      details: bb.details,
    },
    {
      name: 'Average True Range (ATR-14)',
      category: 'Volatility',
      signal: atr.signal,
      score: atr.score,
      weight: weights.atrRisk,
      details: atr.details,
    },
    // Volume
    {
      name: 'On-Balance Volume (OBV)',
      category: 'Volume',
      signal: obv.signal,
      score: obv.score,
      weight: weights.obvTrend,
      details: obv.details,
    },
    {
      name: 'Money Flow Index (MFI-14)',
      category: 'Volume',
      signal: mfi.signal,
      score: mfi.score,
      weight: weights.mfi14,
      details: mfi.details,
    },
    // Fundamentals
    {
      name: 'P/E Valuation Multiples',
      category: 'Fundamentals',
      signal: pe.signal,
      score: pe.score,
      weight: weights.peRatioVal,
      details: pe.details,
    },
    {
      name: 'Debt-to-Equity Leverage Ratio',
      category: 'Fundamentals',
      signal: de.signal,
      score: de.score,
      weight: weights.debtToEquityVal,
      details: de.details,
    },
    {
      name: 'Dividend Income Yield Floor',
      category: 'Fundamentals',
      signal: div.signal,
      score: div.score,
      weight: weights.dividendYieldVal,
      details: div.details,
    },
    {
      name: 'Year-over-Year Revenue Growth',
      category: 'Fundamentals',
      signal: rev.signal,
      score: rev.score,
      weight: weights.revenueGrowthVal,
      details: rev.details,
    },
  ];

  // Calculate Weighted Composite Score
  let totalWeight = 0;
  let sumWeightedScores = 0;
  
  const categoryWeightedSum: Record<string, number> = { Trend: 0, Momentum: 0, Volatility: 0, Volume: 0, Fundamentals: 0 };
  const categoryTotalWeights: Record<string, number> = { Trend: 0, Momentum: 0, Volatility: 0, Volume: 0, Fundamentals: 0 };

  const breakdown: IndicatorScorePayload[] = rawBreakdown.map(ind => {
    const weightedScore = ind.score * ind.weight;
    totalWeight += ind.weight;
    sumWeightedScores += weightedScore;
    
    categoryWeightedSum[ind.category] += weightedScore;
    categoryTotalWeights[ind.category] += ind.weight;

    return {
      ...ind,
      weightedScore: Number(weightedScore.toFixed(3))
    };
  });

  const normalizedCompositeScore = Number((sumWeightedScores / totalWeight).toFixed(4)); // scales between -1.0 and +1.0

  // Calculate clean normalized scores for each category (scaled -100 to +100 or -1.0 to +1.0)
  const categoryScores: Record<string, number> = {};
  Object.keys(categoryWeightedSum).forEach(cat => {
    const totalW = categoryTotalWeights[cat];
    categoryScores[cat] = totalW === 0 ? 0 : Number((categoryWeightedSum[cat] / totalW).toFixed(4));
  });

  // Evaluate final suggestion action based on configured thresholds
  let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD';
  let confidence = 50;
  
  if (normalizedCompositeScore >= DEFAULT_THRESHOLDS.buyThreshold) {
    action = 'BUY';
    // Map score [buyThreshold, 1.0] to [60%, 98%] confidence
    const range = 1.0 - DEFAULT_THRESHOLDS.buyThreshold;
    const progress = (normalizedCompositeScore - DEFAULT_THRESHOLDS.buyThreshold) / range;
    confidence = Math.min(98, Math.round(60 + progress * 38));
  } else if (normalizedCompositeScore <= DEFAULT_THRESHOLDS.sellThreshold) {
    action = 'SELL';
    // Map score [-1.0, sellThreshold] to [60%, 98%] confidence
    const range = Math.abs(-1.0 - DEFAULT_THRESHOLDS.sellThreshold);
    const progress = (DEFAULT_THRESHOLDS.sellThreshold - normalizedCompositeScore) / range;
    confidence = Math.min(98, Math.round(60 + progress * 38));
  } else {
    action = 'HOLD';
    // Hold confidence is higher when closer to exact 0.0 midpoint (perfect neutrality/consolidation)
    const absoluteDist = Math.abs(normalizedCompositeScore);
    const maxDist = DEFAULT_THRESHOLDS.buyThreshold;
    const progress = (maxDist - absoluteDist) / maxDist; // 1.0 at center, 0.0 at borders
    confidence = Math.min(90, Math.round(50 + progress * 35));
  }

  // Generate quantitative synthesis reasoning string
  const activeBullish = breakdown.filter(b => b.signal === 'BULLISH' && b.score > 0);
  const activeBearish = breakdown.filter(b => b.signal === 'BEARISH' && b.score < 0);
  
  let reasoning = '';
  if (action === 'BUY') {
    reasoning = `Strong institutional accumulation detected with a net bullish composite coefficient of +${normalizedCompositeScore.toFixed(2)}. Out of 15 parameters, ${activeBullish.length} indicators have triggered green flags. Major contributors: ${activeBullish.slice(0, 3).map(b => b.name).join(', ')}. Overall, trend alignment and valuation metrics recommend scaling in.`;
  } else if (action === 'SELL') {
    reasoning = `Widespread distribution pressure detected with a net bearish composite coefficient of ${normalizedCompositeScore.toFixed(2)}. A total of ${activeBearish.length} warning indicators are currently active. Key warning triggers: ${activeBearish.slice(0, 3).map(b => b.name).join(', ')}. System recommends hedging risk or exiting long-positions.`;
  } else {
    reasoning = `Asset is consolidating inside a stable equilibrium channel (composite index: ${normalizedCompositeScore.toFixed(2)}). Indicators are offsetting: trend patterns show baseline support, while momentum structures remain capped by resistance envelopes. Recommend a neutral HOLD strategy while accumulation structures solidify.`;
  }

  return {
    action,
    confidence,
    compositeScore: normalizedCompositeScore,
    breakdown,
    categoryScores,
    reasoning,
  };
}
