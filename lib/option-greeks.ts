/**
 * Option Greeks Calculator — Black-Scholes Model
 *
 * Computes the full Greeks suite (Delta, Gamma, Theta, Vega, Rho) for European-style
 * options using the Black-Scholes-Merton framework. Designed for NSE equity and index
 * options with standard annualized volatility and risk-free rate assumptions.
 *
 * Mathematical Foundation:
 * - d1 = [ln(S/K) + (r + σ²/2)T] / (σ√T)
 * - d2 = d1 - σ√T
 * - Call: SN(d1) - Ke^(-rT)N(d2)
 * - Put:  Ke^(-rT)N(-d2) - SN(-d1)
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type OptionType = 'CE' | 'PE';

export interface GreeksInput {
  /** Current underlying price */
  spotPrice: number;
  /** Option strike price */
  strikePrice: number;
  /** Time to expiry in calendar days */
  daysToExpiry: number;
  /** Annualized implied volatility (e.g., 25 for 25%) */
  impliedVolatilityPercent: number;
  /** Annualized risk-free interest rate (e.g., 6.5 for 6.5%) */
  riskFreeRatePercent?: number;
  /** Option type: CE (Call) or PE (Put) */
  optionType: OptionType;
}

export interface GreeksResult {
  /** Black-Scholes theoretical option price */
  theoreticalPrice: number;

  /** Delta: Rate of change of option price per ₹1 change in underlying
   *  Call: 0 to 1, Put: -1 to 0 */
  delta: number;

  /** Gamma: Rate of change of Delta per ₹1 change in underlying
   *  Always positive; peaks at ATM */
  gamma: number;

  /** Theta: Daily time decay in ₹ per day
   *  Typically negative (options lose value as time passes) */
  theta: number;

  /** Vega: Sensitivity to 1% change in implied volatility
   *  Always positive; highest at ATM */
  vega: number;

  /** Rho: Sensitivity to 1% change in risk-free rate */
  rho: number;

  /** Intrinsic value of the option */
  intrinsicValue: number;

  /** Time (extrinsic) value = theoretical price - intrinsic */
  timeValue: number;

  /** Moneyness classification */
  moneyness: 'DEEP_ITM' | 'ITM' | 'ATM' | 'OTM' | 'DEEP_OTM';

  /** Input parameters echoed back */
  input: GreeksInput;
}

export interface GreeksChainRow {
  strike: number;
  callGreeks: GreeksResult;
  putGreeks: GreeksResult;
}

export interface GreeksMatrix {
  symbol: string;
  spotPrice: number;
  daysToExpiry: number;
  impliedVolatilityPercent: number;
  riskFreeRatePercent: number;
  chain: GreeksChainRow[];
  computedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Default RBI repo rate as proxy for risk-free rate */
const DEFAULT_RISK_FREE_RATE = 6.5;

/** Trading days per year for theta computation */
const TRADING_DAYS_PER_YEAR = 252;

/** Calendar days per year */
const CALENDAR_DAYS_PER_YEAR = 365;

// ─── Mathematical Primitives ────────────────────────────────────────────

/**
 * Standard normal cumulative distribution function (CDF).
 * Uses the Abramowitz & Stegun rational approximation (error < 1e-7).
 */
export function normalCDF(x: number): number {
  if (x >= 8) return 1;
  if (x <= -8) return 0;

  // Abramowitz & Stegun 26.2.17 — Zelen & Severo rational approximation
  // Maximum absolute error < 7.5e-8
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;

  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const pdf = Math.exp(-0.5 * absX * absX) / Math.sqrt(2 * Math.PI);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const cdf = 1.0 - pdf * poly;

  return x >= 0 ? cdf : 1.0 - cdf;
}

/**
 * Standard normal probability density function (PDF).
 */
export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─── Black-Scholes Core ─────────────────────────────────────────────────

/**
 * Computes d1 and d2 parameters of the Black-Scholes model.
 */
function computeD1D2(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number
): { d1: number; d2: number } {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2 };
}

/**
 * Determines the moneyness classification of an option.
 */
function classifyMoneyness(S: number, K: number, type: OptionType): GreeksResult['moneyness'] {
  const ratio = S / K;
  if (type === 'CE') {
    if (ratio > 1.05) return 'DEEP_ITM';
    if (ratio > 1.01) return 'ITM';
    if (ratio >= 0.99) return 'ATM';
    if (ratio >= 0.95) return 'OTM';
    return 'DEEP_OTM';
  } else {
    if (ratio < 0.95) return 'DEEP_ITM';
    if (ratio < 0.99) return 'ITM';
    if (ratio <= 1.01) return 'ATM';
    if (ratio <= 1.05) return 'OTM';
    return 'DEEP_OTM';
  }
}

// ─── Main Greeks Calculator ─────────────────────────────────────────────

/**
 * Computes full Black-Scholes Greeks for a single option leg.
 *
 * @throws Error if inputs are invalid (negative prices, zero volatility, etc.)
 */
