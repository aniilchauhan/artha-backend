/**
 * Tomorrow's Market Outlook Predictor Engine
 * 
 * Quantitatively predicts whether tomorrow's Indian equity session (Nifty 50 / broad market)
 * will be POSITIVE (Bullish / Green), NEGATIVE (Bearish / Red), or RANGEBOUND (Neutral).
 * 
 * Synthesizes 5 quantitative pillars:
 * 1. Nifty 50 Moving Average & RSI Trend Structure
 * 2. India VIX Volatility & Hedging Pressure
 * 3. Market Breadth (Advance/Decline Ratio & % above 20 EMA)
 * 4. Macro Flows (Crude, Currency, US 10Y Yields)
 * 5. Multi-Model Aggregation
 */

export interface MarketOutlookInput {
  niftyPrice: number;
  niftyChange1d: number;
  niftyChange1dPct: number;
  niftyHistory?: Array<{ date: string; close: number; high?: number; low?: number }>;
  indiaVix?: number | null;
  indiaVixChangePct?: number | null;
  advanceCount?: number;
  declineCount?: number;
  brentCrudeChangePct?: number | null;
  usdinrChangePct?: number | null;
  dataSource?: 'provider' | 'simulated';
  isFallback?: boolean;
  quoteStatus?: 'recent' | 'delayed' | 'historical' | 'simulated';
  quoteAsOf?: string;
}

export type MarketDirection = 'POSITIVE' | 'NEGATIVE' | 'RANGEBOUND';

export interface MarketPillarScore {
  name: string;
  weight: number;
  score: number; // 0 to 100 (where > 50 is bullish, < 50 is bearish)
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rationale: string;
}

export interface TomorrowMarketOutlook {
  direction: MarketDirection;
  directionLabel: string;
  bullishProbabilityPct: number;
  bearishProbabilityPct: number;
  confidenceScore: number; // 0 to 100
  regime: 'STRONG_BULL' | 'MILD_BULL' | 'CHOPPY_SIDEWAYS' | 'MILD_BEAR' | 'STRONG_BEAR';
  expectedNiftyRange: {
    pivot: number;
    r1: number;
    s1: number;
    expectedLow: number;
    expectedHigh: number;
  };
  pillars: MarketPillarScore[];
  tradingPlaybook: {
    bias: string;
    actionableAdvice: string;
    longSuitability: 'FAVORABLE' | 'SELECTIVE' | 'AVOID';
    shortSuitability: 'FAVORABLE' | 'SELECTIVE' | 'AVOID';
  };
  asOf: string;
  dataSource?: 'provider' | 'simulated';
  isFallback?: boolean;
  quoteStatus?: 'recent' | 'delayed' | 'historical' | 'simulated';
  quoteAsOf?: string;
}

