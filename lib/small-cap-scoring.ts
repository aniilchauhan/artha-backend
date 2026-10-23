import { evaluateStockEventCatalyst } from './event-catalyst';

export interface SmallCapCandidateInput {
  ticker?: string;
  name?: string;
  marketCap?: number; // In ₹ Crores
  changePercent?: number;
  volume?: number;
  averageVolume?: number;
  currentPrice?: number;
  previousClose?: number;
  sector?: string;
  sectorPerformance?: number;
  marketTrend?: number;
  forwardReturn?: number; // Forward return % over evaluation horizon
  // Institutional microstructure & quant additions:
  turnover?: number; // Daily turnover in ₹ INR
  circuitLimit?: number; // Upper circuit band % (e.g. 5, 10, 20)
  isAsmGsm?: boolean; // True if under SEBI/NSE ASM or GSM surveillance
  isT2T?: boolean; // True if Trade-to-Trade (T2T) series
  maxAdverseExcursion?: number; // Max drawdown % experienced during holding horizon
  holdingDays?: number; // Target swing holding horizon (default 3-5 days)
  // Event & News Catalyst overlays:
  daysToEarnings?: number;
  earningsBeat?: 'beat' | 'miss' | 'inline';
  newsSentiment?: 'Bullish' | 'Bearish' | 'Neutral';
  // Macro & Regime Overlays:
  indiaVix?: number;
  marketBreadth?: number; // % of small-cap universe meeting breakout criteria
  // Options OI Overlay:
  optionsPcr?: number;       // Put-Call Ratio from F&O options chain (if available)
  isShortSqueezeSetup?: boolean; // True if spot has broken above highest call OI wall
}

export interface SmallCapScorePillars {
  trend: number;
  volume: number;
  relativeStrength: number;
  riskPenalty: number;
}

export interface SmallCapSignalResult {
  ticker?: string;
  score: number;
  probability: number | null; // Unavailable until forward outcomes validate a calibration
  isEligibleFor2Pct: boolean;
  isHighConviction: boolean;
  confidence: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  momentumStrength: number;
  signals: string[];
  // Quant metrics:
  turnoverLakhs?: number;
  circuitHeadroomPercent?: number;
  isCircuitLocked?: boolean;
  lowerCircuitHeadroomPercent?: number;
  isLowerCircuitLocked?: boolean;
  scorePillars?: SmallCapScorePillars;
  // Options OI overlay results:
  optionsPcr?: number;
  isShortSqueezeSetup?: boolean;
  optionsSignal?: string;
  // Event & News Catalyst metrics:
  hasEarningsRisk?: boolean;
  daysToEarnings?: number;
  earningsDate?: string;
  earningsSurprise?: 'beat' | 'miss' | 'inline';
  newsSentiment?: 'Bullish' | 'Bearish' | 'Neutral';
}

export interface SmallCapUniverseSummary {
  totalSmallCap: number;
  totalEligibleFor2Pct: number;
  probability: number; // Backward-compatible breadth alias; not a future-return probability
  marketBreadth: number; // Quantitative semantic name: % of universe meeting breakout criteria
  averageTurnoverLakhs?: number;
}

export interface SmallCapAiSummary {
  headline: string;
  breakdown: Array<{
    ticker?: string;
    score: number;
    signal: string;
    reasoning: string;
  }>;
}

export interface SmallCapBacktestMetrics {
  totalScored: number;
  eligibleCount: number;
  evaluatedCount: number; // Eligible setups with both measured forward return and MAE
  highConvictionCount: number;
  hitRate: number | null;
  averageForwardReturn: number | null;
  averageScore: number;
  averageMae: number | null; // Average measured Max Adverse Excursion %
  riskRewardRatio: number | null; // Average positive / absolute average negative forward return
  winCount: number;
  lossCount: number;
}

