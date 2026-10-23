/**
 * TREND INDICATORS SUITE (TREND PROTOCOL)
 * 
 * DESIGN PROTOCOL:
 * Implements high-fidelity moving averages (SMA/EMA), Trend crossovers, MACD momentum, and
 * the ADX (Average Directional Index) indicator to determine general trend directions and strength.
 */

import { HistoricalPrice } from '@/lib/stock-data';

/**
 * 1. SIMPLE MOVING AVERAGE (SMA)
 * Math in Plain English:
 * Sum up the closing prices over the last N days and divide by N. This smooths out short-term
 * volatility to highlight the underlying medium or long-term direction of the asset.
 */
export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  if (prices.length === 0) return sma;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(prices[i]); // Fill initial values with corresponding price for sizing match
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((acc, p) => acc + p, 0);
      sma.push(Number((sum / period).toFixed(2)));
    }
  }
  return sma;
}

/**
 * 2. EXPONENTIAL MOVING AVERAGE (EMA)
 * Math in Plain English:
 * Unlike SMA, the EMA assigns a greater mathematical weight to the most recent price action.
 * This makes it much quicker to react to sudden trend reversals and short-term moves.
 * 
 * Formula:
 * Multiplier = 2 / (Period + 1)
 * EMA_today = Price_today * Multiplier + EMA_yesterday * (1 - Multiplier)
 */
export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;
  
  const k = 2 / (period + 1);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      ema.push(prices[i]);
    } else if (i === period - 1) {
      // First value is initialized with the standard SMA
      const sum = prices.slice(0, period).reduce((acc, p) => acc + p, 0);
      ema.push(Number((sum / period).toFixed(2)));
    } else {
      const val = prices[i] * k + ema[i - 1] * (1 - k);
      ema.push(Number(val.toFixed(2)));
    }
  }
  return ema;
}

/**
 * 3. SMA CROSSOVER DETECTOR (FAST vs SLOW)
 * Math in Plain English:
 * Compares a short-term trend line (20 SMA) with a medium-term trend line (50 SMA).
 *   - Fast above Slow (SMA20 > SMA50): Indicates accelerating uptrend (Bullish)
 *   - Fast below Slow (SMA20 < SMA50): Indicates correcting downtrend (Bearish)
 */
export function evaluateSMACrossover(prices: number[], fastPeriod = 20, slowPeriod = 50): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // -1 to +1
  details: string;
  smaFast: number;
  smaSlow: number;
} {
  const smaFastHistory = calculateSMA(prices, fastPeriod);
  const smaSlowHistory = calculateSMA(prices, slowPeriod);
  
  if (prices.length < slowPeriod) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      details: 'Insufficient history for SMA slow period calculation.',
      smaFast: prices[prices.length - 1] || 0,
      smaSlow: prices[prices.length - 1] || 0
    };
  }
  
  const smaFast = smaFastHistory[smaFastHistory.length - 1];
  const smaSlow = smaSlowHistory[smaSlowHistory.length - 1];
  
  const isBullish = smaFast > smaSlow;
  const marginPct = Math.abs((smaFast - smaSlow) / smaSlow) * 100;
  
  // Define strong vs weak crossover signals based on alignment spacing
  const signal = isBullish ? 'BULLISH' : 'BEARISH';
  const score = isBullish ? 1.0 : -1.0;
  const details = isBullish
    ? `Bullish alignment: ${fastPeriod}-day SMA ($${smaFast.toFixed(2)}) resides above the ${slowPeriod}-day SMA ($${smaSlow.toFixed(2)}) by +${marginPct.toFixed(2)}%, proving sustained upside momentum.`
    : `Bearish posture: ${fastPeriod}-day SMA ($${smaFast.toFixed(2)}) has dipped below the ${slowPeriod}-day SMA ($${smaSlow.toFixed(2)}) by -${marginPct.toFixed(2)}%, reflecting structural trend deterioration.`;
    
  return { signal, score, details, smaFast, smaSlow };
}

/**
 * 4. MOVING AVERAGE CONVERGENCE DIVERGENCE (MACD)
 * Math in Plain English:
 * Tracks momentum by subtracting the 26-period EMA from the 12-period EMA (creating the MACD Line).
 * Then, a 9-period EMA of the MACD Line is calculated (creating the Signal Line).
 *   - MACD above Signal (Histogram is positive): Upward price velocity is accelerating (Bullish)
 *   - MACD below Signal (Histogram is negative): Downward price velocity is accelerating (Bearish)
 */
export function evaluateMACD(prices: number[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // -1 to +1
  macdLine: number;
  signalLine: number;
  histogram: number;
  details: string;
} {
  if (prices.length < 26) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      macdLine: 0,
      signalLine: 0,
      histogram: 0,
      details: 'Insufficient price history for 26-day MACD calculation.'
    };
  }
  
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  const macdLines: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLines.push(ema12[i] - ema26[i]);
  }
  
  const signalLines = calculateEMA(macdLines, 9);
  
  const lastIndex = prices.length - 1;
  const macdLine = Number(macdLines[lastIndex].toFixed(3));
  const signalLine = Number(signalLines[lastIndex].toFixed(3));
  const histogram = Number((macdLine - signalLine).toFixed(3));
  
  const isBullish = macdLine > signalLine;
  const signal = isBullish ? 'BULLISH' : 'BEARISH';
  const score = isBullish ? 1.0 : -1.0;
  const details = isBullish
    ? `Bullish MACD crossover: MACD line ($${macdLine.toFixed(2)}) trades above its 9-day signal line ($${signalLine.toFixed(2)}). The positive histogram (${histogram.toFixed(2)}) confirms rising demand velocity.`
    : `Bearish MACD crossover: MACD line ($${macdLine.toFixed(2)}) resides below its 9-day signal line ($${signalLine.toFixed(2)}). The negative histogram (${histogram.toFixed(2)}) alerts of seller accumulation.`;
    
  return { signal, score, macdLine, signalLine, histogram, details };
}

