/**
 * MOMENTUM INDICATORS SUITE (MOMENTUM PROTOCOL)
 * 
 * DESIGN PROTOCOL:
 * Implements indicators designed to measure the rate of change or velocity of price movements.
 * This includes the Relative Strength Index (RSI), Stochastic Oscillator, and price Rate of Change (ROC).
 */

import { HistoricalPrice } from '@/lib/stock-data';

/**
 * 1. RELATIVE STRENGTH INDEX (RSI)
 * Math in Plain English:
 * RSI evaluates momentum by comparing the size of recent stock gains to recent stock losses.
 * It maps this on a scale from 0 to 100.
 *   - RSI < 30: Oversold (Seller fatigue, high chance of a bullish bounce)
 *   - RSI > 70: Overbought (Buyer exhaustion, high chance of a bearish pullback)
 *   - 30 to 70: Neutral consolidation
 */
export function calculateRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = [];
  if (prices.length <= period) {
    return Array(prices.length).fill(50);
  }
  
  let gains = 0;
  let losses = 0;
  
  // Compute initial average gain and loss
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      gains += diff;
    } else {
      losses -= diff;
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // First RSI point
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  
  // Pad the first N items with the initial value for index correspondence
  const padding = Array(period).fill(rsi[0]);
  
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    // Wilder's smoothing method
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(Number((100 - 100 / (1 + rs)).toFixed(2)));
    }
  }
  
  return [...padding, ...rsi];
}

