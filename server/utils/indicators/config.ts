/**
 * MULTI-CATEGORY TECHNICAL & FUNDAMENTAL INDICATOR CONFIGURATION
 * 
 * DESIGN PROTOCOL:
 * Provides clean, fully configurable weights for every technical and fundamental indicator,
 * divided into five logical classes (Trend, Momentum, Volatility, Volume, and Fundamentals).
 * 
 * Math in Plain English:
 * We assign a default numeric weight to each individual indicator. In the composite scoring engine,
 * we evaluate each indicator to output a signal coefficient:
 *   - +1.0 for Bullish (Strong buying signal / undervalued / uptrend)
 *   - -1.0 for Bearish (Strong selling signal / overvalued / downtrend)
 *   -  0.0 for Neutral (Consolidating / fair value / range-bound)
 * 
 * The composite score is computed as:
 *   CompositeScore = Sum(Signal_i * Weight_i) / Sum(Weight_i)
 * 
 * This normalizes the result cleanly to a percentage-like confidence scale, where positive scores
 * align with BUY indicators, negative scores with SELL, and near-zero scores with HOLD.
 */

export interface IndicatorWeights {
  // --- TREND INDICATORS (Total Target ~30%) ---
  smaCrossover: number; // Fast/Slow SMA alignment (Weight: 3.0)
  macdSignal: number;   // MACD Line crossing Signal Line (Weight: 3.0)
  emaTrend: number;     // Current price relative to 20-day EMA (Weight: 2.0)
  adxStrength: number;  // ADX Trend strength confirmation (Weight: 1.0)

  // --- MOMENTUM INDICATORS (Total Target ~30%) ---
  rsi14: number;        // RSI-14 overbought (>70) or oversold (<30) (Weight: 3.5)
  stochastic: number;   // Stochastic %K / %D crossing in extremes (Weight: 2.5)
  rateOfChange: number; // ROC velocity signal (Weight: 2.0)

  // --- VOLATILITY INDICATORS (Total Target ~15%) ---
  bollingerBands: number; // Price touching upper/lower band envelopes (Weight: 2.5)
  atrRisk: number;        // ATR volatility scaling filter (Weight: 1.5)

  // --- VOLUME INDICATORS (Total Target ~15%) ---
  obvTrend: number;     // On-Balance Volume trend correlation (Weight: 2.0)
  mfi14: number;        // Money Flow Index (Volume-weighted RSI) (Weight: 2.0)

  // --- FUNDAMENTAL INDICATORS (Total Target ~10%) ---
  peRatioVal: number;     // Price-to-Earnings compared to sector baseline (Weight: 1.0)
  debtToEquityVal: number;// Debt Leverage ratio safety (Weight: 1.0)
  dividendYieldVal: number;// Income buffer yielding (Weight: 0.5)
  revenueGrowthVal: number;// YoY Growth acceleration (Weight: 1.5)
}

export interface SuggestionThresholds {
  buyThreshold: number;  // Normalised score above which we issue a BUY signal (e.g. +0.20)
  sellThreshold: number; // Normalised score below which we issue a SELL signal (e.g. -0.20)
}

// Default system configurations designed for high predictive reliability and balanced signals.
export const DEFAULT_INDICATOR_WEIGHTS: IndicatorWeights = {
  smaCrossover: 3.0,
  macdSignal: 3.0,
  emaTrend: 2.0,
  adxStrength: 1.0,
  
  rsi14: 3.5,
  stochastic: 2.5,
  rateOfChange: 2.0,
  
  bollingerBands: 2.5,
  atrRisk: 1.5,
  
  obvTrend: 2.0,
  mfi14: 2.0,
  
  peRatioVal: 1.0,
  debtToEquityVal: 1.0,
  dividendYieldVal: 0.5,
  revenueGrowthVal: 1.5,
};

export const DEFAULT_THRESHOLDS: SuggestionThresholds = {
  buyThreshold: 0.22,   // Represents at least ~22% net bullish consensus among indicator weights
  sellThreshold: -0.22, // Represents at least ~22% net bearish consensus among indicator weights
};