export interface SmallCapHealthSummary {
  status: 'stable' | 'warning' | 'critical' | 'unavailable';
  averageScore: number;
  eligibleRatio: number;
  scoreSpread: number;
  driftAlert: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteValue(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function isKnownSmallCap(stock: SmallCapCandidateInput): boolean {
  const marketCap = stock.marketCap;
  return typeof marketCap === 'number' && Number.isFinite(marketCap) && marketCap > 0 && marketCap < 20000;
}

export function checkCircuitLock(stock: SmallCapCandidateInput): {
  isLocked: boolean;
  headroom?: number;
  isLowerLocked?: boolean;
  lowerHeadroom?: number;
} {
  const changePercent = stock.changePercent;
  const circuitLimit = stock.circuitLimit;
  if (typeof circuitLimit !== 'number' || !Number.isFinite(circuitLimit) || circuitLimit <= 0 ||
      typeof changePercent !== 'number' || !Number.isFinite(changePercent)) {
    return { isLocked: false };
  }
  const headroom = circuitLimit - changePercent;
  // If price is within 0.5% of upper circuit, order execution is severely compromised
  const isLocked = circuitLimit > 0 && headroom <= 0.5;

  // Lower circuit guard: if price is within 0.5% of lower limit, exit liquidity is trapped
  const lowerHeadroom = circuitLimit + changePercent;
  const isLowerLocked = circuitLimit > 0 && lowerHeadroom <= 0.5;

  return {
    isLocked,
    headroom: Number(headroom.toFixed(2)),
    isLowerLocked,
    lowerHeadroom: Number(lowerHeadroom.toFixed(2)),
  };
}

function getConfidenceLevel(score: number, isEligible: boolean): 'low' | 'medium' | 'high' {
  if (isEligible && score >= 70) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

function getRiskLevel(
  liquidityQualified: boolean,
  volatilityRisk: number,
  isCircuitLocked: boolean = false,
  isAsmGsm: boolean = false,
  isT2T: boolean = false
): 'low' | 'medium' | 'high' {
  if (!liquidityQualified || volatilityRisk >= 18 || isCircuitLocked || isAsmGsm || isT2T) return 'high';
  if (volatilityRisk >= 10 || !liquidityQualified) return 'medium';
  return 'low';
}

export function hasSufficientLiquidity(stock: SmallCapCandidateInput): boolean {
  const volume = finiteValue(stock.volume);
  const averageVolume = finiteValue(stock.averageVolume);
  const currentPrice = finiteValue(stock.currentPrice);
  const turnover = stock.turnover === undefined ? volume * currentPrice : finiteValue(stock.turnover);
  if (volume <= 0 || averageVolume <= 0 || currentPrice <= 0 || !Number.isFinite(turnover) || turnover <= 0) {
    return false;
  }
  const relativeVolume = volume / averageVolume;

  // Require historical volume and at least ₹50 Lakhs of valid daily turnover.
  const turnoverQualified = turnover >= 5000000;
  const volumeQualified = volume >= 50000 && averageVolume >= 30000;
  const relativeQualified = relativeVolume >= 1.05;

  return turnoverQualified && volumeQualified && relativeQualified;
}

export function buildSmallCapAiSummary(stocks: SmallCapCandidateInput[]): SmallCapAiSummary {
  const ranked = [...stocks]
    .filter(isKnownSmallCap)
    .map((stock) => {
      const result = scoreSmallCapCandidate(stock);
      return {
        ticker: stock.ticker,
        score: result.score,
        isEligibleFor2Pct: result.isEligibleFor2Pct,
        signal: result.isHighConviction
          ? 'high-score momentum setup'
          : result.isEligibleFor2Pct
            ? '+2% momentum watch'
            : 'small-cap momentum watch',
        reasoning: buildSmallCapNarrative(stock),
      };
    })
    .sort((a, b) => {
      if (a.isEligibleFor2Pct !== b.isEligibleFor2Pct) return a.isEligibleFor2Pct ? -1 : 1;
      return b.score - a.score;
    })
    .slice(0, 3);

  const topTotal = ranked.length;
  const eligible = ranked.filter((item) => item.isEligibleFor2Pct).length;

  return {
    headline: topTotal > 0
      ? `${eligible} of ${topTotal} top small-cap setups meet screen-qualified momentum conditions.`
      : 'No verified small-cap setups are currently available for momentum screening.',
    breakdown: ranked.map(({ isEligibleFor2Pct, ...item }) => item),
  };
}

export function buildSmallCapNarrative(stock: SmallCapCandidateInput): string {
  const changePercent = finiteValue(stock.changePercent);
  const volume = finiteValue(stock.volume);
  const currentPrice = finiteValue(stock.currentPrice);
  const averageVolume = finiteValue(stock.averageVolume);
  const turnover = finiteValue(stock.turnover ?? (volume * currentPrice));
  const relativeVolume = volume > 0 && averageVolume > 0 ? volume / averageVolume : 0;
  const circuit = checkCircuitLock(stock);

  const fragments: string[] = [];

  if (isKnownSmallCap(stock)) {
    fragments.push('the stock sits inside the small-cap universe');
  }

  if (changePercent >= 2) {
    fragments.push('momentum is already above the +2% breakout trigger');
  } else if (changePercent > 0) {
    fragments.push('momentum is positive but still below the +2% breakout trigger');
  } else {
    fragments.push('momentum is weak and needs a stronger catalyst');
  }

  if (averageVolume <= 0) {
    fragments.push('historical average volume is unavailable');
  } else if (relativeVolume >= 1.2) {
    fragments.push('volume participation is expanding above its usual range');
  } else {
    fragments.push('volume is not yet confirming the move strongly');
  }

  if (turnover >= 5000000) {
    fragments.push(`daily turnover ₹${(turnover / 100000).toFixed(0)}L meets institutional liquidity threshold`);
  }

  if (circuit.isLocked) {
    fragments.push('caution: near upper circuit limit, execution risk is elevated');
  } else if (circuit.isLowerLocked) {
    fragments.push('caution: near lower circuit limit, exit liquidity is trapped');
  } else if (circuit.headroom === undefined) {
    fragments.push('circuit band is unverified; review execution risk');
  }

  if (stock.isAsmGsm) {
    fragments.push('surveillance warning: stock is under ASM/GSM framework');
  } else if (stock.isAsmGsm === undefined) {
    fragments.push('surveillance status is unverified');
  }

  if (stock.isT2T === true) {
    fragments.push('trade-to-trade restrictions increase execution risk');
  } else if (stock.isT2T === undefined) {
    fragments.push('trade-to-trade status is unverified');
  }

  // Event & News Catalyst overlays in narrative
  const catalyst = evaluateStockEventCatalyst(stock.ticker || '', {
    daysToEarnings: stock.daysToEarnings,
    earningsBeat: stock.earningsBeat,
    newsSentiment: stock.newsSentiment,
  });
  if (catalyst.narrativeFragments.length > 0) {
    fragments.push(...catalyst.narrativeFragments);
  }
  if (typeof stock.daysToEarnings !== 'number' || !Number.isFinite(stock.daysToEarnings)) {
    fragments.push('earnings date data is unavailable; binary event risk has not been assessed');
  }

  return fragments.join(', ');
}

export function scoreSmallCapCandidate(stock: SmallCapCandidateInput): SmallCapSignalResult {
  const marketCap = finiteValue(stock.marketCap);
  const changePercent = finiteValue(stock.changePercent);
  const volume = finiteValue(stock.volume);
  const averageVolume = finiteValue(stock.averageVolume);
  const currentPrice = finiteValue(stock.currentPrice);
  const previousClose = finiteValue(stock.previousClose, currentPrice || 1);
  const sectorPerformance = finiteValue(stock.sectorPerformance);
  const marketTrend = finiteValue(stock.marketTrend);
  const turnover = finiteValue(stock.turnover ?? (volume * currentPrice));
  const turnoverLakhs = Number((turnover / 100000).toFixed(1));

  const isSmallCap = isKnownSmallCap(stock);
  const relativeVolume = averageVolume > 0 ? volume / averageVolume : 0;
  const priceGap = previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0;
  const liquidityQualified = hasSufficientLiquidity(stock);
  const circuitCheck = checkCircuitLock(stock);
  const isAsmGsm = Boolean(stock.isAsmGsm);
  const isT2T = stock.isT2T === true;

  // Volatility risk: moves >= 8% are penalizing due to blow-off risk
  const volatilityRisk = Math.abs(changePercent) >= 8 ? 18 : Math.abs(changePercent) >= 6 ? 10 : 0;
  const sectorContextScore = clamp(sectorPerformance * 3, -20, 20);
  const marketContextScore = clamp(marketTrend * 2, -15, 15);
  const multiWindowTrendScore = clamp(changePercent + (sectorPerformance * 1.4) + (marketTrend * 0.9), -12, 18);

  const signals: string[] = [];

  // Pillar 1: Base & Trend Quality (0-35)
  let trendPillar = 0;
  if (isSmallCap) {
    trendPillar += 20;
    signals.push('small-cap universe');
  }
  if (isSmallCap && marketCap < 10000) {
    trendPillar += 10;
    signals.push('very small cap');
  }
  const momentumComponent = clamp(changePercent * 8, 0, 35);
  trendPillar += momentumComponent;
  if (changePercent >= 2) {
    signals.push('+2% momentum');
  }
  if (changePercent >= 3) {
    trendPillar += 10;
  }
  if (priceGap > 0) {
    const gapComponent = clamp(priceGap * 5, 0, 10);
    trendPillar += gapComponent;
    signals.push('price strength');
  }
  if (multiWindowTrendScore > 3) {
    trendPillar += clamp(multiWindowTrendScore * 3, 0, 12);
    signals.push('trend quality');
  }

  // Pillar 2: Volume & Liquidity Shock (0-25)
  let volumePillar = 0;
  const volumeComponent = clamp((relativeVolume - 1) * 25, 0, 20);
  volumePillar += volumeComponent;
  if (relativeVolume >= 1.2) {
    signals.push('volume expansion');
  }
  if (turnover >= 10000000) {
    volumePillar += 5;
    signals.push('institutional turnover');
  }

  // Pillar 3: Sector & Market Relative Strength (-20 to +25)
  let rsPillar = 0;
  if (sectorPerformance > 0) {
    rsPillar += sectorContextScore;
    signals.push('sector support');
  } else if (sectorPerformance < 0) {
    rsPillar += sectorContextScore;
    signals.push('sector headwind');
  }

  if (marketTrend > 0) {
    rsPillar += marketContextScore;
    signals.push('market tailwind');
  } else if (marketTrend < 0) {
    rsPillar += marketContextScore;
    signals.push('market headwind');
  }

  // Pillar 4: Risk, Volatility & Microstructure Penalties (-30 to 0)
  let riskPenaltyPillar = 0;
  if (!liquidityQualified) {
    riskPenaltyPillar -= 25;
    signals.push('low liquidity risk');
  }
  if (volatilityRisk > 0) {
    riskPenaltyPillar -= volatilityRisk;
    signals.push('high volatility risk');
  }
  if (changePercent < 0) {
    riskPenaltyPillar -= 15;
    signals.push('weak momentum');
  }
  if (circuitCheck.isLocked) {
    riskPenaltyPillar -= 20;
    signals.push('circuit locked risk');
  } else if (circuitCheck.isLowerLocked) {
    riskPenaltyPillar -= 20;
    signals.push('lower circuit locked risk');
  } else if (circuitCheck.headroom === undefined) {
    signals.push('circuit band unverified');
  }
  if (isAsmGsm) {
    riskPenaltyPillar -= 20;
    signals.push('ASM/GSM risk');
  }
  if (isT2T) {
    riskPenaltyPillar -= 20;
    signals.push('trade-to-trade risk');
  }

  // Regime Conditioning: India VIX & Market Breadth
  if (typeof stock.indiaVix === 'number' && Number.isFinite(stock.indiaVix)) {
    if (stock.indiaVix > 18) {
      const vixPenalty = clamp(Math.round((stock.indiaVix - 18) * 1.5), 0, 15);
      riskPenaltyPillar -= vixPenalty;
      signals.push('high VIX regime risk');
    } else if (stock.indiaVix <= 13) {
      rsPillar += 5;
      signals.push('low VIX tailwind');
    }
  }

  if (typeof stock.marketBreadth === 'number' && Number.isFinite(stock.marketBreadth)) {
    if (stock.marketBreadth < 15) {
      riskPenaltyPillar -= 10;
      signals.push('narrow breadth risk');
    } else if (stock.marketBreadth >= 40) {
      rsPillar += 5;
      signals.push('broad expansion tailwind');
    }
  }

  // Pillar 5b: Options OI Overlay (PCR Support Floor & Short-Covering Squeeze)
  let optionsSignal: string | undefined;
  if (typeof stock.optionsPcr === 'number' && Number.isFinite(stock.optionsPcr)) {
    if (stock.optionsPcr >= 1.2) {
      // High PCR = institutional put writing = strong support floor below spot
      rsPillar += 8;
      optionsSignal = 'PCR support floor';
      signals.push('options PCR support');
    } else if (stock.optionsPcr <= 0.6) {
      // Very low PCR = call dominance = smart money expects downside
      riskPenaltyPillar -= 8;
      optionsSignal = 'PCR bearish signal';
      signals.push('options PCR bearish');
    }
  }
  if (stock.isShortSqueezeSetup === true) {
    // Spot broke the call OI wall - forced short-covering drives explosive momentum
    trendPillar += 10;
    optionsSignal = optionsSignal ? `${optionsSignal} + short squeeze` : 'short-covering squeeze';
    signals.push('short-covering squeeze setup');
  }

  // Pillar 5: Event & News Catalyst Overlay (Earnings Calendar, Beats/Misses & FinBERT News)
  const catalyst = evaluateStockEventCatalyst(stock.ticker || '', {
    daysToEarnings: stock.daysToEarnings,
    earningsBeat: stock.earningsBeat,
    newsSentiment: stock.newsSentiment,
  });

  if (catalyst.isEarningsBinaryRisk) {
    riskPenaltyPillar -= 15;
    signals.push('upcoming earnings risk');
  }

  if (catalyst.earningsSurprise === 'beat') {
    trendPillar += 10;
    signals.push('earnings beat catalyst');
  } else if (catalyst.earningsSurprise === 'miss') {
    riskPenaltyPillar -= 15;
    signals.push('earnings miss overhang');
  }

  if (catalyst.newsSentiment === 'Bullish') {
    trendPillar += 5;
    signals.push('bullish news sentiment');
  } else if (catalyst.newsSentiment === 'Bearish') {
    riskPenaltyPillar -= 10;
    signals.push('bearish news overhang');
  }

  const rawScore = trendPillar + volumePillar + rsPillar + riskPenaltyPillar;
  const finalScore = clamp(rawScore, 0, 100);

  // Microstructure-qualified breakout eligibility
  const isAnyCircuitLocked = Boolean(circuitCheck.isLocked || circuitCheck.isLowerLocked);
  const isEligibleFor2Pct =
    isSmallCap &&
    changePercent >= 2 &&
    liquidityQualified &&
    volatilityRisk < 18 &&
    !isAnyCircuitLocked &&
    !isAsmGsm &&
    !isT2T;

  const confidence = getConfidenceLevel(finalScore, isEligibleFor2Pct);
  const riskLevel = getRiskLevel(liquidityQualified, volatilityRisk, isAnyCircuitLocked, isAsmGsm, isT2T);
  const hasDatedEarningsObservation = typeof stock.daysToEarnings === 'number' && Number.isFinite(stock.daysToEarnings);
  // The stronger label requires dated event evidence; missing calendar coverage is not a clean event check.
  const isHighConviction =
    isEligibleFor2Pct &&
    finalScore >= 70 &&
    riskLevel !== 'high' &&
    confidence === 'high' &&
    hasDatedEarningsObservation &&
    !catalyst.isEarningsBinaryRisk;

  if (isHighConviction) {
    signals.push('high conviction setup');
  }

  return {
    ticker: stock.ticker,
    score: Number(finalScore.toFixed(1)),
    probability: null,
    isEligibleFor2Pct,
    isHighConviction,
    confidence,
    riskLevel,
    momentumStrength: Number(changePercent.toFixed(2)),
    signals,
    turnoverLakhs,
    circuitHeadroomPercent: circuitCheck.headroom,
    isCircuitLocked: circuitCheck.isLocked,
    lowerCircuitHeadroomPercent: circuitCheck.lowerHeadroom,
    isLowerCircuitLocked: circuitCheck.isLowerLocked,
    scorePillars: {
      trend: Number(trendPillar.toFixed(1)),
      volume: Number(volumePillar.toFixed(1)),
      relativeStrength: Number(rsPillar.toFixed(1)),
      riskPenalty: Number(riskPenaltyPillar.toFixed(1)),
    },
    optionsPcr: stock.optionsPcr,
    isShortSqueezeSetup: stock.isShortSqueezeSetup,
    optionsSignal,
    hasEarningsRisk: catalyst.isEarningsBinaryRisk,
    daysToEarnings: catalyst.daysToEarnings,
    earningsDate: catalyst.earningsDate,
    earningsSurprise: catalyst.earningsSurprise,
    newsSentiment: catalyst.newsSentiment,
  };
}

export function buildSmallCapUniverseStats(stocks: SmallCapCandidateInput[]): SmallCapUniverseSummary {
  const smallCapStocks = stocks.filter(isKnownSmallCap);
  const eligibleStocks = smallCapStocks.filter((stock) => scoreSmallCapCandidate(stock).isEligibleFor2Pct);

  const breadthPercent = smallCapStocks.length > 0
    ? Number(((eligibleStocks.length / smallCapStocks.length) * 100).toFixed(1))
    : 0;

  const totalTurnover = smallCapStocks.reduce((sum, s) => {
    const p = finiteValue(s.currentPrice);
    const v = finiteValue(s.volume);
    const t = finiteValue(s.turnover ?? (p * v));
    return sum + (t / 100000);
  }, 0);

  const averageTurnoverLakhs = smallCapStocks.length > 0
    ? Number((totalTurnover / smallCapStocks.length).toFixed(1))
    : 0;

  return {
    totalSmallCap: smallCapStocks.length,
    totalEligibleFor2Pct: eligibleStocks.length,
    probability: breadthPercent, // Backward compatible alias for UI
    marketBreadth: breadthPercent, // Quantitative semantic name
    averageTurnoverLakhs,
  };
}

export function evaluateSmallCapBacktest(stocks: SmallCapCandidateInput[]): SmallCapBacktestMetrics {
  const smallCapStocks = stocks.filter(isKnownSmallCap);
  const scored = smallCapStocks.map((stock) => ({
    ...scoreSmallCapCandidate(stock),
    forwardReturn: stock.forwardReturn,
    maxAdverseExcursion: stock.maxAdverseExcursion,
  }));

  const eligible = scored.filter((item) => item.isEligibleFor2Pct);
  const measured = eligible.filter((item): item is typeof item & {
    forwardReturn: number;
    maxAdverseExcursion: number;
  } => typeof item.forwardReturn === 'number' && Number.isFinite(item.forwardReturn) &&
       typeof item.maxAdverseExcursion === 'number' && Number.isFinite(item.maxAdverseExcursion));
  const highConvictionCount = scored.filter((item) => item.isHighConviction).length;

  // Hit condition: Achieves target return (>= 2%) AND Max Adverse Excursion did not breach -2.5% stop-loss
  const winners = measured.filter((item) => item.forwardReturn >= 2 && item.maxAdverseExcursion >= -2.5);
  const losers = measured.filter((item) => item.forwardReturn < 2 || item.maxAdverseExcursion < -2.5);
  const winCount = winners.length;
  const lossCount = losers.length;
  const hitRate = measured.length > 0 ? Number(((winCount / measured.length) * 100).toFixed(1)) : null;

  const averageForwardReturn = measured.length > 0
    ? Number((measured.reduce((sum, item) => sum + item.forwardReturn, 0) / measured.length).toFixed(2))
    : null;

  const averageScore = scored.length > 0
    ? scored.reduce((sum, item) => sum + item.score, 0) / scored.length
    : 0;

  const averageMae = measured.length > 0
    ? Number((measured.reduce((sum, item) => sum + item.maxAdverseExcursion, 0) / measured.length).toFixed(2))
    : null;

  // Report observed forward gains/losses only. A positive final return after a stop
  // breach does not establish a realized loss, and missing losses supply no denominator.
  const gains = measured.filter((item) => item.forwardReturn > 0);
  const losses = measured.filter((item) => item.forwardReturn < 0);
  const avgGain = gains.length > 0 ? gains.reduce((sum, item) => sum + item.forwardReturn, 0) / gains.length : null;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, item) => sum + item.forwardReturn, 0) / losses.length) : null;
  const riskRewardRatio = avgGain !== null && avgLoss !== null && avgLoss > 0
    ? Number((avgGain / avgLoss).toFixed(2))
    : null;