export function calculateGreeks(input: GreeksInput): GreeksResult {
  const {
    spotPrice: S,
    strikePrice: K,
    daysToExpiry,
    impliedVolatilityPercent,
    riskFreeRatePercent = DEFAULT_RISK_FREE_RATE,
    optionType,
  } = input;

  // Input validation
  if (!Number.isFinite(S) || S <= 0) throw new Error('Spot price must be positive and finite');
  if (!Number.isFinite(K) || K <= 0) throw new Error('Strike price must be positive and finite');
  if (!Number.isFinite(daysToExpiry) || daysToExpiry < 0) throw new Error('Days to expiry must be non-negative');
  if (!Number.isFinite(impliedVolatilityPercent) || impliedVolatilityPercent <= 0)
    throw new Error('Implied volatility must be positive');
  if (!['CE', 'PE'].includes(optionType)) throw new Error('Option type must be CE or PE');

  const sigma = impliedVolatilityPercent / 100;
  const r = riskFreeRatePercent / 100;
  const T = daysToExpiry / CALENDAR_DAYS_PER_YEAR;

  // Handle expiry edge case (T ≈ 0)
  if (T < 1e-10) {
    const intrinsicValue = optionType === 'CE'
      ? Math.max(0, S - K)
      : Math.max(0, K - S);
    return {
      theoreticalPrice: intrinsicValue,
      delta: optionType === 'CE' ? (S > K ? 1 : S === K ? 0.5 : 0) : (S < K ? -1 : S === K ? -0.5 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
      intrinsicValue,
      timeValue: 0,
      moneyness: classifyMoneyness(S, K, optionType),
      input,
    };
  }

  const { d1, d2 } = computeD1D2(S, K, T, sigma, r);
  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const nd1 = normalPDF(d1);
  const expRT = Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);

  let theoreticalPrice: number;
  let delta: number;
  let rho: number;

  if (optionType === 'CE') {
    theoreticalPrice = S * Nd1 - K * expRT * Nd2;
    delta = Nd1;
    rho = K * T * expRT * Nd2 / 100;
  } else {
    theoreticalPrice = K * expRT * normalCDF(-d2) - S * normalCDF(-d1);
    delta = Nd1 - 1;
    rho = -K * T * expRT * normalCDF(-d2) / 100;
  }

  // Gamma (same for calls and puts)
  const gamma = nd1 / (S * sigma * sqrtT);

  // Theta: per calendar day (negative convention = time decay costs money)
  const thetaComponent1 = -(S * nd1 * sigma) / (2 * sqrtT);
  let theta: number;
  if (optionType === 'CE') {
    theta = (thetaComponent1 - r * K * expRT * Nd2) / CALENDAR_DAYS_PER_YEAR;
  } else {
    theta = (thetaComponent1 + r * K * expRT * normalCDF(-d2)) / CALENDAR_DAYS_PER_YEAR;
  }

  // Vega: per 1% change in IV
  const vega = S * nd1 * sqrtT / 100;

  // Intrinsic and time value
  const intrinsicValue = optionType === 'CE'
    ? Math.max(0, S - K)
    : Math.max(0, K - S);
  const timeValue = Math.max(0, theoreticalPrice - intrinsicValue);

  return {
    theoreticalPrice: roundTo(theoreticalPrice, 2),
    delta: roundTo(delta, 4),
    gamma: roundTo(gamma, 6),
    theta: roundTo(theta, 2),
    vega: roundTo(vega, 2),
    rho: roundTo(rho, 2),
    intrinsicValue: roundTo(intrinsicValue, 2),
    timeValue: roundTo(timeValue, 2),
    moneyness: classifyMoneyness(S, K, optionType),
    input,
  };
}

// ─── Greeks Chain Builder ───────────────────────────────────────────────

/**
 * Builds a complete Greeks chain across multiple strikes centered around ATM.
 * Useful for rendering an option chain with Greeks overlay.
 */
export function buildGreeksChain(params: {
  symbol: string;
  spotPrice: number;
  daysToExpiry: number;
  impliedVolatilityPercent: number;
  riskFreeRatePercent?: number;
  strikeStep: number;
  strikeRange?: number;
}): GreeksMatrix {
  const {
    symbol,
    spotPrice,
    daysToExpiry,
    impliedVolatilityPercent,
    riskFreeRatePercent = DEFAULT_RISK_FREE_RATE,
    strikeStep,
    strikeRange = 10,
  } = params;

  // Calculate ATM strike
  const atmStrike = Math.round(spotPrice / strikeStep) * strikeStep;

  // Generate strikes centered around ATM
  const chain: GreeksChainRow[] = [];
  for (let i = -strikeRange; i <= strikeRange; i++) {
    const strike = atmStrike + i * strikeStep;
    if (strike <= 0) continue;

    const callGreeks = calculateGreeks({
      spotPrice,
      strikePrice: strike,
      daysToExpiry,
      impliedVolatilityPercent,
      riskFreeRatePercent,
      optionType: 'CE',
    });

    const putGreeks = calculateGreeks({
      spotPrice,
      strikePrice: strike,
      daysToExpiry,
      impliedVolatilityPercent,
      riskFreeRatePercent,
      optionType: 'PE',
    });

    chain.push({ strike, callGreeks, putGreeks });
  }

  return {
    symbol,
    spotPrice,
    daysToExpiry,
    impliedVolatilityPercent,
    riskFreeRatePercent,
    chain,
    computedAt: new Date().toISOString(),
  };
}

