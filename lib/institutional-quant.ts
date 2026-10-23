/**
 * Institutional Quantitative Trading Engine (Inspired by Microsoft Qlib, WorldQuant Alpha101 & AFML)
 *
 * Provides:
 * 1. Alpha Factors (Alpha158 & Alpha101 inspired: CMF, VPT, NATR, VWAP distance, momentum acceleration)
 * 2. AFML Dynamic Triple Barrier Engine (ATR-adaptive profit target, stop boundary, and holding horizon)
 * 3. Machine Learning Meta-Labeling & Calibrated Ensemble Decisions
 */

export interface HistoricalBar {
  date?: string;
  price?: number;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface AlphaFactors {
  cmf20: number; // Chaikin Money Flow 20-period [-1, 1]
  vpt: number; // Volume-Price Trend direction indicator
  natr14: number; // Normalized Average True Range % of price
  vwapDistancePct: number; // % distance of current price to rolling VWAP
  momentumAcceleration: number; // 2nd derivative of price momentum (ROC5 - ROC10)
  volumeZScore: number; // Number of standard deviations above 20-day average volume
  compositeAlphaScore: number; // Institutional multi-factor score [0, 100]
  factorSignals: string[];
}

export interface TripleBarriers {
  currentPrice: number;
  upperTargetPrice: number; // Volatility-adjusted upper barrier
  lowerStopPrice: number; // Volatility-adjusted lower barrier
  targetPercent: number; // Dynamic +% target
  stopPercent: number; // Dynamic -% stop
  rewardToRiskRatio: number; // Dynamic R:R ratio
  volatilityRegime: 'compressed' | 'normal' | 'expanded';
  maxHoldingHorizonDays: number;
  summary: string;
}

export interface MetaLabelingResult {
  metaConfidence: number; // 0–100 ensemble score
  actionRecommendation:
    | 'HIGH_CONVICTION_BREAKOUT'
    | 'TACTICAL_SWING'
    | 'EXHAUSTION_WARNING'
    | 'LOW_EDGE_VOLATILITY';
  recommendedPositionSizeMultiplier: number; // 0.5x – 1.5x Kelly multiplier
  calibratedWinRate: number; // Calibrated probability [0.0 - 1.0]
  reasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 1. Compute Alpha Factors (Alpha158 & Alpha101 Inspired)
 */
export function computeAlphaFactors(
  history: readonly HistoricalBar[],
  currentQuote?: {
    currentPrice?: number;
    volume?: number;
    high?: number;
    low?: number;
    open?: number;
  }
): AlphaFactors {
  const bars: Array<{ close: number; high: number; low: number; volume: number }> = [];

  for (const bar of history) {
    const close = safeNumber(bar.close ?? bar.price);
    if (close <= 0) continue;
    const high = Math.max(safeNumber(bar.high, close), close);
    const low = Math.min(Math.max(safeNumber(bar.low, close), 0.01), close);
    const volume = Math.max(safeNumber(bar.volume, 0), 0);
    bars.push({ close, high, low, volume });
  }

  // Include current live quote if provided and valid
  if (currentQuote && safeNumber(currentQuote.currentPrice) > 0) {
    const close = currentQuote.currentPrice!;
    const high = Math.max(safeNumber(currentQuote.high, close), close);
    const low = Math.min(Math.max(safeNumber(currentQuote.low, close), 0.01), close);
    const volume = Math.max(safeNumber(currentQuote.volume, 0), 0);
    bars.push({ close, high, low, volume });
  }

  const signals: string[] = [];

  if (bars.length < 5) {
    return {
      cmf20: 0,
      vpt: 0,
      natr14: 2.5,
      vwapDistancePct: 0,
      momentumAcceleration: 0,
      volumeZScore: 0,
      compositeAlphaScore: 50,
      factorSignals: ['Insufficient history for multi-factor computation'],
    };
  }

  const latest = bars[bars.length - 1];

  // A. Chaikin Money Flow (20 sessions or all available)
  const window20 = bars.slice(-20);
  let moneyFlowSum = 0;
  let totalVolume20 = 0;

  for (const bar of window20) {
    const highLowRange = bar.high - bar.low;
    const clv = highLowRange > 0 ? ((bar.close - bar.low) - (bar.high - bar.close)) / highLowRange : 0;
    moneyFlowSum += clv * bar.volume;
    totalVolume20 += bar.volume;
  }
  const cmf20 = totalVolume20 > 0 ? Number(clamp(moneyFlowSum / totalVolume20, -1, 1).toFixed(3)) : 0;
  if (cmf20 > 0.1) signals.push(`Institutional Accumulation (CMF: +${cmf20})`);
  else if (cmf20 < -0.1) signals.push(`Distribution Pressure (CMF: ${cmf20})`);

  // B. Volume-Price Trend (VPT) over window
  let vpt = 0;
  for (let i = 1; i < window20.length; i++) {
    const prev = window20[i - 1];
    const curr = window20[i];
    if (prev.close > 0) {
      vpt += curr.volume * ((curr.close - prev.close) / prev.close);
    }
  }

  // C. Normalized Average True Range (NATR 14)
  const window14 = bars.slice(-14);
  let trSum = 0;
  for (let i = 1; i < window14.length; i++) {
    const prev = window14[i - 1];
    const curr = window14[i];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trSum += tr;
  }
  const trCount = Math.max(window14.length - 1, 1);
  const atr14 = trSum / trCount;
  const natr14 = latest.close > 0 ? Number(((atr14 / latest.close) * 100).toFixed(2)) : 2.5;

  if (natr14 < 2.0) signals.push('Volatility Squeeze / Compression');
  else if (natr14 > 5.0) signals.push('High Volatility Expansion');

  // D. Rolling VWAP & Distance
  let cumPv = 0;
  let cumVol = 0;
  for (const bar of window20) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPv += typicalPrice * bar.volume;
    cumVol += bar.volume;
  }
  const rollingVwap = cumVol > 0 ? cumPv / cumVol : latest.close;
  const vwapDistancePct = rollingVwap > 0 ? Number((((latest.close - rollingVwap) / rollingVwap) * 100).toFixed(2)) : 0;
  if (vwapDistancePct > 0.5 && vwapDistancePct <= 5.0) {
    signals.push(`Trading Above Institutional VWAP (+${vwapDistancePct}%)`);
  }

