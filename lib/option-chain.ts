/**
 * Option Chain Implied Volatility & Gap Payoff Surface Calculator
 *
 * Models At-The-Money (ATM) option straddle pricing, implied volatility (IV) expected moves,
 * and breakeven payoff envelopes for NSE equities and indices on market gap sessions.
 */

export interface OptionEnvelopeResult {
  symbol: string;
  underlyingPrice: number;
  previousClose: number;
  atmStrike: number;
  impliedVolatilityPercent: number;
  dailyExpectedMoveINR: number;
  dailyExpectedMovePercent: number;
  straddlePremiumINR: number;
  callAtmPremiumINR: number;
  putAtmPremiumINR: number;
  upperBreakeven: number;
  lowerBreakeven: number;
  envelopeStatus: 'INSIDE_ENVELOPE' | 'BREAKOUT_EXPANSION' | 'AT_THE_EDGE';
  gapToBreakevenRatio: number;
  suggestedOptionStrategy: string;
  strategyRATIONALE: string;
}

/**
 * Calculates standard NSE strike increment based on stock price level.
 */
export function getNSEStrikeStep(price: number): number {
  if (price >= 10000) return 500;
  if (price >= 5000) return 100;
  if (price >= 2000) return 50;
  if (price >= 1000) return 20;
  if (price >= 500) return 10;
  if (price >= 200) return 5;
  if (price >= 50) return 2.5;
  return 1;
}

/**
 * Rounds price to the nearest valid NSE option strike.
 */
export function getAtmStrike(price: number): number {
  const step = getNSEStrikeStep(price);
  return Math.round(price / step) * step;
}

/**
 * Computes the option chain volatility envelope and straddle payoff boundaries.
 */
export function calculateOptionEnvelope(
  symbol: string,
  underlyingPrice: number,
  previousClose: number,
  customIVPercent?: number
): OptionEnvelopeResult {
  if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) {
    throw new Error('Underlying price must be positive and finite');
  }
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    throw new Error('Previous close must be positive and finite');
  }

  // Baseline IV estimation:
  // Large-cap NSE benchmarks typically range 16% - 28% IV unless elevated
  const iv = (customIVPercent && customIVPercent > 0 && customIVPercent < 300)
    ? customIVPercent
    : 22.0;

  const atmStrike = getAtmStrike(underlyingPrice);

  // 1-Day Expected Move = S * (IV / sqrt(252))
  const dailyMoveFactor = (iv / 100) / Math.sqrt(252);
  const dailyExpectedMoveINR = Number((underlyingPrice * dailyMoveFactor).toFixed(2));
  const dailyExpectedMovePercent = Number((dailyMoveFactor * 100).toFixed(2));

  // ATM Straddle (Call + Put) price is approximately 0.8 * S * sigma * sqrt(T)
  // For 1 day to 5 days weekly expiry:
  const straddlePremiumINR = Number((dailyExpectedMoveINR * 1.25).toFixed(2));
  const callAtmPremiumINR = Number((straddlePremiumINR * 0.52).toFixed(2)); // slight call skew
  const putAtmPremiumINR = Number((straddlePremiumINR * 0.48).toFixed(2));

  const upperBreakeven = Number((atmStrike + straddlePremiumINR).toFixed(2));
  const lowerBreakeven = Number((atmStrike - straddlePremiumINR).toFixed(2));

  // Check how the opening price sits relative to the straddle breakeven from previous close
  const gapMagnitude = Math.abs(underlyingPrice - previousClose);
  const gapToBreakevenRatio = Number((gapMagnitude / (straddlePremiumINR || 1)).toFixed(2));

  let envelopeStatus: 'INSIDE_ENVELOPE' | 'BREAKOUT_EXPANSION' | 'AT_THE_EDGE';
  if (gapToBreakevenRatio > 1.05) {
    envelopeStatus = 'BREAKOUT_EXPANSION';
  } else if (gapToBreakevenRatio >= 0.90) {
    envelopeStatus = 'AT_THE_EDGE';
  } else {
    envelopeStatus = 'INSIDE_ENVELOPE';
  }

  const isGapUp = underlyingPrice >= previousClose;

  let suggestedOptionStrategy = '';
  let strategyRATIONALE = '';

  if (envelopeStatus === 'INSIDE_ENVELOPE') {
    if (isGapUp) {
      suggestedOptionStrategy = 'Bear Call Credit Spread / Iron Condor';
      strategyRATIONALE = `Opening gap is contained within 1-day IV envelope (₹${straddlePremiumINR}). High empirical probability of intraday volatility crush and mean-reverting gap fill towards ₹${previousClose.toFixed(2)}.`;
    } else {
      suggestedOptionStrategy = 'Bull Put Credit Spread / Short Strangle';
      strategyRATIONALE = `Downside gap is within expected market volatility limits. Sell OTM Put below lower breakeven (₹${lowerBreakeven}) to harvest premium on mean-reversion bounce.`;
    }
  } else if (envelopeStatus === 'BREAKOUT_EXPANSION') {
    if (isGapUp) {
      suggestedOptionStrategy = 'Bull Call Debit Spread / Momentum Long Call';
      strategyRATIONALE = `Gap exceeds ATM Straddle pricing (${gapToBreakevenRatio}x standard move). Strong institutional gamma buying pressure favors continuation over gap fill.`;
    } else {
      suggestedOptionStrategy = 'Bear Put Debit Spread / Long Put';
      strategyRATIONALE = `Gap-down breaks below IV envelope support. Volatility expansion favors downside continuation; avoid early bottom-fishing until stabilization.`;
    }
  } else {
    suggestedOptionStrategy = 'Calendar Spread / Neutral Iron Fly';
    strategyRATIONALE = `Price opening directly at the IV breakeven threshold. Wait for first 15-minute range breakout confirmation before committing directional capital.`;
  }

  return {
    symbol,
    underlyingPrice,
    previousClose,
    atmStrike,
    impliedVolatilityPercent: iv,
    dailyExpectedMoveINR,
    dailyExpectedMovePercent,
    straddlePremiumINR,
    callAtmPremiumINR,
    putAtmPremiumINR,
    upperBreakeven,
    lowerBreakeven,
    envelopeStatus,
    gapToBreakevenRatio,
    suggestedOptionStrategy,
    strategyRATIONALE,
  };
}