/**
 * 5. AVERAGE DIRECTIONAL INDEX (ADX) & DIRECTIONAL MOVEMENT
 * Math in Plain English:
 * ADX measures the strength (not direction) of a trend on a scale from 0 to 100.
 * A value above 25 represents a strong trend, while values below 20 represent sideways trading.
 * We couple ADX with +DI (Plus Directional Indicator) and -DI (Minus Directional Indicator)
 * to determine both Trend Strength AND Trend Direction.
 */
export function evaluateADX(history: HistoricalPrice[], period = 14): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // -1 to +1
  adx: number;
  plusDI: number;
  minusDI: number;
  details: string;
} {
  if (history.length < period * 2) {
    return {
      signal: 'NEUTRAL',
      score: 0,
      adx: 15.0,
      plusDI: 15.0,
      minusDI: 15.0,
      details: 'ADX requires at least 28 days of high/low/close price history to establish standard smoothing.'
    };
  }
  
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  
  for (let i = 1; i < history.length; i++) {
    const today = history[i];
    const yesterday = history[i - 1];
    
    // True Range calculation
    const tr1 = today.high - today.low;
    const tr2 = Math.abs(today.high - yesterday.close);
    const tr3 = Math.abs(today.low - yesterday.close);
    tr.push(Math.max(tr1, tr2, tr3));
    
    // Directional Movement
    const dmPlus = today.high - yesterday.high;
    const dmMinus = yesterday.low - today.low;
    
    if (dmPlus > 0 && dmPlus > dmMinus) {
      plusDM.push(dmPlus);
    } else {
      plusDM.push(0);
    }
    
    if (dmMinus > 0 && dmMinus > dmPlus) {
      minusDM.push(dmMinus);
    } else {
      minusDM.push(0);
    }
  }
  
  // Smooth arrays using standard Wilder's smoothing (EMA-like)
  const smoothTR: number[] = [tr.slice(0, period).reduce((sum, val) => sum + val, 0)];
  const smoothPlusDM: number[] = [plusDM.slice(0, period).reduce((sum, val) => sum + val, 0)];
  const smoothMinusDM: number[] = [minusDM.slice(0, period).reduce((sum, val) => sum + val, 0)];
  
  for (let i = period; i < tr.length; i++) {
    smoothTR.push(smoothTR[smoothTR.length - 1] - (smoothTR[smoothTR.length - 1] / period) + tr[i]);
    smoothPlusDM.push(smoothPlusDM[smoothPlusDM.length - 1] - (smoothPlusDM[smoothPlusDM.length - 1] / period) + plusDM[i]);
    smoothMinusDM.push(smoothMinusDM[smoothMinusDM.length - 1] - (smoothMinusDM[smoothMinusDM.length - 1] / period) + minusDM[i]);
  }
  
  // Calculate +DI and -DI
  const dxList: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    const trVal = smoothTR[i];
    const diPlus = trVal === 0 ? 0 : 100 * (smoothPlusDM[i] / trVal);
    const diMinus = trVal === 0 ? 0 : 100 * (smoothMinusDM[i] / trVal);
    
    const diff = Math.abs(diPlus - diMinus);
    const sum = diPlus + diMinus;
    const dx = sum === 0 ? 0 : 100 * (diff / sum);
    dxList.push(dx);
  }
  
  // Smooth DX to obtain ADX
  const adxList: number[] = [dxList.slice(0, period).reduce((sum, val) => sum + val, 0) / period];
  for (let i = period; i < dxList.length; i++) {
    adxList.push((adxList[adxList.length - 1] * (period - 1) + dxList[i]) / period);
  }
  
  const finalIndex = adxList.length - 1;
  const adx = Number(adxList[finalIndex].toFixed(2));
  
  // Retrieve the final Smoothed DI+ and DI- values
  const trVal = smoothTR[smoothTR.length - 1];
  const plusDI = Number((trVal === 0 ? 0 : 100 * (smoothPlusDM[smoothPlusDM.length - 1] / trVal)).toFixed(2));
  const minusDI = Number((trVal === 0 ? 0 : 100 * (smoothMinusDM[smoothMinusDM.length - 1] / trVal)).toFixed(2));
  
  const isTrendStrong = adx >= 25;
  const isBullish = plusDI > minusDI;
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (isTrendStrong) {
    if (isBullish) {
      signal = 'BULLISH';
      score = 1.0; // Strong uptrend
    } else {
      signal = 'BEARISH';
      score = -1.0; // Strong downtrend
    }
  } else {
    // Weak or sideways trend
    signal = 'NEUTRAL';
    score = isBullish ? 0.2 : -0.2; // Minor bias
  }
  
  const details = `ADX Strength indicates ${isTrendStrong ? 'STRONG TRENDING' : 'WEAK/SIDEWAYS'} conditions at ${adx.toFixed(1)} (scale 0-100). The directional indicators (+DI: ${plusDI.toFixed(1)} vs -DI: ${minusDI.toFixed(1)}) demonstrate a ${isBullish ? 'bullish buyer dominance' : 'bearish seller dominance'}.`;
  
  return { signal, score, adx, plusDI, minusDI, details };
}