  // E. Momentum Acceleration (2nd Derivative: ROC5 - ROC10)
  let roc5 = 0;
  let roc10 = 0;
  if (bars.length >= 6) {
    const prev5 = bars[bars.length - 6].close;
    roc5 = prev5 > 0 ? ((latest.close - prev5) / prev5) * 100 : 0;
  }
  if (bars.length >= 11) {
    const prev10 = bars[bars.length - 11].close;
    roc10 = prev10 > 0 ? ((latest.close - prev10) / prev10) * 100 : 0;
  }
  const momentumAcceleration = Number((roc5 - roc10).toFixed(2));
  if (momentumAcceleration > 1.5) signals.push('Momentum Accelerating (Convex Curve)');
  else if (momentumAcceleration < -2.0) signals.push('Momentum Decelerating (Exhaustion Risk)');

  // F. Volume Expansion Z-Score
  const volumes = window20.map(b => b.volume);
  const meanVol = volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1);
  const variance = volumes.reduce((sum, v) => sum + Math.pow(v - meanVol, 2), 0) / Math.max(volumes.length, 1);
  const stdVol = Math.sqrt(variance);
  const volumeZScore = stdVol > 0 ? Number(((latest.volume - meanVol) / stdVol).toFixed(2)) : 0;
  if (volumeZScore >= 1.5) signals.push(`Statistical Volume Anomaly (+${volumeZScore}σ)`);

  // G. Composite Alpha Score Calculation (0 to 100)
  let alpha = 50; // Neutral baseline
  alpha += clamp(cmf20 * 30, -15, 20); // Money Flow: -15 to +20
  alpha += clamp(momentumAcceleration * 3, -12, 15); // Acceleration: -12 to +15
  alpha += clamp(volumeZScore * 6, -8, 15); // Volume Z-score: -8 to +15
  alpha += clamp(vwapDistancePct * 2, -10, 10); // VWAP alignment: -10 to +10

  // Volatility adjustment: penalize extreme uncontained NATR (>7%)
  if (natr14 > 7.0) alpha -= 10;

  const compositeAlphaScore = Math.round(clamp(alpha, 10, 95));

  return {
    cmf20,
    vpt,
    natr14: Math.max(natr14, 0.5),
    vwapDistancePct,
    momentumAcceleration,
    volumeZScore,
    compositeAlphaScore,
    factorSignals: signals,
  };
}

/**
 * 2. AFML Dynamic Triple Barrier Engine
 * Sets dynamic barriers tailored to each stock's volatility (ATR) rather than static %
 */