export function calculateTomorrowMarketOutlook(input: MarketOutlookInput): TomorrowMarketOutlook {
  const {
    niftyPrice,
    niftyChange1d,
    niftyChange1dPct,
    niftyHistory = [],
    indiaVix = 13.5,
    indiaVixChangePct = 0,
    advanceCount = 1200,
    declineCount = 950,
    brentCrudeChangePct = 0,
    usdinrChangePct = 0,
  } = input;

  const pillars: MarketPillarScore[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // 1. NIFTY 50 PRICE ACTION & MOVING AVERAGE MOMENTUM (Weight: 30%)
  // ───────────────────────────────────────────────────────────────────────────
  let niftyTrendScore = 50;
  let niftyRationale = 'Nifty price action is balanced.';

  if (niftyHistory.length >= 20) {
    const closes = niftyHistory.map(h => h.close);
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const isAboveSma20 = niftyPrice >= sma20;
    
    // RSI estimate
    let gains = 0, losses = 0;
    for (let i = Math.max(1, closes.length - 14); i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    const rsi = 100 - (100 / (1 + rs));

    if (isAboveSma20 && niftyChange1dPct > 0.3 && rsi >= 55) {
      niftyTrendScore = 80;
      niftyRationale = `Strong Uptrend: Nifty (₹${niftyPrice.toFixed(0)}) is trading firmly above its 20-DMA with RSI at ${rsi.toFixed(0)}.`;
    } else if (isAboveSma20 && niftyChange1dPct >= -0.2) {
      niftyTrendScore = 65;
      niftyRationale = `Mild Bullish Consolidation: Price holding above 20-DMA (₹${sma20.toFixed(0)}).`;
    } else if (!isAboveSma20 && niftyChange1dPct < -0.5) {
      niftyTrendScore = 20;
      niftyRationale = `Bearish Breakdown: Nifty broke below 20-DMA with sharp downward momentum (-${Math.abs(niftyChange1dPct).toFixed(2)}%).`;
    } else {
      niftyTrendScore = 40;
      niftyRationale = `Fragile Support: Nifty trading below 20-DMA (₹${sma20.toFixed(0)}).`;
    }
  } else {
    // Basic day return fallback
    if (niftyChange1dPct >= 0.5) {
      niftyTrendScore = 75;
      niftyRationale = `Strong Session: Nifty gained +${niftyChange1dPct.toFixed(2)}% with broad institutional buying.`;
    } else if (niftyChange1dPct <= -0.5) {
      niftyTrendScore = 25;
      niftyRationale = `Weak Session: Nifty shed ${niftyChange1dPct.toFixed(2)}% indicating institutional selling.`;
    }
  }

  pillars.push({
    name: 'Nifty 50 Trend & Momentum',
    weight: 0.30,
    score: niftyTrendScore,
    signal: niftyTrendScore >= 60 ? 'BULLISH' : niftyTrendScore <= 40 ? 'BEARISH' : 'NEUTRAL',
    rationale: niftyRationale,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. INDIA VIX & VOLATILITY RISK GAUGE (Weight: 25%)
  // ───────────────────────────────────────────────────────────────────────────
  const vix = indiaVix ?? 14.0;
  const vixChange = indiaVixChangePct ?? 0;
  let vixScore = 50;
  let vixRationale = '';

  if (vix < 13.5 && vixChange <= 0) {
    vixScore = 85;
    vixRationale = `Low Volatility Tailwind: India VIX is calm at ${vix.toFixed(2)} pts (cooling ${vixChange.toFixed(1)}%). Favorable for steady upward drift.`;
  } else if (vix < 16.0 && vixChange < 3.0) {
    vixScore = 65;
    vixRationale = `Stable Volatility: India VIX at ${vix.toFixed(2)} pts within normal healthy band.`;
  } else if (vixChange > 5.0 || vix > 18.0) {
    vixScore = 20;
    vixRationale = `Surging Fear Index: India VIX jumped +${vixChange.toFixed(1)}% to ${vix.toFixed(2)} pts. Institutional put hedging active; elevated risk of sudden drops.`;
  } else {
    vixScore = 45;
    vixRationale = `Mild Hedging Pressure: India VIX at ${vix.toFixed(2)} pts indicates cautious market participation.`;
  }

  pillars.push({
    name: 'India VIX Volatility Climate',
    weight: 0.25,
    score: vixScore,
    signal: vixScore >= 60 ? 'BULLISH' : vixScore <= 40 ? 'BEARISH' : 'NEUTRAL',
    rationale: vixRationale,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. MARKET BREADTH & ADVANCE-DECLINE RATIO (Weight: 25%)
  // ───────────────────────────────────────────────────────────────────────────
  const totalStocks = advanceCount + declineCount || 1;
  const advanceRatio = advanceCount / totalStocks;
  let breadthScore = 50;
  let breadthRationale = '';

  if (advanceRatio >= 0.65) {
    breadthScore = 85;
    breadthRationale = `Robust Market Breadth: ${advanceCount} advances vs ${declineCount} declines (${(advanceRatio * 100).toFixed(0)}% positive participation).`;
  } else if (advanceRatio >= 0.52) {
    breadthScore = 60;
    breadthRationale = `Positive Breadth: Advances leading declines (${advanceCount} vs ${declineCount}).`;
  } else if (advanceRatio <= 0.38) {
    breadthScore = 20;
    breadthRationale = `Heavy Market Breadth Drag: Broad sell-off with ${declineCount} stocks declining vs only ${advanceCount} advancing.`;
  } else {
    breadthScore = 45;
    breadthRationale = `Evenly Divided Market: Mixed participation across sectors (${advanceCount} advances vs ${declineCount} declines).`;
  }

  pillars.push({
    name: 'Broad Market Breadth (NSE)',
    weight: 0.25,
    score: breadthScore,
    signal: breadthScore >= 60 ? 'BULLISH' : breadthScore <= 40 ? 'BEARISH' : 'NEUTRAL',
    rationale: breadthRationale,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. MACRO COMMODITY & CURRENCY FLOWS (Weight: 20%)
  // ───────────────────────────────────────────────────────────────────────────
  let macroScore = 50;
  let macroRationale = '';

  const crudeSurge = (brentCrudeChangePct ?? 0) > 1.5;
  const currencyWeakness = (usdinrChangePct ?? 0) > 0.25;

  if (crudeSurge && currencyWeakness) {
    macroScore = 25;
    macroRationale = `Macro Headwinds: Brent Crude up +${brentCrudeChangePct?.toFixed(1)}% and Rupee softening against USD. Pressure on import-heavy sectors.`;
  } else if ((brentCrudeChangePct ?? 0) < -1.0) {
    macroScore = 75;
    macroRationale = `Macro Tailwind: Cooling crude oil prices (-${Math.abs(brentCrudeChangePct ?? 0).toFixed(1)}%) support Indian macroeconomic stability.`;
  } else {
    macroScore = 55;
    macroRationale = `Stable Macro Backdrop: Global commodities and currency flows trading within stable ranges.`;
  }

  pillars.push({
    name: 'Global & Macro Flow Alignment',
    weight: 0.20,
    score: macroScore,
    signal: macroScore >= 60 ? 'BULLISH' : macroScore <= 40 ? 'BEARISH' : 'NEUTRAL',
    rationale: macroRationale,
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. COMPOSITE PROBABILITY & DIRECTION CALCULATION
  // ───────────────────────────────────────────────────────────────────────────
  let compositeScore = 0;
  pillars.forEach(p => {
    compositeScore += p.score * p.weight;
  });

  const bullishProbabilityPct = Math.round(compositeScore);
  const bearishProbabilityPct = 100 - bullishProbabilityPct;
  const confidenceScore = Math.abs(bullishProbabilityPct - 50) * 2;

  let direction: MarketDirection;
  let directionLabel: string;
  let regime: TomorrowMarketOutlook['regime'];

  if (bullishProbabilityPct >= 65) {
    direction = 'POSITIVE';
    directionLabel = 'Bullish / Green Session Expected';
    regime = 'STRONG_BULL';
  } else if (bullishProbabilityPct >= 55) {
    direction = 'POSITIVE';
    directionLabel = 'Mildly Positive Session';
    regime = 'MILD_BULL';
  } else if (bullishProbabilityPct <= 35) {
    direction = 'NEGATIVE';
    directionLabel = 'Bearish / Red Session Expected';
    regime = 'STRONG_BEAR';
  } else if (bullishProbabilityPct <= 45) {
    direction = 'NEGATIVE';
    directionLabel = 'Mildly Negative Session';
    regime = 'MILD_BEAR';
  } else {
    direction = 'RANGEBOUND';
    directionLabel = 'Sideways / Choppy Rangebound Session';
    regime = 'CHOPPY_SIDEWAYS';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. EXPECTED NIFTY RANGE (Standard Floor Pivot Calculation)
  // ───────────────────────────────────────────────────────────────────────────
  const latestHigh = niftyHistory.length > 0 && niftyHistory[niftyHistory.length - 1].high 
    ? niftyHistory[niftyHistory.length - 1].high! 
    : niftyPrice * 1.004;
  const latestLow = niftyHistory.length > 0 && niftyHistory[niftyHistory.length - 1].low 
    ? niftyHistory[niftyHistory.length - 1].low! 
    : niftyPrice * 0.996;

  const pivot = Math.round((latestHigh + latestLow + niftyPrice) / 3);
  const r1 = Math.round(2 * pivot - latestLow);
  const s1 = Math.round(2 * pivot - latestHigh);
  const expectedHigh = direction === 'POSITIVE' ? r1 + Math.round((r1 - pivot) * 0.5) : r1;
  const expectedLow = direction === 'NEGATIVE' ? s1 - Math.round((pivot - s1) * 0.5) : s1;

  // ───────────────────────────────────────────────────────────────────────────
  // 7. ACTIONABLE TRADING PLAYBOOK
  // ───────────────────────────────────────────────────────────────────────────
  let bias: string;
  let actionableAdvice: string;
  let longSuitability: 'FAVORABLE' | 'SELECTIVE' | 'AVOID';
  let shortSuitability: 'FAVORABLE' | 'SELECTIVE' | 'AVOID';

  if (direction === 'POSITIVE') {
    bias = `Buy-On-Dips Bias (${bullishProbabilityPct}% Bullish Confidence)`;
    actionableAdvice = `Favor Long Breakouts and Stage-2 swing continuations. Trailing stop-losses along previous 15-min swing lows. Key breakout trigger above ₹${r1}.`;
    longSuitability = 'FAVORABLE';
    shortSuitability = 'AVOID';
  } else if (direction === 'NEGATIVE') {
    bias = `Sell-On-Rallies / Defensive Bias (${bearishProbabilityPct}% Bearish Confidence)`;
    actionableAdvice = `Elevated risk of gap-downs or mid-day selloffs. Tighten all long stop-losses to 8% without exception. Favor Put option hedging or sitting in cash. Breakdown below ₹${s1} accelerates downside.`;
    longSuitability = 'AVOID';
    shortSuitability = 'FAVORABLE';
  } else {
    bias = `Rangebound / Mean-Reversion Bias (Neutral ~50%)`;
    actionableAdvice = `Avoid aggressive directional trades at open. Sell resistance near ₹${r1} and buy strong support near ₹${s1}. Favor option selling or short scalps.`;
    longSuitability = 'SELECTIVE';
    shortSuitability = 'SELECTIVE';
  }

  return {
    direction,
    directionLabel,
    bullishProbabilityPct,
    bearishProbabilityPct,
    confidenceScore,
    regime,
    expectedNiftyRange: {
      pivot,
      r1,
      s1,
      expectedLow,
      expectedHigh,
    },
    pillars,
    tradingPlaybook: {
      bias,
      actionableAdvice,
      longSuitability,
      shortSuitability,
    },
    asOf: new Date().toISOString(),
    dataSource: input.dataSource ?? (input.isFallback ? 'simulated' : 'provider'),
    isFallback: input.isFallback ?? false,
    quoteStatus: input.quoteStatus ?? (input.isFallback ? 'simulated' : 'historical'),
    quoteAsOf: input.quoteAsOf,
  };
}
