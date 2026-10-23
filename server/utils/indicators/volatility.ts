/**
 * VOLATILITY INDICATORS SUITE (VOLATILITY PROTOCOL)
 * 
 * DESIGN PROTOCOL:
 * Implements indicators designed to measure price fluctuations, dispersion, and risk.
 * This includes Bollinger Bands and the Average True Range (ATR).
 */

import { HistoricalPrice } from '@/lib/stock-data';
import { calculateSMA } from './trend';

/**
 * 1. BOLLINGER BANDS (BB)
 * Math in Plain English:
 * Bollinger Bands outline standard volatility boundaries.
 *   - Middle Band: 20-day Simple Moving Average (SMA).
 *   - Upper Band: Middle Band + (2 * Standard Deviation of closing prices).
 *   - Lower Band: Middle Band - (2 * Standard Deviation of closing prices).
 * Over 95% of price action mathematically resides within these bands.
 *   - Price <= Lower Band: Oversold, high chance of buying bounce support (Bullish)
 *   - Price >= Upper Band: Overbought, high chance of distribution resistance (Bearish)
 */
export function calculateBollingerBands(prices: number[], period = 20, multiplier = 2): {
  upper: number;
  middle: number;
  lower: number;
}[] {
  const bb: { upper: number; middle: number; lower: number }[] = [];
  const sma20 = calculateSMA(prices, period);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      // Sizing fallback
      bb.push({
        upper: Number((prices[i] * 1.05).toFixed(2)),
        middle: prices[i],
        lower: Number((prices[i] * 0.95).toFixed(2)),
      });
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const avg = sma20[i];
      const sumOfSquares = slice.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0);
      const stdDev = Math.sqrt(sumOfSquares / period);
      
      const upper = Number((avg + multiplier * stdDev).toFixed(2));
      const middle = Number(avg.toFixed(2));
      const lower = Number((avg - multiplier * stdDev).toFixed(2));
      
      bb.push({ upper, middle, lower });
    }
  }
  return bb;
}

export function evaluateBollingerBands(prices: number[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  upper: number;
  middle: number;
  lower: number;
  details: string;
} {
  const bandsHistory = calculateBollingerBands(prices, 20, 2);
  const lastIndex = prices.length - 1;
  const currentPrice = prices[lastIndex];
  const currentBands = bandsHistory[lastIndex];
  
  const { upper, middle, lower } = currentBands;
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  // 1% threshold near boundaries
  const touchLowerThreshold = lower * 1.01;
  const touchUpperThreshold = upper * 0.99;
  
  if (currentPrice <= touchLowerThreshold) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (currentPrice >= touchUpperThreshold) {
    signal = 'BEARISH';
    score = -1.0;
  } else {
    signal = 'NEUTRAL';
    // Normalized position inside bands: (price - lower) / (upper - lower)
    const bandWidth = upper - lower;
    const pct = bandWidth === 0 ? 0.5 : (currentPrice - lower) / bandWidth;
    score = (0.5 - pct) * 0.5; // slight buy force if below middle, slight sell force if above
  }
  
  const details = `Price is trading at $${currentPrice.toFixed(2)} relative to its 20-day Bollinger Bands (Upper: $${upper.toFixed(2)}, Middle: $${middle.toFixed(2)}, Lower: $${lower.toFixed(2)}). This places the asset in a ${signal.toLowerCase()} zone, matching its volatility boundary.`;
  
  return { signal, score, upper, middle, lower, details };
}

/**
 * 2. AVERAGE TRUE RANGE (ATR)
 * Math in Plain English:
 * ATR measures the technical volatility of an asset by looking at the largest of three spreads:
 *   - Today's High minus Today's Low
 *   - Absolute value of Today's High minus Yesterday's Close
 *   - Absolute value of Today's Low minus Yesterday's Close
 * Smooth these daily True Ranges over 14 days.
 * A rising ATR relative to price signals high risk / volatility, while a declining ATR indicates stable price action.
 */
export function calculateATR(history: HistoricalPrice[], period = 14): number[] {
  const atr: number[] = [];
  if (history.length <= 1) return [0];
  
  const tr: number[] = [];
  
  for (let i = 1; i < history.length; i++) {
    const today = history[i];
    const yesterday = history[i - 1];
    
    const tr1 = today.high - today.low;
    const tr2 = Math.abs(today.high - yesterday.close);
    const tr3 = Math.abs(today.low - yesterday.close);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  // Smooth TR using Wilder's EMA equivalent formula
  let currentAtr = tr.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  atr.push(currentAtr);
  
  // Pad the first N items with the initial value
  const padding = Array(period).fill(currentAtr);
  
  for (let i = period; i < tr.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr.push(Number(currentAtr.toFixed(2)));
  }
  
  return [...padding, ...atr];
}

export function evaluateATR(history: HistoricalPrice[]): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  atrVal: number;
  volatilityPercentage: number;
  details: string;
} {
  const atrHistory = calculateATR(history, 14);
  const atrVal = atrHistory[atrHistory.length - 1];
  const lastPrice = history[history.length - 1].close;
  
  // Express ATR as a percentage of price to normalize risk across different asset pricing levels
  const volatilityPercentage = Number(((atrVal / lastPrice) * 100).toFixed(2));
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  // Volatility evaluation: High volatility (> 4.0%) signals high risk (slightly bearish for conservative portfolios),
  // whereas low volatility (< 1.5%) signals range stability.
  if (volatilityPercentage > 3.5) {
    signal = 'BEARISH'; // higher downward risk coefficient
    score = -0.3; 
  } else if (volatilityPercentage < 1.5) {
    signal = 'BULLISH'; // stable accumulation potential
    score = 0.3;
  } else {
    signal = 'NEUTRAL';
    score = 0;
  }
  
  const details = `Average True Range (ATR-14) is $${atrVal.toFixed(2)}, which constitutes ${volatilityPercentage.toFixed(2)}% of the closing price. This reflects ${volatilityPercentage > 3.5 ? 'elevated' : volatilityPercentage < 1.5 ? 'compressed' : 'moderate'} trading risk.`;
  
  return { signal, score, atrVal, volatilityPercentage, details };
}