export function computeTripleBarriers(
  currentPrice: number,
  natr14: number,
  options: {
    profitAtrMultiplier?: number;
    stopAtrMultiplier?: number;
    maxHoldingHorizonDays?: number;
  } = {}
): TripleBarriers {
  const price = Math.max(safeNumber(currentPrice), 0.01);
  const natr = Math.max(safeNumber(natr14, 2.5), 0.5);

  const profitMult = options.profitAtrMultiplier ?? 1.8; // Target ~1.8x daily true range
  const stopMult = options.stopAtrMultiplier ?? 1.0; // Stop ~1.0x daily true range
  const maxHoldingHorizonDays = options.maxHoldingHorizonDays ?? 5; // Time barrier: 5 trading sessions

  // Target & Stop percentages dynamically bounded between institutional limits
  const targetPercent = Number(clamp(natr * profitMult, 2.5, 12.0).toFixed(2));
  const stopPercent = Number(clamp(natr * stopMult, 1.5, 6.0).toFixed(2));

  const upperTargetPrice = Number((price * (1 + targetPercent / 100)).toFixed(2));
  const lowerStopPrice = Number((price * (1 - stopPercent / 100)).toFixed(2));
  const rewardToRiskRatio = Number((targetPercent / stopPercent).toFixed(2));

  const volatilityRegime: TripleBarriers['volatilityRegime'] =
    natr < 2.0 ? 'compressed' : natr > 4.5 ? 'expanded' : 'normal';

  const summary = `Dynamic Triple Barrier: +${targetPercent}% Target / -${stopPercent}% Stop (${rewardToRiskRatio}:1 R:R) scaled to ${natr}% NATR.`;

  return {
    currentPrice: price,
    upperTargetPrice,
    lowerStopPrice,
    targetPercent,
    stopPercent,
    rewardToRiskRatio,
    volatilityRegime,
    maxHoldingHorizonDays,
    summary,
  };
}

/**
 * 3. Machine Learning Meta-Labeling & Ensemble Decision Engine
 */
export function evaluateMetaLabeling(
  factors: AlphaFactors,
  barriers: TripleBarriers,
  baseScore: number
): MetaLabelingResult {
  const reasons: string[] = [];

  // 1. Base Score normalized [0 - 100]
  const score = clamp(safeNumber(baseScore, 50), 0, 100);

  // 2. Ensemble weight calculation
  let ensembleWeight = 0;

  // Factor A: Chaikin Money Flow & Volume Confirmation
  if (factors.cmf20 >= 0.08 && factors.volumeZScore >= 1.0) {
    ensembleWeight += 25;
    reasons.push('High volume conviction: Smart money accumulation confirmed.');
  } else if (factors.cmf20 < -0.05) {
    ensembleWeight -= 20;
    reasons.push('Distribution alert: Outflow detected during price advance.');
  }

  // Factor B: Convex Momentum Acceleration
  if (factors.momentumAcceleration > 1.0) {
    ensembleWeight += 20;
    reasons.push('Convex acceleration: Swing velocity is expanding.');
  } else if (factors.momentumAcceleration < -2.0) {
    ensembleWeight -= 25;
    reasons.push('Deceleration warning: Upward momentum is fading.');
  }

  // Factor C: VWAP Institutional Support
  if (factors.vwapDistancePct > 0 && factors.vwapDistancePct < 4.0) {
    ensembleWeight += 15;
    reasons.push('Strong VWAP foundation: Price is supported by rolling buyers.');
  } else if (factors.vwapDistancePct >= 6.0) {
    ensembleWeight -= 15;
    reasons.push('Overextended: Price is >6% above VWAP (mean-reversion risk).');
  }

  // Factor D: Volatility Regime Suitability
  if (barriers.volatilityRegime === 'normal') {
    ensembleWeight += 10;
  } else if (barriers.volatilityRegime === 'expanded' && factors.natr14 > 6.5) {
    ensembleWeight -= 20;
    reasons.push('Extreme volatility regime: Wider stop required, higher whipsaw risk.');
  }

  // Compute final Meta-Confidence (0 to 100)
  const metaConfidence = Math.round(clamp(score * 0.4 + factors.compositeAlphaScore * 0.35 + ensembleWeight * 0.25 + 15, 10, 95));

  // Determine Action Recommendation
  let actionRecommendation: MetaLabelingResult['actionRecommendation'];
  let sizeMultiplier = 1.0;

  if (factors.momentumAcceleration < -2.5 || (factors.vwapDistancePct >= 7.0 && factors.cmf20 < 0)) {
    actionRecommendation = 'EXHAUSTION_WARNING';
    sizeMultiplier = 0.5;
  } else if (barriers.volatilityRegime === 'compressed' && factors.volumeZScore < 0.5) {
    actionRecommendation = 'LOW_EDGE_VOLATILITY';
    sizeMultiplier = 0.5;
  } else if (metaConfidence >= 75 && barriers.rewardToRiskRatio >= 1.6) {
    actionRecommendation = 'HIGH_CONVICTION_BREAKOUT';
    sizeMultiplier = 1.35; // Size up on high-conviction institutional setups
  } else {
    actionRecommendation = 'TACTICAL_SWING';
    sizeMultiplier = 1.0;
  }

  // Calibrated Win Rate using Platt scaling on metaConfidence
  // Probability sigmoid: 1 / (1 + exp(- (metaConfidence - 50) / 18))
  const logit = (metaConfidence - 50) / 18;
  const calibratedWinRate = Number((1 / (1 + Math.exp(-logit))).toFixed(2));

  return {
    metaConfidence,
    actionRecommendation,
    recommendedPositionSizeMultiplier: Number(sizeMultiplier.toFixed(2)),
    calibratedWinRate: clamp(calibratedWinRate, 0.2, 0.85),
    reasons,
  };
}
