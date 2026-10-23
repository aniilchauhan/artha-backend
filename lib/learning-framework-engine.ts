import { sizePosition } from './position-sizing';

/**
 * Learning Framework Quantitative Engine
 * Implementations of core trading, forensic, and valuation rules extracted from
 * top stock market methodologies (SOIC, Vivek Bajaj, Zerodha, Subasish Pani,
 * Siddharth Bhanushali, Vishal Malkan, and Prof. Aswath Damodaran).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. RISK-FIRST POSITION SIZING & ATR STOPS (Zerodha Varsity & Rachana Ranade)
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionSizeParams {
  portfolioCapital: number;    // e.g. 1,000,000 INR
  riskPct?: number;            // Default 0.01 (1% per trade)
  entryPrice: number;          // e.g. 500
  stopLossPrice: number;       // e.g. 475
  maxPortfolioAllocationPct?: number; // e.g. 0.20 (max 20% capital in single stock)
  atr14?: number;              // 14-day Average True Range for volatility stops
}

export interface PositionSizeResult {
  sharesToBuy: number;
  totalInvestment: number;
  maxCapitalAtRisk: number;
  riskPerShare: number;
  allocationPct: number;
  atrTrailingStop?: number;
  isCappedByAllocation: boolean;
}

export function calculateRiskFirstPositionSize(params: PositionSizeParams): PositionSizeResult {
  const {
    portfolioCapital,
    riskPct = 0.01,
    entryPrice,
    stopLossPrice,
    maxPortfolioAllocationPct = 0.20,
    atr14,
  } = params;

  if (entryPrice <= 0 || stopLossPrice <= 0 || stopLossPrice >= entryPrice) {
    throw new Error('Invalid entry or stop loss price: stopLossPrice must be positive and strictly below entryPrice for long positions.');
  }

  const result = sizePosition({ portfolioEquity: portfolioCapital, availableCash: portfolioCapital,
    entry: entryPrice, stop: stopLossPrice, riskFraction: riskPct, maxAllocationFraction: maxPortfolioAllocationPct,
    entryCostFraction: 0, exitCostFraction: 0, stopSlippageFraction: 0 });
  const riskPerShare = result.riskPerShare;
  const shares = result.quantity;
  const isCappedByAllocation = Math.floor(portfolioCapital * riskPct / riskPerShare) > shares;
  const totalInvestment = result.investment;
  const maxCapitalAtRisk = result.plannedLoss;
  const allocationPct = result.allocationFraction * 100;

  // Legacy field name retained for compatibility; this is an initial estimate, not a trail.
  const atrTrailingStop = atr14 != null && Number.isFinite(atr14) && atr14 > 0 && entryPrice > 2 * atr14
    ? entryPrice - (2.0 * atr14) : undefined;

  return {
    sharesToBuy: Math.max(0, shares),
    totalInvestment,
    maxCapitalAtRisk,
    riskPerShare,
    allocationPct,
    atrTrailingStop,
    isCappedByAllocation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SOIC FORENSIC ACCOUNTING AUDITOR (Ishmohit Arora / SOIC)
// ─────────────────────────────────────────────────────────────────────────────

export interface SOICForensicInput {
  cumulativeCFO5Y: number;               // 5-Year Cumulative Operating Cash Flow
  cumulativePAT5Y: number;               // 5-Year Cumulative Profit After Tax
  promoterPledgePct: number;             // e.g. 5 for 5%
  rptToSalesPct: number;                 // Related Party Transactions % of total sales
  cwipYears: number;                     // Years Capital Work In Progress has been stagnant
  contingentLiabilitiesPctNetWorth: number; // Contingent liabilities as % of Net Worth
  auditorRemarks: 'CLEAN' | 'QUALIFIED' | 'ADVERSE' | 'RESIGNED';
}

export interface SOICForensicReport {
  score: number;             // 0 - 100
  passed: boolean;           // True if no critical red flags
  criticalFlags: string[];   // Hard disqualifications
  warnings: string[];        // Potential concerns
  cfoToPatRatio: number;
}

export function evaluateSOICForensics(input: SOICForensicInput): SOICForensicReport {
  const criticalFlags: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // 1. Cash Conversion (CFO / PAT)
  const cfoToPatRatio = input.cumulativePAT5Y > 0
    ? input.cumulativeCFO5Y / input.cumulativePAT5Y
    : (input.cumulativeCFO5Y > 0 ? 1.0 : 0.0);

  if (cfoToPatRatio < 0.70) {
    criticalFlags.push(`Critical Cash Trap: 5-Year CFO/PAT ratio is ${cfoToPatRatio.toFixed(2)} (< 0.70 threshold). Potential earnings inflation or uncollected debtors.`);
    score -= 35;
  } else if (cfoToPatRatio < 0.85) {
    warnings.push(`Moderate Cash Lag: CFO/PAT ratio is ${cfoToPatRatio.toFixed(2)} (benchmark is ≥ 0.85).`);
    score -= 15;
  }

  // 2. Promoter Pledge
  if (input.promoterPledgePct > 20) {
    criticalFlags.push(`High Promoter Pledge (${input.promoterPledgePct}%): Vulnerable to margin calls and sudden lower circuit cascades.`);
    score -= 30;
  } else if (input.promoterPledgePct > 5) {
    warnings.push(`Promoter Pledge Notice (${input.promoterPledgePct}%): Acceptable below 20%, but non-zero pledge requires monitoring.`);
    score -= 10;
  }

  // 3. Related Party Transactions
  if (input.rptToSalesPct > 10) {
    criticalFlags.push(`High Related Party Transactions (${input.rptToSalesPct}% of sales): Risk of promoter cash siphoning.`);
    score -= 25;
  } else if (input.rptToSalesPct > 5) {
    warnings.push(`Elevated Related Party Transactions (${input.rptToSalesPct}% of sales).`);
    score -= 10;
  }

  // 4. Stagnant CWIP
  if (input.cwipYears >= 4) {
    criticalFlags.push(`Stagnant CWIP (${input.cwipYears} years): Potential fictitious CapEx parked in Work-in-Progress without commercialization.`);
    score -= 20;
  } else if (input.cwipYears >= 3) {
    warnings.push(`CWIP aging elevated at ${input.cwipYears} years.`);
    score -= 5;
  }

  // 5. Contingent Liabilities
  if (input.contingentLiabilitiesPctNetWorth > 25) {
    criticalFlags.push(`Excessive Contingent Liabilities (${input.contingentLiabilitiesPctNetWorth}% of Net Worth): Risk of solvency shock from legal/tax disputes.`);
    score -= 20;
  } else if (input.contingentLiabilitiesPctNetWorth > 10) {
    warnings.push(`Contingent liabilities elevated at ${input.contingentLiabilitiesPctNetWorth}% of Net Worth.`);
    score -= 5;
  }

  // 6. Auditor Integrity
  if (input.auditorRemarks === 'RESIGNED' || input.auditorRemarks === 'ADVERSE') {
    criticalFlags.push(`Auditor Red Flag: Auditor gave ${input.auditorRemarks} opinion or abruptly resigned.`);
    score -= 40;
  } else if (input.auditorRemarks === 'QUALIFIED') {
    warnings.push('Auditor provided a Qualified opinion; read footnotes carefully.');
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  const passed = criticalFlags.length === 0 && score >= 60;

  return {
    score,
    passed,
    criticalFlags,
    warnings,
    cfoToPatRatio,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RSI 60-40 RANGE SHIFT & GFS SYSTEM (Vishal Malkan / Andrew Cardwell)
// ─────────────────────────────────────────────────────────────────────────────

export interface RsiRangeShiftInput {
  monthlyRSI: number;  // Grandfather
  weeklyRSI: number;   // Father
  dailyRSI: number;    // Son
}

export type GfsSetupSignal =
  | 'BULLISH_GFS_PULLBACK'   // M>60, W>60, D near 40-45 (Ideal buy)
  | 'BULLISH_SUPER_MOMENTUM' // M>60, W>60, D>60
  | 'BEARISH_GFS_RALLY'      // M<40, W<40, D near 55-60 (Ideal short)
  | 'SIDEWAYS_CONSOLIDATION'
  | 'NO_SETUP';

export interface RsiRangeShiftResult {
  signal: GfsSetupSignal;
  marketRegime: 'BULLISH_EXPANSION' | 'BEARISH_CONTRACTION' | 'NEUTRAL';
  conviction: 'HIGH' | 'MEDIUM' | 'NONE';
  description: string;
}

export function evaluateRsiRangeShift(input: RsiRangeShiftInput): RsiRangeShiftResult {
  const { monthlyRSI, weeklyRSI, dailyRSI } = input;

  const isBullishMacro = monthlyRSI >= 60 && weeklyRSI >= 60;
  const isBearishMacro = monthlyRSI <= 40 && weeklyRSI <= 40;

  if (isBullishMacro) {
    if (dailyRSI >= 38 && dailyRSI <= 48) {
      return {
        signal: 'BULLISH_GFS_PULLBACK',
        marketRegime: 'BULLISH_EXPANSION',
        conviction: 'HIGH',
        description: 'Prime Dip-Buying Setup: Monthly & Weekly are in Bull Range (>60), Daily pulled back to dynamic support at 40-45.',
      };
    }
    if (dailyRSI > 60) {
      return {
        signal: 'BULLISH_SUPER_MOMENTUM',
        marketRegime: 'BULLISH_EXPANSION',
        conviction: 'MEDIUM',
        description: 'Full Momentum Expansion: All three timeframes above 60. Ride with trailing stop; do not chase new breakouts if overextended.',
      };
    }
  }

  if (isBearishMacro) {
    if (dailyRSI >= 52 && dailyRSI <= 62) {
      return {
        signal: 'BEARISH_GFS_RALLY',
        marketRegime: 'BEARISH_CONTRACTION',
        conviction: 'HIGH',
        description: 'Prime Shorting Setup: Monthly & Weekly are Bearish (<40), Daily rallied into 55-60 dynamic resistance zone.',
      };
    }
  }

  if (monthlyRSI >= 40 && monthlyRSI <= 60 && weeklyRSI >= 40 && weeklyRSI <= 60) {
    return {
      signal: 'SIDEWAYS_CONSOLIDATION',
      marketRegime: 'NEUTRAL',
      conviction: 'NONE',
      description: 'Chop Zone: Price trapped in the 40-60 sideways consolidation band. Avoid directional trend bets.',
    };
  }

  return {
    signal: 'NO_SETUP',
    marketRegime: 'NEUTRAL',
    conviction: 'NONE',
    description: 'Timeframes are in conflict; wait for clean Grandfather-Father alignment.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 44 SMA DUAL-TIMEFRAME SWING SETUP (Siddharth Bhanushali)
// ─────────────────────────────────────────────────────────────────────────────

export interface Sma44Input {
  currentPrice: number;
  daily44Sma: number;
  daily44SmaPrev: number;       // 5 days ago to confirm slope
  weekly44Sma: number;
  weekly44SmaPrev: number;      // 2 weeks ago to confirm slope
  isBullishRejectionCandle: boolean; // Hammer or Engulfing testing 44 SMA
}

export interface Sma44Result {
  hasValidSetup: boolean;
  weeklySlopeUp: boolean;
  dailySlopeUp: boolean;
  isPullbackAtSma: boolean;
  initialStopLoss: number;
  verdict: string;
}

export function evaluate44SmaSwing(input: Sma44Input): Sma44Result {
  const weeklySlopeUp = input.weekly44Sma > input.weekly44SmaPrev;
  const dailySlopeUp = input.daily44Sma > input.daily44SmaPrev;

  // Price within 2.5% above or 1% below the 44 SMA
  const distancePct = ((input.currentPrice - input.daily44Sma) / input.daily44Sma) * 100;
  const isPullbackAtSma = distancePct >= -1.0 && distancePct <= 2.5;

  const hasValidSetup = weeklySlopeUp && dailySlopeUp && isPullbackAtSma && input.isBullishRejectionCandle;

  // Stop loss 1.5% below 44 SMA
  const initialStopLoss = Number((input.daily44Sma * 0.985).toFixed(2));

  let verdict = 'No Setup';
  if (!weeklySlopeUp) {
    verdict = 'Failed: Weekly 44 SMA is not trending upward.';
  } else if (!dailySlopeUp) {
    verdict = 'Failed: Daily 44 SMA is flat or downward sloping.';
  } else if (!isPullbackAtSma) {
    verdict = `Price is not testing the 44 SMA floor (${distancePct.toFixed(1)}% away).`;
  } else if (!input.isBullishRejectionCandle) {
    verdict = 'Waiting for bullish reversal confirmation candle at 44 SMA.';
  } else {
    verdict = 'Active Setup: Dual-timeframe 44 SMA bounce confirmed with bullish candle.';
  }

  return {
    hasValidSetup,
    weeklySlopeUp,
    dailySlopeUp,
    isPullbackAtSma,
    initialStopLoss,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ASWATH DAMODARAN DCF & MARGIN OF SAFETY MODEL (Prof. Aswath Damodaran)
// ─────────────────────────────────────────────────────────────────────────────

export interface DamodaranDcfInput {
  ebit: number;                     // Operating Profit
  taxRate: number;                  // e.g. 0.25 (25%)
  depreciation: number;             // Non-cash D&A
  capEx: number;                    // Capital Expenditures
  deltaWorkingCapital: number;       // Change in Non-Cash Working Capital
  forecastGrowthRate5Y: number;     // e.g. 0.15 (15% annual FCFF growth)
  terminalGrowthRate: number;       // Stable growth rate (max 0.065 for India)
  wacc: number;                     // Discount rate, e.g. 0.11 (11%)
  cashAndLiquidAssets: number;      // Cash & investments to add to EV
  totalDebt: number;                // Total debt to subtract from EV
  sharesOutstanding: number;        // Diluted share count
  currentMarketPrice: number;       // Current share price
}

export interface DamodaranDcfResult {
  baseFCFF: number;
  projectedFCFFs: number[];
  terminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  intrinsicValuePerShare: number;
  currentMarketPrice: number;
  marginOfSafetyPct: number;        // Positive means undervalued
  recommendation: 'STRONG_BUY' | 'FAIR_VALUE' | 'OVERVALUED';
}

export function calculateDamodaranDCF(input: DamodaranDcfInput): DamodaranDcfResult {
  const {
    ebit,
    taxRate,
    depreciation,
    capEx,
    deltaWorkingCapital,
    forecastGrowthRate5Y,
    terminalGrowthRate,
    wacc,
    cashAndLiquidAssets,
    totalDebt,
    sharesOutstanding,
    currentMarketPrice,
  } = input;

  if (wacc <= terminalGrowthRate) {
    throw new Error('WACC must be strictly greater than terminal growth rate to prevent infinite/negative valuation.');
  }

  // Damodaran rule: Perpetual terminal growth cannot exceed 6.5% for emerging markets (India)
  const cappedTerminalGrowth = Math.min(terminalGrowthRate, 0.065);

  // 1. Base Year FCFF
  const nopat = ebit * (1 - taxRate);
  const baseFCFF = nopat + depreciation - capEx - deltaWorkingCapital;

  // 2. Project 5-year FCFFs and compute Present Value
  const projectedFCFFs: number[] = [];
  let pvOfForecastCashFlows = 0;
  let runningFCFF = Math.max(0, baseFCFF);

  for (let year = 1; year <= 5; year++) {
    runningFCFF *= (1 + forecastGrowthRate5Y);
    projectedFCFFs.push(Number(runningFCFF.toFixed(2)));
    pvOfForecastCashFlows += runningFCFF / Math.pow(1 + wacc, year);
  }

  // 3. Terminal Value at Year 5 via Gordon Growth Model
  const terminalYearFCFF = runningFCFF * (1 + cappedTerminalGrowth);
  const terminalValue = terminalYearFCFF / (wacc - cappedTerminalGrowth);
  const pvOfTerminalValue = terminalValue / Math.pow(1 + wacc, 5);

  // 4. Enterprise Value & Equity Value
  const enterpriseValue = pvOfForecastCashFlows + pvOfTerminalValue;
  const equityValue = enterpriseValue + cashAndLiquidAssets - totalDebt;
  const intrinsicValuePerShare = Number((equityValue / sharesOutstanding).toFixed(2));

  // 5. Margin of Safety
  const marginOfSafetyPct = Number(
    (((intrinsicValuePerShare - currentMarketPrice) / intrinsicValuePerShare) * 100).toFixed(1)
  );

  let recommendation: 'STRONG_BUY' | 'FAIR_VALUE' | 'OVERVALUED';
  if (marginOfSafetyPct >= 25) {
    recommendation = 'STRONG_BUY'; // >= 25% discount to intrinsic value
  } else if (marginOfSafetyPct >= -10) {
    recommendation = 'FAIR_VALUE';
  } else {
    recommendation = 'OVERVALUED';
  }

  return {
    baseFCFF: Number(baseFCFF.toFixed(2)),
    projectedFCFFs,
    terminalValue: Number(terminalValue.toFixed(2)),
    enterpriseValue: Number(enterpriseValue.toFixed(2)),
    equityValue: Number(equityValue.toFixed(2)),
    intrinsicValuePerShare,
    currentMarketPrice,
    marginOfSafetyPct,
    recommendation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. BANKING & NBFC HEALTH AUDITOR (Yadnya Investment Academy)
// ─────────────────────────────────────────────────────────────────────────────

export interface BankingHealthInput {
  nim: number;         // Net Interest Margin % (e.g. 4.1)
  gnpa: number;        // Gross NPA % (e.g. 1.8)
  nnpa: number;        // Net NPA % (e.g. 0.4)
  casaRatio: number;   // CASA Deposit % (e.g. 44)
  pcr: number;         // Provision Coverage Ratio % (e.g. 76)
  car: number;         // Capital Adequacy Ratio % (e.g. 17.5)
}

export interface BankingHealthReport {
  score: number;       // 0 - 100
  assetQualityRating: 'PRISTINE' | 'MODERATE' | 'STRESSED' | 'CRITICAL';
  passed: boolean;
  criticalFlags: string[];
  strengths: string[];
}

export function evaluateBankingHealth(input: BankingHealthInput): BankingHealthReport {
  const criticalFlags: string[] = [];
  const strengths: string[] = [];
  let score = 100;

  // 1. Asset Quality (NNPA)
  if (input.nnpa > 1.5) {
    criticalFlags.push(`High Net NPA (${input.nnpa}% > 1.5% limit): Indicates deteriorating credit quality.`);
    score -= 30;
  } else if (input.nnpa <= 0.6) {
    strengths.push(`Pristine Net NPA of ${input.nnpa}% (Underwriting excellence).`);
  }

  // 2. Provision Coverage Ratio
  if (input.pcr < 65) {
    criticalFlags.push(`Insufficient Provision Coverage (${input.pcr}% < 65% benchmark): Bad loans not adequately cushioned.`);
    score -= 25;
  } else if (input.pcr >= 75) {
    strengths.push(`Robust Provision Coverage of ${input.pcr}%.`);
  }

  // 3. Low-Cost Deposit Base (CASA)
  if (input.casaRatio < 35) {
    criticalFlags.push(`Weak CASA Ratio (${input.casaRatio}% < 35%): Bank relies on high-cost wholesale deposits.`);
    score -= 20;
  } else if (input.casaRatio >= 42) {
    strengths.push(`Strong CASA franchise of ${input.casaRatio}%.`);
  }

  // 4. Net Interest Margin
  if (input.nim < 3.2) {
    score -= 15;
  } else if (input.nim >= 4.0) {
    strengths.push(`High Net Interest Margin of ${input.nim}%.`);
  }

  // 5. Capital Adequacy Ratio (Solvency)
  if (input.car < 13.0) {
    criticalFlags.push(`Low Capital Adequacy (${input.car}% near RBI minimum): Restricts future loan book expansion.`);
    score -= 20;
  } else if (input.car >= 16.0) {
    strengths.push(`Strong capital buffer with ${input.car}% CAR.`);
  }

  score = Math.max(0, Math.min(100, score));

  let assetQualityRating: 'PRISTINE' | 'MODERATE' | 'STRESSED' | 'CRITICAL';
  if (score >= 85) assetQualityRating = 'PRISTINE';
  else if (score >= 70) assetQualityRating = 'MODERATE';
  else if (score >= 50) assetQualityRating = 'STRESSED';
  else assetQualityRating = 'CRITICAL';

  return {
    score,
    assetQualityRating,
    passed: criticalFlags.length === 0 && score >= 65,
    criticalFlags,
    strengths,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CYCLICAL COMMODITY VALUATION (Dr. Sven Carlin)
// ─────────────────────────────────────────────────────────────────────────────

export interface CyclicalValuationInput {
  currentPrice: number;
  currentYearPE: number;
  marketCapCr: number;
  average10YearFCFCr: number;
  netCashPerShare: number;
}

export interface CyclicalValuationResult {
  normalizedPE: number;
  cycleRegime: 'CYCLE_PEAK_TRAP' | 'CYCLE_TROUGH_OPPORTUNITY' | 'MID_CYCLE';
  cashSafetyBufferPct: number;
  verdict: string;
}

export function evaluateCyclicalValuation(input: CyclicalValuationInput): CyclicalValuationResult {
  const normalizedPE = input.average10YearFCFCr > 0
    ? Number((input.marketCapCr / input.average10YearFCFCr).toFixed(1))
    : 999;

  const cashSafetyBufferPct = Number(((input.netCashPerShare / input.currentPrice) * 100).toFixed(1));

  let cycleRegime: 'CYCLE_PEAK_TRAP' | 'CYCLE_TROUGH_OPPORTUNITY' | 'MID_CYCLE';
  let verdict: string;

  if (input.currentYearPE > 0 && input.currentYearPE <= 6.0 && normalizedPE > 18.0) {
    cycleRegime = 'CYCLE_PEAK_TRAP';
    verdict = `Classic Cyclical Value Trap: Current P/E is optically cheap (${input.currentYearPE}x), but normalized 10-year P/E is ${normalizedPE}x. Profits are at cyclical peak; avoid or trim.`;
  } else if ((input.currentYearPE > 25.0 || input.currentYearPE <= 0) && normalizedPE <= 12.0) {
    cycleRegime = 'CYCLE_TROUGH_OPPORTUNITY';
    verdict = `Cyclical Trough Accumulation: Current P/E is depressed/negative due to industry downturn, but normalized P/E is attractive at ${normalizedPE}x with ${cashSafetyBufferPct}% cash backing.`;
  } else {
    cycleRegime = 'MID_CYCLE';
    verdict = `Mid-cycle valuation with normalized P/E of ${normalizedPE}x.`;
  }

  return {
    normalizedPE,
    cycleRegime,
    cashSafetyBufferPct,
    verdict,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 8. 5 EMA MEAN-REVERSION & MOMENTUM (Subasish Pani / Power of Stocks)
// ─────────────────────────────────────────────────────────────────────────────

export interface Ema5Input {
  timeframe: '5m' | '15m' | 'daily';
  candleHigh: number;
  candleLow: number;
  candleClose: number;
  ema5: number;
  subsequentPrice?: number;
}

export interface Ema5Result {
  isAlertCandle: boolean;
  setupDirection: 'SHORT' | 'LONG' | 'NONE';
  triggerPrice: number;
  stopLossPrice: number;
  targetPrice: number; // 1:3 R:R
  riskPerShare: number;
  isTriggered: boolean;
  verdict: string;
}

export function evaluate5EmaSetup(input: Ema5Input): Ema5Result {
  const { timeframe, candleHigh, candleLow, ema5, subsequentPrice } = input;

  // Short setup (5m): Candle Low strictly above 5 EMA
  if (timeframe === '5m' && candleLow > ema5) {
    const triggerPrice = candleLow;
    const stopLossPrice = candleHigh;
    const riskPerShare = Number((stopLossPrice - triggerPrice).toFixed(2));
    const targetPrice = Number((triggerPrice - (3 * riskPerShare)).toFixed(2));
    const isTriggered = subsequentPrice != null && subsequentPrice < triggerPrice;

    return {
      isAlertCandle: true,
      setupDirection: 'SHORT',
      triggerPrice,
      stopLossPrice,
      targetPrice,
      riskPerShare,
      isTriggered,
      verdict: isTriggered 
        ? `5 EMA Short Triggered below ₹${triggerPrice} (SL: ₹${stopLossPrice}, 1:3 Target: ₹${targetPrice}).`
        : `5 EMA Short Alert Candle: Sell if price drops below ₹${triggerPrice} (SL: ₹${stopLossPrice}).`,
    };
  }

  // Long setup (15m or daily): Candle High strictly below 5 EMA
  if ((timeframe === '15m' || timeframe === 'daily') && candleHigh < ema5) {
    const triggerPrice = candleHigh;
    const stopLossPrice = candleLow;
    const riskPerShare = Number((triggerPrice - stopLossPrice).toFixed(2));
    const targetPrice = Number((triggerPrice + (3 * riskPerShare)).toFixed(2));
    const isTriggered = subsequentPrice != null && subsequentPrice > triggerPrice;

    return {
      isAlertCandle: true,
      setupDirection: 'LONG',
      triggerPrice,
      stopLossPrice,
      targetPrice,
      riskPerShare,
      isTriggered,
      verdict: isTriggered
        ? `5 EMA Long Triggered above ₹${triggerPrice} (SL: ₹${stopLossPrice}, 1:3 Target: ₹${targetPrice}).`
        : `5 EMA Long Alert Candle: Buy if price breaks above ₹${triggerPrice} (SL: ₹${stopLossPrice}).`,
    };
  }

  return {
    isAlertCandle: false,
    setupDirection: 'NONE',
    triggerPrice: 0,
    stopLossPrice: 0,
    targetPrice: 0,
    riskPerShare: 0,
    isTriggered: false,
    verdict: `No 5 EMA setup: Candle is not detached from 5 EMA (High: ${candleHigh}, Low: ${candleLow}, 5 EMA: ${ema5}).`,
  };
}

export interface InsideBarInput {
  motherHigh: number;
  motherLow: number;
  babyHigh: number;
  babyLow: number;
  currentPrice: number;
}

export interface InsideBarResult {
  isInsideBar: boolean;
  breakoutSignal: 'BULLISH_BREAKOUT' | 'BEARISH_BREAKDOWN' | 'COMPRESSION_CONSOLIDATION' | 'INVALID_PATTERN';
  triggerLong: number;
  triggerShort: number;
  stopLossLong: number;
  stopLossShort: number;
  verdict: string;
}

export function evaluateInsideBar(input: InsideBarInput): InsideBarResult {
  const { motherHigh, motherLow, babyHigh, babyLow, currentPrice } = input;
  const isInsideBar = babyHigh <= motherHigh && babyLow >= motherLow && motherHigh > motherLow;

  if (!isInsideBar) {
    return {
      isInsideBar: false,
      breakoutSignal: 'INVALID_PATTERN',
      triggerLong: 0,
      triggerShort: 0,
      stopLossLong: 0,
      stopLossShort: 0,
      verdict: 'Not an Inside Bar pattern: Baby candle range exceeds Mother candle range.',
    };
  }

  const triggerLong = babyHigh;
  const triggerShort = babyLow;
  const stopLossLong = babyLow;
  const stopLossShort = babyHigh;

  let breakoutSignal: 'BULLISH_BREAKOUT' | 'BEARISH_BREAKDOWN' | 'COMPRESSION_CONSOLIDATION';
  let verdict: string;

  if (currentPrice > triggerLong) {
    breakoutSignal = 'BULLISH_BREAKOUT';
    verdict = `Bullish Inside Bar Breakout above ₹${triggerLong} (SL: ₹${stopLossLong}).`;
  } else if (currentPrice < triggerShort) {
    breakoutSignal = 'BEARISH_BREAKDOWN';
    verdict = `Bearish Inside Bar Breakdown below ₹${triggerShort} (SL: ₹${stopLossShort}).`;
  } else {
    breakoutSignal = 'COMPRESSION_CONSOLIDATION';
    verdict = `Inside Bar Volatility Compression: Awaiting breakout above ₹${triggerLong} or breakdown below ₹${triggerShort}.`;
  }

  return {
    isInsideBar: true,
    breakoutSignal,
    triggerLong,
    triggerShort,
    stopLossLong,
    stopLossShort,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. DUPONT ROE DECONSTRUCTION & 6% CIRCUIT BREAKER (Zerodha Varsity)
// ─────────────────────────────────────────────────────────────────────────────

export interface DuPontRoeInput {
  netProfit: number;
  sales: number;
  totalAssets: number;
  shareholdersEquity: number;
}

export interface DuPontRoeResult {
  roePct: number;
  netProfitMarginPct: number;
  assetTurnover: number;
  financialLeverage: number;
  qualityTier: 'HIGH_QUALITY_OPERATIONAL' | 'BALANCED' | 'DEBT_MANUFACTURED_RISK';
  verdict: string;
}

export function calculateDuPontRoe(input: DuPontRoeInput): DuPontRoeResult {
  const { netProfit, sales, totalAssets, shareholdersEquity } = input;
  if (sales <= 0 || totalAssets <= 0 || shareholdersEquity <= 0) {
    throw new Error('Sales, totalAssets, and shareholdersEquity must be strictly positive.');
  }

  const netProfitMargin = netProfit / sales;
  const assetTurnover = sales / totalAssets;
  const financialLeverage = totalAssets / shareholdersEquity;
  const roe = netProfitMargin * assetTurnover * financialLeverage;

  const roePct = Number((roe * 100).toFixed(2));
  const netProfitMarginPct = Number((netProfitMargin * 100).toFixed(2));
  const roundedAssetTurnover = Number(assetTurnover.toFixed(2));
  const roundedLeverage = Number(financialLeverage.toFixed(2));

  let qualityTier: 'HIGH_QUALITY_OPERATIONAL' | 'BALANCED' | 'DEBT_MANUFACTURED_RISK';
  let verdict: string;

  if (financialLeverage > 3.5 && netProfitMarginPct < 5.0) {
    qualityTier = 'DEBT_MANUFACTURED_RISK';
    verdict = `Dangerous ROE (${roePct}%): Low profit margin (${netProfitMarginPct}%) artificially amplified by high financial leverage (${roundedLeverage}x). Vulnerable in downturns.`;
  } else if (netProfitMarginPct >= 12.0 && assetTurnover >= 0.8) {
    qualityTier = 'HIGH_QUALITY_OPERATIONAL';
    verdict = `Pristine Quality ROE (${roePct}%): Driven by pricing power (${netProfitMarginPct}% margin) and efficient asset turnover (${roundedAssetTurnover}x).`;
  } else {
    qualityTier = 'BALANCED';
    verdict = `Balanced ROE (${roePct}%) with leverage of ${roundedLeverage}x and asset turnover of ${roundedAssetTurnover}x.`;
  }

  return {
    roePct,
    netProfitMarginPct,
    assetTurnover: roundedAssetTurnover,
    financialLeverage: roundedLeverage,
    qualityTier,
    verdict,
  };
}

export interface MonthlyCircuitBreakerInput {
  startingMonthlyCapital: number;
  realizedLossThisMonth: number;
  unrealizedLoss: number;
}

export interface MonthlyCircuitBreakerResult {
  totalLossAmount: number;
  lossPct: number;
  circuitBreakerTripped: boolean;
  action: 'HALT_ALL_NEW_TRADES' | 'TRADING_PERMITTED';
  remainingRiskRoomPct: number;
  verdict: string;
}

export function evaluateMonthlyCircuitBreaker(input: MonthlyCircuitBreakerInput): MonthlyCircuitBreakerResult {
  const { startingMonthlyCapital, realizedLossThisMonth, unrealizedLoss } = input;
  if (startingMonthlyCapital <= 0) {
    throw new Error('startingMonthlyCapital must be strictly positive.');
  }

  const totalLossAmount = Math.max(0, realizedLossThisMonth + Math.max(0, unrealizedLoss));
  const lossPct = Number(((totalLossAmount / startingMonthlyCapital) * 100).toFixed(2));
  const circuitBreakerTripped = lossPct >= 6.0;
  const remainingRiskRoomPct = Number(Math.max(0, 6.0 - lossPct).toFixed(2));

  return {
    totalLossAmount: Number(totalLossAmount.toFixed(2)),
    lossPct,
    circuitBreakerTripped,
    action: circuitBreakerTripped ? 'HALT_ALL_NEW_TRADES' : 'TRADING_PERMITTED',
    remainingRiskRoomPct,
    verdict: circuitBreakerTripped
      ? `6% Trader Circuit Breaker TRIGGERED: Monthly loss is ${lossPct}% (≥ 6.0%). Halt all new trade entries for the remainder of the calendar month to protect capital.`
      : `Trading Permitted: Monthly drawdown is ${lossPct}% (Risk buffer remaining: ${remainingRiskRoomPct}%).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. VALUE INVESTING & GRAHAM INTRINSIC VALUE (Finology / Pranjal Kamra)
// ─────────────────────────────────────────────────────────────────────────────

export interface GrahamFormulaInput {
  eps: number;
  bvps: number;
  currentPrice: number;
}

export interface GrahamFormulaResult {
  intrinsicValue: number;
  currentPrice: number;
  marginOfSafetyPct: number;
  has30PctMarginOfSafety: boolean;
  verdict: string;
}

export function calculateGrahamIntrinsicValue(input: GrahamFormulaInput): GrahamFormulaResult {
  const { eps, bvps, currentPrice } = input;
  if (eps <= 0 || bvps <= 0) {
    return {
      intrinsicValue: 0,
      currentPrice,
      marginOfSafetyPct: -100,
      has30PctMarginOfSafety: false,
      verdict: 'Cannot calculate Graham Value: EPS and BVPS must both be positive.',
    };
  }

  // Graham Formula: V = sqrt(22.5 * EPS * BVPS)
  const intrinsicValue = Number(Math.sqrt(22.5 * eps * bvps).toFixed(2));
  const marginOfSafetyPct = Number((((intrinsicValue - currentPrice) / intrinsicValue) * 100).toFixed(1));
  const has30PctMarginOfSafety = marginOfSafetyPct >= 30.0;

  return {
    intrinsicValue,
    currentPrice,
    marginOfSafetyPct,
    has30PctMarginOfSafety,
    verdict: has30PctMarginOfSafety
      ? `Undervalued: Trading at ₹${currentPrice} vs Graham Fair Value of ₹${intrinsicValue} (${marginOfSafetyPct}% Margin of Safety ≥ 30%).`
      : marginOfSafetyPct > 0
        ? `Near Fair Value: Graham Fair Value ₹${intrinsicValue} offers ${marginOfSafetyPct}% discount (below 30% margin threshold).`
        : `Overvalued: Current price ₹${currentPrice} exceeds Graham Fair Value ₹${intrinsicValue}.`,
  };
}

export interface Finology5RatiosInput {
  roe3YrAvgPct: number;          // Target: >= 15%
  debtToEquity: number;          // Target: < 0.5 (Strictly < 1.0)
  currentPE: number;
  pe5YrMedian: number;           // Target: PE <= 5Yr Median
  salesGrowth3YrCagrPct: number; // Target: >= 12%
  dividendPayoutPct: number;     // Target: 20% to 40%
}

export interface Finology5RatiosReport {
  score: number;                 // 0 to 5
  passedCount: number;
  passed: boolean;               // True if score >= 4
  isValueTrap: boolean;          // Low P/E with stagnant/negative growth
  items: Array<{ ratio: string; observed: string; benchmark: string; passed: boolean }>;
  verdict: string;
}

export function evaluateFinology5Ratios(input: Finology5RatiosInput): Finology5RatiosReport {
  const { roe3YrAvgPct, debtToEquity, currentPE, pe5YrMedian, salesGrowth3YrCagrPct, dividendPayoutPct } = input;

  const items = [
    {
      ratio: '3-Year Avg ROE',
      observed: `${roe3YrAvgPct}%`,
      benchmark: '≥ 15%',
      passed: roe3YrAvgPct >= 15.0,
    },
    {
      ratio: 'Debt-to-Equity',
      observed: `${debtToEquity}`,
      benchmark: '< 0.50 (Strictly < 1.0)',
      passed: debtToEquity < 0.50,
    },
    {
      ratio: 'P/E vs 5-Yr Median',
      observed: `${currentPE}x (Median: ${pe5YrMedian}x)`,
      benchmark: '≤ 5-Year Median P/E',
      passed: currentPE > 0 && currentPE <= pe5YrMedian,
    },
    {
      ratio: '3-Year Sales CAGR',
      observed: `${salesGrowth3YrCagrPct}%`,
      benchmark: '≥ 12%',
      passed: salesGrowth3YrCagrPct >= 12.0,
    },
    {
      ratio: 'Dividend Payout Ratio',
      observed: `${dividendPayoutPct}%`,
      benchmark: '20% to 40%',
      passed: dividendPayoutPct >= 20.0 && dividendPayoutPct <= 40.0,
    },
  ];

  const passedCount = items.filter(i => i.passed).length;
  const isValueTrap = currentPE > 0 && currentPE <= 10.0 && salesGrowth3YrCagrPct <= 2.0;

  let verdict = '';
  if (isValueTrap) {
    verdict = 'Value Trap Alert: Optically low P/E accompanied by stagnant sales growth; not a genuine bargain.';
  } else if (passedCount >= 4) {
    verdict = `High-Quality Compounding Candidate: Passes ${passedCount}/5 essential fundamental ratio benchmarks.`;
  } else {
    verdict = `Caution: Fails ${5 - passedCount}/5 fundamental benchmarks.`;
  }

  return {
    score: passedCount,
    passedCount,
    passed: passedCount >= 4 && !isValueTrap,
    isValueTrap,
    items,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. MINERVINI TREND TEMPLATE (Kristjan Qullamaggie & Mark Minervini)
// ─────────────────────────────────────────────────────────────────────────────

export interface MinerviniTrendTemplateInput {
  currentPrice: number;
  sma50: number;
  sma150: number;
  sma200: number;
  sma200TrendingUp: boolean;     // 200 SMA trending up for at least 1 month
  week52Low: number;
  week52High: number;
}

export interface MinerviniTrendTemplateResult {
  passed: boolean;
  failedRules: string[];
  passedRules: string[];
  pctAbove52WLow: number;
  pctWithin52WHigh: number;
  verdict: string;
}

export function evaluateMinerviniTrendTemplate(input: MinerviniTrendTemplateInput): MinerviniTrendTemplateResult {
  const { currentPrice, sma50, sma150, sma200, sma200TrendingUp, week52Low, week52High } = input;
  const failedRules: string[] = [];
  const passedRules: string[] = [];

  // Rule 1: Price > 150 SMA and 200 SMA
  if (currentPrice > sma150 && currentPrice > sma200) {
    passedRules.push('Price > 150 SMA and > 200 SMA');
  } else {
    failedRules.push('Price is below 150 SMA or 200 SMA (Stage 4 Downtrend risk)');
  }

  // Rule 2: 150 SMA > 200 SMA
  if (sma150 > sma200) {
    passedRules.push('150 SMA > 200 SMA');
  } else {
    failedRules.push('150 SMA is below 200 SMA');
  }

  // Rule 3: 200 SMA trending upwards
  if (sma200TrendingUp) {
    passedRules.push('200 SMA has been trending upwards for at least 1 month');
  } else {
    failedRules.push('200 SMA is flat or declining');
  }

  // Rule 4: 50 SMA > 150 SMA and > 200 SMA
  if (sma50 > sma150 && sma50 > sma200) {
    passedRules.push('50 SMA > 150 SMA and > 200 SMA (Momentum alignment)');
  } else {
    failedRules.push('50 SMA is below 150 SMA or 200 SMA');
  }

  // Rule 5: Price >= 30% above 52-week low
  const pctAbove52WLow = Number((((currentPrice - week52Low) / week52Low) * 100).toFixed(1));
  if (pctAbove52WLow >= 30.0) {
    passedRules.push(`Price is ${pctAbove52WLow}% above 52-week low (≥ 30%)`);
  } else {
    failedRules.push(`Price is only ${pctAbove52WLow}% above 52-week low (< 30% requirement)`);
  }

  // Rule 6: Price within 25% of 52-week high
  const pctWithin52WHigh = Number((((week52High - currentPrice) / week52High) * 100).toFixed(1));
  if (pctWithin52WHigh <= 25.0) {
    passedRules.push(`Price is within ${pctWithin52WHigh}% of 52-week high (≤ 25%)`);
  } else {
    failedRules.push(`Price is ${pctWithin52WHigh}% off 52-week high (> 25% away)`);
  }

  const passed = failedRules.length === 0;

  return {
    passed,
    failedRules,
    passedRules,
    pctAbove52WLow,
    pctWithin52WHigh,
    verdict: passed
      ? 'Confirmed Stage 2 Uptrend: Satisfies all Minervini Trend Template conditions for superperformance.'
      : `Disqualified from Stage 2: Failed ${failedRules.length} Trend Template rules.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. ROIIC & CAPITAL REINVESTMENT COMPOUNDING ENGINE (SOIC / Ishmohit Arora)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoiicInput {
  deltaNopat: number;            // Change in NOPAT over multi-year period
  deltaInvestedCapital: number;  // Change in Capital Employed over same period
  reinvestmentRatePct: number;   // % of earnings reinvested back into the business
}

export interface RoiicResult {
  roiicPct: number;
  compoundingRatePct: number;
  quadrant: 'MULTIBAGGER_SWEET_SPOT' | 'MATURE_CASH_COW' | 'CAPITAL_DESTROYER' | 'MODEST_GROWER';
  verdict: string;
}

export function calculateRoiic(input: RoiicInput): RoiicResult {
  const { deltaNopat, deltaInvestedCapital, reinvestmentRatePct } = input;
  if (deltaInvestedCapital <= 0) {
    throw new Error('deltaInvestedCapital must be strictly positive to calculate incremental return.');
  }

  const roiic = deltaNopat / deltaInvestedCapital;
  const roiicPct = Number((roiic * 100).toFixed(1));
  const compoundingRatePct = Number(((reinvestmentRatePct / 100) * roiicPct).toFixed(1));

  let quadrant: 'MULTIBAGGER_SWEET_SPOT' | 'MATURE_CASH_COW' | 'CAPITAL_DESTROYER' | 'MODEST_GROWER';
  let verdict: string;

  if (roiicPct >= 20.0 && reinvestmentRatePct >= 60.0) {
    quadrant = 'MULTIBAGGER_SWEET_SPOT';
    verdict = `Multibagger Sweet Spot: Consistently generating ${roiicPct}% ROIIC while reinvesting ${reinvestmentRatePct}% of profits (Compounding rate: ${compoundingRatePct}% p.a.).`;
  } else if (roiicPct >= 20.0 && reinvestmentRatePct < 60.0) {
    quadrant = 'MATURE_CASH_COW';
    verdict = `Mature Cash Cow: Excellent incremental return (${roiicPct}%), but low reinvestment runway (${reinvestmentRatePct}%). Likely high dividend payout.`;
  } else if (roiicPct < 12.0 && reinvestmentRatePct >= 50.0) {
    quadrant = 'CAPITAL_DESTROYER';
    verdict = `Capital Destroyer: Reinvesting heavily (${reinvestmentRatePct}%) into low-return assets (${roiicPct}% ROIIC < cost of capital).`;
  } else {
    quadrant = 'MODEST_GROWER';
    verdict = `Modest Compounder with ${roiicPct}% ROIIC and ${compoundingRatePct}% annual value compounding rate.`;
  }

  return {
    roiicPct,
    compoundingRatePct,
    quadrant,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. BOOK MASTERS QUANTITATIVE & FORENSIC SUITE
// ─────────────────────────────────────────────────────────────────────────────
export * from './book-master-engine';
