/**
 * VOLUME INDICATORS SUITE (VOLUME PROTOCOL)
 * 
 * DESIGN PROTOCOL:
 * Implements indicators designed to capture trading volume pressure to confirm price actions.
 * This includes On-Balance Volume (OBV) and the Money Flow Index (MFI).
 */

import { HistoricalPrice } from '@/lib/stock-data';

/**
 * 1. ON-BALANCE VOLUME (OBV)
 * Math in Plain English:
 * OBV is a running total of volume that is added or subtracted depending on the day's direction:
 *   - Today's close > Yesterday's close: OBV = OBV_yesterday + Volume_today (Buying volume accumulation)
 *   - Today's close < Yesterday's close: OBV = OBV_yesterday - Volume_today (Selling volume distribution)
 * Compare OBV to its own 20-day moving average.
 *   - OBV above 20-day MA: Buying pressure is rising (Bullish)
 *   - OBV below 20-day MA: Selling pressure is rising (Bearish)
 */
export function calculateOBV(history: HistoricalPrice[]): number[] {
  const obv: number[] = [0];
  if (history.length === 0) return obv;
  
  let currentObv = 0;
  
  for (let i = 1; i < history.length; i++) {
    const today = history[i];
    const yesterday = history[i - 1];
    
    if (today.close > yesterday.close) {
      currentObv += today.volume;
    } else if (today.close < yesterday.close) {
      currentObv -= today.volume;
    }
    obv.push(currentObv);
  }
  
  return obv;
}

export function evaluateOBV(history: HistoricalPrice[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  obvVal: number;
  details: string;
} {
  const obvHistory = calculateOBV(history);
  const lastObv = obvHistory[obvHistory.length - 1];
  
  if (obvHistory.length < 20) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      obvVal: lastObv,
      details: 'Insufficient history for On-Balance Volume smoothing analysis.'
    };
  }
  
  // Calculate a 20-day average of OBV
  const last20 = obvHistory.slice(-20);
  const obvSma20 = last20.reduce((sum, val) => sum + val, 0) / 20;
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (lastObv > obvSma20) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (lastObv < obvSma20) {
    signal = 'BEARISH';
    score = -1.0;
  }
  
  const details = `On-Balance Volume is at ${lastObv.toLocaleString()} units, trading ${lastObv > obvSma20 ? 'ABOVE' : 'BELOW'} its 20-period volume moving average of ${Math.round(obvSma20).toLocaleString()}. This points to active volume ${lastObv > obvSma20 ? 'accumulation' : 'distribution'}.`;
  
  return { signal, score, obvVal: lastObv, details };
}

/**
 * 2. MONEY FLOW INDEX (MFI)
 * Math in Plain English:
 * MFI functions similarly to RSI, but integrates volume to measure how much cash is flowing
 * into or out of the security.
 *   - Typical Price = (High + Low + Close) / 3
 *   - Money Flow = Typical Price * Volume
 * Divide the 14-day sum of positive money flows by negative money flows to get the Money Ratio.
 *   - MFI = 100 - [100 / (1 + Money Ratio)]
 * Bounds:
 *   - MFI < 20: Oversold, deep buying support expected (Bullish)
 *   - MFI > 80: Overbought, deep selling pressure expected (Bearish)
 */
export function calculateMFI(history: HistoricalPrice[], period = 14): number[] {
  const mfi: number[] = [];
  if (history.length <= period) {
    return Array(history.length).fill(50);
  }
  
  const typicalPrices = history.map(h => (h.high + h.low + h.close) / 3);
  const moneyFlows = typicalPrices.map((tp, i) => tp * history[i].volume);
  
  // Create padding
  const padding = Array(period).fill(50);
  
  for (let i = period; i < history.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) {
        posFlow += moneyFlows[j];
      } else if (typicalPrices[j] < typicalPrices[j - 1]) {
        negFlow += moneyFlows[j];
      }
    }
    
    if (negFlow === 0) {
      mfi.push(100);
    } else {
      const moneyRatio = posFlow / negFlow;
      const indexVal = 100 - 100 / (1 + moneyRatio);
      mfi.push(Number(indexVal.toFixed(2)));
    }
  }
  
  return [...padding, ...mfi];
}

export function evaluateMFI(history: HistoricalPrice[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  mfiVal: number;
  details: string;
} {
  const mfiHistory = calculateMFI(history, 14);
  const mfiVal = mfiHistory[mfiHistory.length - 1];
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (mfiVal < 20) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (mfiVal > 80) {
    signal = 'BEARISH';
    score = -1.0;
  } else {
    signal = 'NEUTRAL';
    score = mfiVal >= 50 ? 0.2 : -0.2; // minor bias
  }
  
  const details = `Money Flow Index (MFI-14) stands at ${mfiVal.toFixed(1)} (scale 0-100). The volume-weighted money flow is currently in ${mfiVal < 20 ? 'critically oversold' : mfiVal > 80 ? 'critically overbought' : 'fairly balanced'} territory.`;
  
  return { signal, score, mfiVal, details };
}