  return {
    totalScored: scored.length,
    eligibleCount: eligible.length,
    evaluatedCount: measured.length,
    highConvictionCount,
    hitRate,
    averageForwardReturn,
    averageScore: Number(averageScore.toFixed(1)),
    averageMae,
    riskRewardRatio,
    winCount,
    lossCount,
  };
}

export function evaluateSmallCapHealth(stocks: SmallCapCandidateInput[]): SmallCapHealthSummary {
  const smallCapStocks = stocks.filter(isKnownSmallCap);

  if (smallCapStocks.length === 0) {
    return {
      status: 'unavailable',
      averageScore: 0,
      eligibleRatio: 0,
      scoreSpread: 0,
      driftAlert: false,
    };
  }

  const scored = smallCapStocks.map((stock) => scoreSmallCapCandidate(stock));
  const averageScore = scored.reduce((sum, item) => sum + item.score, 0) / scored.length;
  const eligibleRatio = scored.filter((item) => item.isEligibleFor2Pct).length / scored.length;
  const scoreSpread = Math.max(...scored.map((item) => item.score)) - Math.min(...scored.map((item) => item.score));
  const driftAlert = averageScore < 45 || eligibleRatio < 0.2 || scoreSpread > 50;

  let status: SmallCapHealthSummary['status'] = 'stable';
  if (averageScore < 35 || eligibleRatio < 0.1 || scoreSpread > 70) {
    status = 'critical';
  } else if (driftAlert) {
    status = 'warning';
  }

  return {
    status,
    averageScore: Number(averageScore.toFixed(1)),
    eligibleRatio: Number(eligibleRatio.toFixed(2)),
    scoreSpread: Number(scoreSpread.toFixed(1)),
    driftAlert,
  };
}