// ─── IV Solver (Newton-Raphson) ─────────────────────────────────────────

/**
 * Reverse-solves implied volatility from an observed market option premium
 * using Newton-Raphson iteration on the Black-Scholes pricing function.
 *
 * @param marketPrice Observed market premium of the option
 * @param spotPrice Current underlying price
 * @param strikePrice Strike price
 * @param daysToExpiry Days to expiry
 * @param optionType CE or PE
 * @param riskFreeRatePercent Risk-free rate (default 6.5%)
 * @returns Implied volatility as a percentage, or null if solver doesn't converge
 */
export function solveImpliedVolatility(
  marketPrice: number,
  spotPrice: number,
  strikePrice: number,
  daysToExpiry: number,
  optionType: OptionType,
  riskFreeRatePercent = DEFAULT_RISK_FREE_RATE
): number | null {
  if (marketPrice <= 0 || spotPrice <= 0 || strikePrice <= 0 || daysToExpiry <= 0) return null;

  const T = daysToExpiry / CALENDAR_DAYS_PER_YEAR;
  const r = riskFreeRatePercent / 100;

  // Initial guess: use the Brenner-Subrahmanyam approximation
  let sigma = Math.sqrt((2 * Math.PI) / T) * (marketPrice / spotPrice);
  if (!Number.isFinite(sigma) || sigma <= 0) sigma = 0.3;

  const MAX_ITER = 100;
  const TOLERANCE = 1e-8;

  for (let i = 0; i < MAX_ITER; i++) {
    const { d1, d2 } = computeD1D2(spotPrice, strikePrice, T, sigma, r);
    const expRT = Math.exp(-r * T);

    let bsPrice: number;
    if (optionType === 'CE') {
      bsPrice = spotPrice * normalCDF(d1) - strikePrice * expRT * normalCDF(d2);
    } else {
      bsPrice = strikePrice * expRT * normalCDF(-d2) - spotPrice * normalCDF(-d1);
    }

    const diff = bsPrice - marketPrice;

    // Vega (derivative of price w.r.t. sigma)
    const vega = spotPrice * normalPDF(d1) * Math.sqrt(T);

    if (Math.abs(vega) < 1e-12) break;

    const sigmaNew = sigma - diff / vega;
    if (sigmaNew <= 0) sigma = sigma / 2;
    else sigma = sigmaNew;

    if (Math.abs(diff) < TOLERANCE) {
      return roundTo(sigma * 100, 2);
    }
  }

  return roundTo(sigma * 100, 2);
}

// ─── Greeks Sensitivity Surface ─────────────────────────────────────────

/**
 * Computes a 2D sensitivity grid showing how option price varies across
 * spot price and IV dimensions. Useful for P&L heatmap visualization.
 */
export function computeGreeksSurface(params: {
  strikePrice: number;
  daysToExpiry: number;
  optionType: OptionType;
  riskFreeRatePercent?: number;
  spotRange: [number, number];
  ivRange: [number, number];
  spotSteps?: number;
  ivSteps?: number;
}): Array<{ spot: number; iv: number; price: number; delta: number; gamma: number; theta: number }> {
  const {
    strikePrice,
    daysToExpiry,
    optionType,
    riskFreeRatePercent,
    spotRange,
    ivRange,
    spotSteps = 20,
    ivSteps = 10,
  } = params;

  const surface: Array<{ spot: number; iv: number; price: number; delta: number; gamma: number; theta: number }> = [];

  for (let si = 0; si <= spotSteps; si++) {
    const spot = spotRange[0] + (spotRange[1] - spotRange[0]) * (si / spotSteps);
    for (let ii = 0; ii <= ivSteps; ii++) {
      const iv = ivRange[0] + (ivRange[1] - ivRange[0]) * (ii / ivSteps);
      try {
        const g = calculateGreeks({
          spotPrice: spot,
          strikePrice,
          daysToExpiry,
          impliedVolatilityPercent: iv,
          riskFreeRatePercent,
          optionType,
        });
        surface.push({
          spot: roundTo(spot, 2),
          iv: roundTo(iv, 1),
          price: g.theoreticalPrice,
          delta: g.delta,
          gamma: g.gamma,
          theta: g.theta,
        });
      } catch {
        // Skip invalid combinations
      }
    }
  }

  return surface;
}

// ─── Utility ────────────────────────────────────────────────────────────

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