export function evaluateRSI(prices: number[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // -1 to +1
  value: number;
  details: string;
} {
  const rsiHistory = calculateRSI(prices, 14);
  const value = rsiHistory[rsiHistory.length - 1];
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  let details = '';
  
  if (value < 30) {
    signal = 'BULLISH';
    // Scaling score so deeply oversold scores closer to +1.0
    score = 1.0 + (30 - value) * 0.05;
    score = Math.min(1.5, score); // cap at 1.5 for extreme levels
    details = `RSI-14 indicates oversold status at ${value.toFixed(1)} (< 30). This suggests deep seller exhaustion and represents a high-probability technical accumulation zone.`;
  } else if (value > 70) {
    signal = 'BEARISH';
    score = -1.0 - (value - 70) * 0.05;
    score = Math.max(-1.5, score); // cap at -1.5 for extreme levels
    details = `RSI-14 indicates overbought conditions at ${value.toFixed(1)} (> 70). The asset is technically overextended, flashing high pullback and profit-taking risk.`;
  } else {
    signal = 'NEUTRAL';
    // Slight bias depending on relative position to 50 midpoint
    score = value >= 50 ? 0.25 : -0.25;
    details = `RSI-14 is neutral at ${value.toFixed(1)}, showing balanced momentum without extreme buying or selling pressure. Mid-range consolidation is active.`;
  }
  
  return { signal, score, value, details };
}

/**
 * 2. STOCHASTIC OSCILLATOR
 * Math in Plain English:
 * Stochastic compares where a security's price closed relative to its price range over N days (usually 14).
 *   - Fast %K = 100 * (Close - Lowest Low) / (Highest High - Lowest Low)
 *   - Slow %D = 3-day Simple Moving Average of %K
 * If %K and %D are both below 20 and cross upward, it signals a strong BUY.
 * If both are above 80 and cross downward, it warns of a SELL.
 */
export function evaluateStochastic(history: HistoricalPrice[], period = 14): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  percentK: number;
  percentD: number;
  details: string;
} {
  if (history.length < period + 3) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      percentK: 50,
      percentD: 50,
      details: 'Insufficient history for Stochastic Oscillator calculation.'
    };
  }
  
  const kHistory: number[] = [];
  
  for (let i = period - 1; i < history.length; i++) {
    const slice = history.slice(i - period + 1, i + 1);
    const close = history[i].close;
    
    const lows = slice.map(h => h.low);
    const highs = slice.map(h => h.high);
    
    const lowestLow = Math.min(...lows);
    const highestHigh = Math.max(...highs);
    
    const denom = highestHigh - lowestLow;
    const k = denom === 0 ? 50 : 100 * ((close - lowestLow) / denom);
    kHistory.push(k);
  }
  
  // Calculate %D (3-day average of %K)
  const dHistory: number[] = [];
  for (let i = 2; i < kHistory.length; i++) {
    const sum = kHistory[i] + kHistory[i - 1] + kHistory[i - 2];
    dHistory.push(sum / 3);
  }
  
  const percentK = Number(kHistory[kHistory.length - 1].toFixed(2));
  const percentD = Number(dHistory[dHistory.length - 1].toFixed(2));
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  let details = '';
  
  if (percentK < 20 && percentD < 20) {
    signal = 'BULLISH';
    score = 1.0;
    details = `Stochastic Oscillator represents an oversold state: %K (${percentK.toFixed(1)}) and %D (${percentD.toFixed(1)}) reside below the 20 threshold, signaling solid accumulation potential.`;
  } else if (percentK > 80 && percentD > 80) {
    signal = 'BEARISH';
    score = -1.0;
    details = `Stochastic Oscillator warning: %K (${percentK.toFixed(1)}) and %D (${percentD.toFixed(1)}) reside above the 80 threshold, signaling overbought danger.`;
  } else {
    // Check for crossovers
    const prevK = kHistory[kHistory.length - 2];
    const prevD = dHistory[dHistory.length - 2];
    const currentK = percentK;
    const currentD = percentD;
    
    if (prevK <= prevD && currentK > currentD) {
      signal = 'BULLISH';
      score = 0.5;
      details = `Stochastic Bullish Crossover: %K (${currentK.toFixed(1)}) crossed above its %D line (${currentD.toFixed(1)}), highlighting positive short-term momentum shift.`;
    } else if (prevK >= prevD && currentK < currentD) {
      signal = 'BEARISH';
      score = -0.5;
      details = `Stochastic Bearish Crossover: %K (${currentK.toFixed(1)}) fell below its %D line (${currentD.toFixed(1)}), signaling short-term selling acceleration.`;
    } else {
      signal = 'NEUTRAL';
      score = 0;
      details = `Stochastic is neutral with %K at ${percentK.toFixed(1)} and %D at ${percentD.toFixed(1)}, showing steady range trading.`;
    }
  }
  
  return { signal, score, percentK, percentD, details };
}

/**
 * 3. RATE OF CHANGE (ROC)
 * Math in Plain English:
 * ROC measures the percentage change in price between the current price and the price N days ago.
 * It is a pure speed-of-price indicator.
 *   - Rising ROC above 0: Price is ascending with acceleration (Bullish)
 *   - Falling ROC below 0: Price is descending with acceleration (Bearish)
 */
export function evaluateRateOfChange(prices: number[], period = 12): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  rocVal: number;
  details: string;
} {
  if (prices.length < period + 1) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      rocVal: 0,
      details: 'Insufficient history for Rate of Change calculation.'
    };
  }
  
  const current = prices[prices.length - 1];
  const prior = prices[prices.length - 1 - period];
  
  const rocVal = Number((((current - prior) / prior) * 100).toFixed(2));
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (rocVal > 2.0) {
    signal = 'BULLISH';
    score = 0.8;
  } else if (rocVal < -2.0) {
    signal = 'BEARISH';
    score = -0.8;
  } else {
    signal = 'NEUTRAL';
    score = rocVal / 5.0; // scales naturally between -0.4 and +0.4
  }
  
  const details = `Rate of Change (ROC-12) stands at ${rocVal.toFixed(2)}%, showing that price momentum over the last 12 sessions is currently ${rocVal >= 0 ? 'expanding upward' : 'contracting downward'}.`;
  
  return { signal, score, rocVal, details };
}
