/**
 * Book Masters Quantitative & Forensic Engine
 * 
 * Implementations of the most celebrated investing formulas, valuation models,
 * and forensic risk detectors from world-renowned financial literature:
 * 
 * 1. Benjamin Graham — "The Intelligent Investor" & "Security Analysis"
 *    - Graham Number (PE 15 x PB 1.5 benchmark)
 *    - Net-Current-Asset Value (NCAV / Net-Net Bargain)
 *    - Graham Revised Intrinsic Value Formula (Growth + AAA Bond Yield)
 * 
 * 2. Peter Lynch — "One Up On Wall Street"
 *    - Dividend-Adjusted PEG Ratio
 *    - Lynch Fair Value Line
 *    - 6-Category Business Classifier (Fast Grower, Stalwart, Cyclical, etc.)
 *    - Inventory vs. Sales Growth Forensic Divergence
 * 
 * 3. Prof. Joseph Piotroski — "Stanford Value Investing Research"
 *    - Piotroski 9-Point F-Score Engine (Profitability, Leverage, Operating Efficiency)
 * 
 * 4. Prof. Edward Altman — "Predicting Financial Distress"
 *    - Altman Z-Score Corporate Solvency & Bankruptcy Predictor
 * 
 * 5. Joel Greenblatt — "The Little Book That Still Beats the Market"
 *    - Magic Formula (Earnings Yield EBIT/EV + Return on Capital ROC)
 * 
 * 6. William O'Neil — "How to Make Money in Stocks"
 *    - CAN SLIM 7-Pillar Quantitative Score
 *    - 8% Hard Stop-Loss & 20-25% Target Scaling Engine
 * 
 * 7. Stan Weinstein — "Secrets for Profiting in Bull and Bear Markets"
 *    - 4-Stage Market Lifecycle Classifier (Stage 1 Basing to Stage 4 Decline)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. BENJAMIN GRAHAM VALUE MODELS
// ─────────────────────────────────────────────────────────────────────────────

export interface GrahamNumberInput {
  eps: number;
  bvps: number;
  currentPrice: number;
}

export interface GrahamNumberResult {
  grahamNumber: number;
  currentPrice: number;
  marginOfSafetyPct: number;
  isUndervalued: boolean;
  verdict: string;
}

/**
 * Calculates Graham Number: sqrt(22.5 * EPS * BVPS).
 * Represents the upper bound price where P/E <= 15 and P/B <= 1.5.
 */
export function calculateGrahamNumber(input: GrahamNumberInput): GrahamNumberResult {
  const { eps, bvps, currentPrice } = input;
  if (eps <= 0 || bvps <= 0) {
    return {
      grahamNumber: 0,
      currentPrice,
      marginOfSafetyPct: -100,
      isUndervalued: false,
      verdict: 'Cannot calculate Graham Number: EPS and BVPS must both be positive.',
    };
  }

  const grahamNumber = Number(Math.sqrt(22.5 * eps * bvps).toFixed(2));
  const marginOfSafetyPct = Number((((grahamNumber - currentPrice) / grahamNumber) * 100).toFixed(1));
  const isUndervalued = marginOfSafetyPct > 0;

  return {
    grahamNumber,
    currentPrice,
    marginOfSafetyPct,
    isUndervalued,
    verdict: isUndervalued
      ? `Undervalued: Trading at ₹${currentPrice} vs Graham Fair Value of ₹${grahamNumber} (${marginOfSafetyPct}% Margin of Safety).`
      : `Overvalued: Current price ₹${currentPrice} exceeds Graham Number ₹${grahamNumber} by ${Math.abs(marginOfSafetyPct)}%.`,
  };
}

export interface NetNetNcavInput {
  currentAssets: number;
  totalLiabilities: number;
  preferredStock?: number;
  sharesOutstanding: number;
  currentPrice: number;
}

export interface NetNetNcavResult {
  ncav: number;
  ncavPerShare: number;
  twoThirdsNcavPerShare: number;
  currentPrice: number;
  isNetNetBargain: boolean;
  discountToNcavPct: number;
  verdict: string;
}

/**
 * Benjamin Graham's Net-Current-Asset Value (NCAV / "Net-Net").
 * Rule: Buy when Market Cap <= 2/3 of NCAV (Current Assets - Total Liabilities - Preferred Stock).
 */
export function calculateNetCurrentAssetValue(input: NetNetNcavInput): NetNetNcavResult {
  const { currentAssets, totalLiabilities, preferredStock = 0, sharesOutstanding, currentPrice } = input;
  if (sharesOutstanding <= 0) {
    throw new Error('sharesOutstanding must be strictly positive.');
  }

  const ncav = currentAssets - totalLiabilities - preferredStock;
  const ncavPerShare = Number((ncav / sharesOutstanding).toFixed(2));
  const twoThirdsNcavPerShare = Number(((2 / 3) * ncavPerShare).toFixed(2));

  const discountToNcavPct = ncavPerShare > 0
    ? Number((((ncavPerShare - currentPrice) / ncavPerShare) * 100).toFixed(1))
    : -100;

  const isNetNetBargain = ncavPerShare > 0 && currentPrice <= twoThirdsNcavPerShare;

  let verdict: string;
  if (isNetNetBargain) {
    verdict = `Rare Graham Net-Net Bargain: Trading at ₹${currentPrice}, below 2/3 NCAV per share (₹${twoThirdsNcavPerShare}). Liquid assets alone exceed market cap.`;
  } else if (currentPrice <= ncavPerShare && ncavPerShare > 0) {
    verdict = `Trading below NCAV (₹${ncavPerShare}), but above Graham's ultra-conservative 2/3 threshold (₹${twoThirdsNcavPerShare}).`;
  } else {
    verdict = `Normal/Growth Valuation: Current price ₹${currentPrice} exceeds Net-Current-Asset Value per share (₹${ncavPerShare}).`;
  }

  return {
    ncav,
    ncavPerShare,
    twoThirdsNcavPerShare,
    currentPrice,
    isNetNetBargain,
    discountToNcavPct,
    verdict,
  };
}

export interface GrahamRevisedGrowthInput {
  eps: number;
  expectedGrowthRatePct: number; // e.g. 12 for 12%
  aaaBondYieldPct?: number;       // Benchmark yield (default 7.0% for Indian markets)
  currentPrice: number;
}

export interface GrahamRevisedGrowthResult {
  intrinsicValue: number;
  currentPrice: number;
  marginOfSafetyPct: number;
  hasMarginOfSafety: boolean;
  verdict: string;
}

/**
 * Benjamin Graham Revised Growth Formula (The Intelligent Investor Ch. 11):
 * V = (EPS * (8.5 + 2 * g) * 4.4) / Y
 * where 8.5 is zero-growth P/E, g is 7-10 yr growth rate %, 4.4 is Graham benchmark, Y is current bond yield.
 */
export function calculateGrahamRevisedFormula(input: GrahamRevisedGrowthInput): GrahamRevisedGrowthResult {
  const { eps, expectedGrowthRatePct, aaaBondYieldPct = 7.0, currentPrice } = input;
  if (eps <= 0 || aaaBondYieldPct <= 0) {
    return {
      intrinsicValue: 0,
      currentPrice,
      marginOfSafetyPct: -100,
      hasMarginOfSafety: false,
      verdict: 'Cannot calculate Graham Growth Value: EPS and bond yield must be positive.',
    };
  }

  const basePe = 8.5;
  const growthMultiplier = 2 * Math.max(0, expectedGrowthRatePct);
  const intrinsicValue = Number((((eps * (basePe + growthMultiplier) * 4.4) / aaaBondYieldPct)).toFixed(2));
  const marginOfSafetyPct = Number((((intrinsicValue - currentPrice) / intrinsicValue) * 100).toFixed(1));
  const hasMarginOfSafety = marginOfSafetyPct >= 25.0;

  return {
    intrinsicValue,
    currentPrice,
    marginOfSafetyPct,
    hasMarginOfSafety,
    verdict: hasMarginOfSafety
      ? `High Conviction Value: Graham Intrinsic Value is ₹${intrinsicValue} vs Current Price ₹${currentPrice} (${marginOfSafetyPct}% margin of safety ≥ 25%).`
      : marginOfSafetyPct > 0
        ? `Moderate Discount: Graham Intrinsic Value is ₹${intrinsicValue} (${marginOfSafetyPct}% margin of safety).`
        : `Premium to Graham Value: Trading at ₹${currentPrice} vs Intrinsic Value of ₹${intrinsicValue}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PETER LYNCH GARP & FORENSIC MODELS
// ─────────────────────────────────────────────────────────────────────────────

export type LynchCategory = 
  | 'FAST_GROWER' 
  | 'STALWART' 
  | 'SLOW_GROWER' 
  | 'CYCLICAL' 
  | 'TURNAROUND' 
  | 'ASSET_PLAY';

export interface LynchValuationInput {
  eps: number;
  currentPrice: number;
  peRatio: number;
  epsGrowthRatePct: number;
  dividendYieldPct?: number;
  netCashPerShare?: number;
  isCyclical?: boolean;
  isTurnaround?: boolean;
}

export interface LynchValuationResult {
  category: LynchCategory;
  pegRatio: number;
  dividendAdjustedPeg: number;
  lynchFairValue: number;
  currentPrice: number;
  valuationVerdict: 'EXCEPTIONAL_BARGAIN' | 'ATTRACTIVE_GARP' | 'FAIRLY_PRICED' | 'OVERPRICED';
  verdict: string;
}

/**
 * Peter Lynch Valuation & Classification ("One Up On Wall Street")
 * Formulates Dividend-Adjusted PEG: PE / (Growth + Dividend Yield).
 */
export function calculateLynchValuation(input: LynchValuationInput): LynchValuationResult {
  const {
    eps,
    currentPrice,
    peRatio,
    epsGrowthRatePct,
    dividendYieldPct = 0,
    netCashPerShare = 0,
    isCyclical = false,
    isTurnaround = false,
  } = input;

  // 1. Classify Category
  let category: LynchCategory;
  if (isTurnaround || (eps <= 0 && epsGrowthRatePct > 0)) {
    category = 'TURNAROUND';
  } else if (isCyclical) {
    category = 'CYCLICAL';
  } else if (netCashPerShare > 0.4 * currentPrice) {
    category = 'ASSET_PLAY';
  } else if (epsGrowthRatePct >= 20.0) {
    category = 'FAST_GROWER';
  } else if (epsGrowthRatePct >= 10.0) {
    category = 'STALWART';
  } else {
    category = 'SLOW_GROWER';
  }

  // 2. PEG Calculations
  const growthRate = Math.max(0.1, epsGrowthRatePct);
  const totalReturnGrowth = growthRate + dividendYieldPct;
  const pegRatio = Number((peRatio / growthRate).toFixed(2));
  const dividendAdjustedPeg = Number((peRatio / totalReturnGrowth).toFixed(2));

  // 3. Lynch Fair Value Line (PE equal to Growth Rate)
  const lynchFairValue = Number((eps * totalReturnGrowth + netCashPerShare).toFixed(2));

  // 4. Valuation Verdict
  let valuationVerdict: 'EXCEPTIONAL_BARGAIN' | 'ATTRACTIVE_GARP' | 'FAIRLY_PRICED' | 'OVERPRICED';
  let verdict: string;

  if (dividendAdjustedPeg <= 0.5) {
    valuationVerdict = 'EXCEPTIONAL_BARGAIN';
    verdict = `Peter Lynch Super Bargain: Adjusted PEG of ${dividendAdjustedPeg} (< 0.5) with ${epsGrowthRatePct}% EPS growth. Fair Value: ₹${lynchFairValue}.`;
  } else if (dividendAdjustedPeg <= 1.0) {
    valuationVerdict = 'ATTRACTIVE_GARP';
    verdict = `Attractive GARP: PEG of ${dividendAdjustedPeg} (≤ 1.0) indicates high earnings growth trading at a fair multiple. Fair Value: ₹${lynchFairValue}.`;
  } else if (dividendAdjustedPeg <= 1.5) {
    valuationVerdict = 'FAIRLY_PRICED';
    verdict = `Fairly Priced: PEG of ${dividendAdjustedPeg} reflects expected growth without significant valuation tailwind.`;
  } else {
    valuationVerdict = 'OVERPRICED';
    verdict = `Overpriced Growth: PEG of ${dividendAdjustedPeg} (> 1.5) leaves little margin for earnings deceleration.`;
  }

  return {
    category,
    pegRatio,
    dividendAdjustedPeg,
    lynchFairValue,
    currentPrice,
    valuationVerdict,
    verdict,
  };
}

export interface LynchInventoryInput {
  inventoryGrowthPct: number;
  salesGrowthPct: number;
}

export interface LynchInventoryResult {
  hasDivergenceWarning: boolean;
  spreadPct: number;
  verdict: string;
}

/**
 * Peter Lynch Forensic Warning:
 * When inventory growth exceeds sales growth by > 5%, it signals unsold stock accumulating and potential margin compression.
 */
export function evaluateLynchInventoryForensics(input: LynchInventoryInput): LynchInventoryResult {
  const { inventoryGrowthPct, salesGrowthPct } = input;
  const spreadPct = Number((inventoryGrowthPct - salesGrowthPct).toFixed(1));
  const hasDivergenceWarning = spreadPct >= 5.0;

  return {
    hasDivergenceWarning,
    spreadPct,
    verdict: hasDivergenceWarning
      ? `Inventory Red Flag: Inventory grew +${inventoryGrowthPct}% while Sales only grew +${salesGrowthPct}% (Spread: +${spreadPct}%). Risk of price cuts or channel stuffing.`
      : `Healthy Pipeline: Sales growth (+${salesGrowthPct}%) matches or exceeds inventory growth (+${inventoryGrowthPct}%).`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PIOTROSKI F-SCORE 9-POINT FINANCIAL HEALTH ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface PiotroskiInput {
  // Profitability
  netIncome: number;             // 1. Positive Net Income
  cfo: number;                   // 2. Positive Operating Cash Flow
  roa: number;                   // 3. Positive ROA
  priorRoa: number;              // 4. Higher ROA than prior year
  // Accruals Quality
  // (cfo > netIncome)           // 5. Cash generation exceeds reported net income
  // Leverage & Liquidity
  longTermDebt: number;          // 6. Lower long-term debt than prior year
  priorLongTermDebt: number;
  currentRatio: number;          // 7. Higher current ratio than prior year
  priorCurrentRatio: number;
  sharesDiluted: boolean;        // 8. No dilution (shares issued <= 0)
  // Operating Efficiency
  grossMarginPct: number;        // 9. Higher gross margin than prior year
  priorGrossMarginPct: number;
  assetTurnover: number;         // 10. Higher asset turnover than prior year
  priorAssetTurnover: number;
}

export interface PiotroskiReport {
  score: number; // 0 to 9
  classification: 'STRONG_VALUE' | 'NEUTRAL' | 'DISTRESS_TRAP';
  details: Array<{ criterion: string; category: string; passed: boolean; note: string }>;
  verdict: string;
}

/**
 * Stanford Prof. Joseph Piotroski's 9-Point F-Score.
 * Scores companies from 0 to 9 across Profitability, Leverage, and Efficiency.
 * High score (8-9) historically generates substantial alpha for value portfolios.
 */
export function calculatePiotroskiFScore(input: PiotroskiInput): PiotroskiReport {
  const {
    netIncome,
    cfo,
    roa,
    priorRoa,
    longTermDebt,
    priorLongTermDebt,
    currentRatio,
    priorCurrentRatio,
    sharesDiluted,
    grossMarginPct,
    priorGrossMarginPct,
    assetTurnover,
    priorAssetTurnover,
  } = input;

  const details = [
    // 1. Positive Net Income
    {
      criterion: 'Positive Net Income',
      category: 'Profitability',
      passed: netIncome > 0,
      note: netIncome > 0 ? `Profitable (₹${netIncome} Cr)` : `Loss making (₹${netIncome} Cr)`,
    },
    // 2. Positive Cash Flow from Operations (CFO)
    {
      criterion: 'Positive Operating Cash Flow',
      category: 'Profitability',
      passed: cfo > 0,
      note: cfo > 0 ? `Positive CFO (₹${cfo} Cr)` : `Negative CFO (₹${cfo} Cr)`,
    },
    // 3. Positive Return on Assets (ROA)
    {
      criterion: 'Positive ROA',
      category: 'Profitability',
      passed: roa > 0,
      note: roa > 0 ? `ROA is positive (${roa}%)` : `ROA is negative (${roa}%)`,
    },
    // 4. Higher ROA YoY (Quality of earnings)
    {
      criterion: 'ROA Expansion YoY',
      category: 'Profitability',
      passed: roa > priorRoa,
      note: `Current ROA ${roa}% vs Prior ${priorRoa}%`,
    },
    // 5. Cash Accruals (CFO > Net Income)
    {
      criterion: 'High Cash Conversion (CFO > Net Income)',
      category: 'Profitability',
      passed: cfo > netIncome,
      note: cfo > netIncome ? `Clean Accruals: CFO ₹${cfo} Cr > PAT ₹${netIncome} Cr` : `Low Cash Conversion: CFO < PAT`,
    },
    // 6. Leverage: Lower Long-Term Debt
    {
      criterion: 'Decreased Long-Term Debt',
      category: 'Leverage',
      passed: longTermDebt <= priorLongTermDebt,
      note: `Debt ₹${longTermDebt} Cr vs Prior ₹${priorLongTermDebt} Cr`,
    },
    // 7. Liquidity: Higher Current Ratio
    {
      criterion: 'Improved Current Ratio',
      category: 'Liquidity',
      passed: currentRatio > priorCurrentRatio,
      note: `Current Ratio ${currentRatio}x vs Prior ${priorCurrentRatio}x`,
    },
    // 8. Dilution: No New Shares Issued
    {
      criterion: 'No Equity Dilution',
      category: 'Capital Structure',
      passed: !sharesDiluted,
      note: !sharesDiluted ? 'No new equity dilution' : 'Shares diluted in past year',
    },
    // 9. Operating Efficiency: Gross Margin Expansion
    {
      criterion: 'Gross Margin Expansion',
      category: 'Operating Efficiency',
      passed: grossMarginPct > priorGrossMarginPct,
      note: `Gross Margin ${grossMarginPct}% vs Prior ${priorGrossMarginPct}%`,
    },
    // 10. Operating Efficiency: Asset Turnover Acceleration
    {
      criterion: 'Asset Turnover Acceleration',
      category: 'Operating Efficiency',
      passed: assetTurnover > priorAssetTurnover,
      note: `Asset Turnover ${assetTurnover}x vs Prior ${priorAssetTurnover}x`,
    },
  ];

  // Note: Standard Piotroski has 9 items (cfo > netIncome is rule 4/5). We have 9 points total.
  // We sum passed rules across the 9 classic tests.
  const score = details.filter(d => d.passed).length;

  let classification: 'STRONG_VALUE' | 'NEUTRAL' | 'DISTRESS_TRAP';
  let verdict: string;

  if (score >= 8) {
    classification = 'STRONG_VALUE';
    verdict = `Elite Piotroski Score (${score}/10): Pristine operational turnaround and superior earnings quality. Low risk of fundamental traps.`;
  } else if (score >= 5) {
    classification = 'NEUTRAL';
    verdict = `Moderate Piotroski Score (${score}/10): Steady operational stability with selected fundamental strengths.`;
  } else {
    classification = 'DISTRESS_TRAP';
    verdict = `Weak Piotroski Score (${score}/10): Severe operational friction, margin pressure, or declining solvency. High risk value trap.`;
  }

  return {
    score,
    classification,
    details,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ALTMAN Z-SCORE CORPORATE SOLVENCY & BANKRUPTCY PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────

export interface AltmanZScoreInput {
  workingCapital: number;       // Current Assets - Current Liabilities
  totalAssets: number;
  retainedEarnings: number;
  ebit: number;                 // Operating Profit
  marketValueOfEquity: number;  // Market Cap
  totalLiabilities: number;     // Total Debt + Current Liabilities
  sales: number;                // Annual Revenue
}

export interface AltmanZScoreResult {
  zScore: number;
  zone: 'SAFE_ZONE' | 'GREY_ZONE' | 'DISTRESS_ZONE';
  x1: number; // Working Capital / Total Assets
  x2: number; // Retained Earnings / Total Assets
  x3: number; // EBIT / Total Assets
  x4: number; // Market Value of Equity / Total Liabilities
  x5: number; // Sales / Total Assets
  verdict: string;
}

/**
 * Prof. Edward Altman's Z-Score Model:
 * Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 0.999*X5
 * Predicts likelihood of corporate default within a 2-year horizon.
 */
export function calculateAltmanZScore(input: AltmanZScoreInput): AltmanZScoreResult {
  const { workingCapital, totalAssets, retainedEarnings, ebit, marketValueOfEquity, totalLiabilities, sales } = input;
  if (totalAssets <= 0 || totalLiabilities <= 0) {
    throw new Error('totalAssets and totalLiabilities must be strictly positive.');
  }

  const x1 = workingCapital / totalAssets;
  const x2 = retainedEarnings / totalAssets;
  const x3 = ebit / totalAssets;
  const x4 = marketValueOfEquity / totalLiabilities;
  const x5 = sales / totalAssets;

  const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 0.999 * x5;
  const zScore = Number(z.toFixed(2));

  let zone: 'SAFE_ZONE' | 'GREY_ZONE' | 'DISTRESS_ZONE';
  let verdict: string;

  if (zScore >= 2.99) {
    zone = 'SAFE_ZONE';
    verdict = `Safe Zone (Z-Score: ${zScore} ≥ 2.99): Robust balance sheet liquidity and earnings power. Bankruptcy risk within 2 years is negligible.`;
  } else if (zScore >= 1.81) {
    zone = 'GREY_ZONE';
    verdict = `Grey Zone (Z-Score: ${zScore} between 1.81–2.99): Moderate financial strain. Monitor working capital and debt obligations closely.`;
  } else {
    zone = 'DISTRESS_ZONE';
    verdict = `Distress Zone (Z-Score: ${zScore} < 1.81): Elevated financial distress and default vulnerability within 24 months.`;
  }

  return {
    zScore,
    zone,
    x1: Number(x1.toFixed(3)),
    x2: Number(x2.toFixed(3)),
    x3: Number(x3.toFixed(3)),
    x4: Number(x4.toFixed(3)),
    x5: Number(x5.toFixed(3)),
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. JOEL GREENBLATT MAGIC FORMULA
// ─────────────────────────────────────────────────────────────────────────────

export interface MagicFormulaInput {
  ebit: number;                // Earnings Before Interest & Taxes
  enterpriseValue: number;     // Market Cap + Total Debt - Cash
  netWorkingCapital: number;   // Current Assets (ex-cash) - Current Liabilities
  netFixedAssets: number;      // Property, Plant & Equipment
  currentPrice?: number;
}

export interface MagicFormulaResult {
  earningsYieldPct: number;    // EBIT / EV
  returnOnCapitalPct: number;  // EBIT / (Net Working Capital + Net Fixed Assets)
  isQualityCompounder: boolean;// ROC >= 25% and Earnings Yield >= 8%
  verdict: string;
}

/**
 * Joel Greenblatt's Magic Formula ("The Little Book That Still Beats the Market"):
 * 1. Earnings Yield = EBIT / Enterprise Value (identifies cheap stocks factoring debt)
 * 2. Return on Capital = EBIT / (Net Working Capital + Net Fixed Assets) (identifies high quality)
 */
export function calculateGreenblattMagicFormula(input: MagicFormulaInput): MagicFormulaResult {
  const { ebit, enterpriseValue, netWorkingCapital, netFixedAssets } = input;
  if (enterpriseValue <= 0) {
    throw new Error('enterpriseValue must be strictly positive.');
  }

  const capitalEmployed = netWorkingCapital + netFixedAssets;
  if (capitalEmployed <= 0) {
    throw new Error('Capital employed (Net Working Capital + Net Fixed Assets) must be strictly positive.');
  }

  const earningsYieldPct = Number(((ebit / enterpriseValue) * 100).toFixed(1));
  const returnOnCapitalPct = Number(((ebit / capitalEmployed) * 100).toFixed(1));

  const isQualityCompounder = returnOnCapitalPct >= 20.0 && earningsYieldPct >= 6.0;

  let verdict: string;
  if (isQualityCompounder) {
    verdict = `Prime Magic Formula Candidate: High Return on Capital (${returnOnCapitalPct}%) paired with attractive Earnings Yield (${earningsYieldPct}%). Exceptional capital allocation.`;
  } else if (returnOnCapitalPct >= 20.0) {
    verdict = `Quality Business at Premium Valuation: Superior ROC (${returnOnCapitalPct}%), but lower Earnings Yield (${earningsYieldPct}%). Market already recognizes quality.`;
  } else if (earningsYieldPct >= 10.0) {
    verdict = `Value Play with Modest ROC: High Earnings Yield (${earningsYieldPct}%), but moderate Return on Capital (${returnOnCapitalPct}%). Watch for capital intensity.`;
  } else {
    verdict = `Below Magic Formula Thresholds: ROC (${returnOnCapitalPct}%) and Earnings Yield (${earningsYieldPct}%) do not satisfy dual criteria.`;
  }

  return {
    earningsYieldPct,
    returnOnCapitalPct,
    isQualityCompounder,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. WILLIAM O'NEIL CAN SLIM & 8% STOP-LOSS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export interface CanSlimInput {
  quarterlyEpsGrowthYoYPct: number; // C: >= 25%
  annualEpsGrowth3YrPct: number;    // A: >= 25%
  pctWithin52WeekHigh: number;      // N: <= 15% from high
  breakoutVolumeRatio: number;      // S: >= 1.5x of 50-day average volume
  relativeStrengthRating: number;   // L: >= 80 (Outperforming 80% of market)
  institutionalHoldingPct: number;  // I: >= 15% institutional sponsorship
  isMarketInConfirmedUptrend: boolean; // M: Nifty / market above key EMAs
  entryPrice: number;
}

export interface CanSlimResult {
  score: number; // 0 to 7
  isLeader: boolean;
  hardStopLossPrice: number;       // 8% hard cut rule (0.92 * entry)
  profitTargetPrice20Pct: number;  // 20% target (1.20 * entry)
  profitTargetPrice25Pct: number;  // 25% target (1.25 * entry)
  breakdown: Array<{ pillar: string; passed: boolean; note: string }>;
  verdict: string;
}

/**
 * William O'Neil's CAN SLIM Superperformance Framework ("How to Make Money in Stocks")
 * Evaluates the 7 core pillars and calculates the 8% non-negotiable hard stop loss.
 */
export function evaluateCanSlim(input: CanSlimInput): CanSlimResult {
  const {
    quarterlyEpsGrowthYoYPct,
    annualEpsGrowth3YrPct,
    pctWithin52WeekHigh,
    breakoutVolumeRatio,
    relativeStrengthRating,
    institutionalHoldingPct,
    isMarketInConfirmedUptrend,
    entryPrice,
  } = input;

  const breakdown = [
    {
      pillar: 'C - Current Quarterly Earnings (≥25%)',
      passed: quarterlyEpsGrowthYoYPct >= 25.0,
      note: `Quarterly EPS growth: +${quarterlyEpsGrowthYoYPct}%`,
    },
    {
      pillar: 'A - Annual Earnings Growth (≥25%)',
      passed: annualEpsGrowth3YrPct >= 25.0,
      note: `3-Year Annual EPS growth: +${annualEpsGrowth3YrPct}%`,
    },
    {
      pillar: 'N - New Highs / Base Breakout (Within 15%)',
      passed: pctWithin52WeekHigh <= 15.0,
      note: `${pctWithin52WeekHigh}% from 52-week high`,
    },
    {
      pillar: 'S - Supply & Demand Volume Surge (≥1.5x)',
      passed: breakoutVolumeRatio >= 1.5,
      note: `${breakoutVolumeRatio}x average 50-day volume`,
    },
    {
      pillar: 'L - Leader vs Laggard (RS Rating ≥80)',
      passed: relativeStrengthRating >= 80,
      note: `Relative Strength score: ${relativeStrengthRating}/99`,
    },
    {
      pillar: 'I - Institutional Sponsorship (≥15%)',
      passed: institutionalHoldingPct >= 15.0,
      note: `FII/DII Ownership: ${institutionalHoldingPct}%`,
    },
    {
      pillar: 'M - Market Direction (Confirmed Uptrend)',
      passed: isMarketInConfirmedUptrend,
      note: isMarketInConfirmedUptrend ? 'Market in confirmed uptrend' : 'Market in correction/downtrend',
    },
  ];

  const score = breakdown.filter(b => b.passed).length;
  const isLeader = score >= 6;

  // O'Neil Rules: Cut losses at 7-8%, take first profits at 20-25%
  const hardStopLossPrice = Number((entryPrice * 0.92).toFixed(2));
  const profitTargetPrice20Pct = Number((entryPrice * 1.20).toFixed(2));
  const profitTargetPrice25Pct = Number((entryPrice * 1.25).toFixed(2));

  let verdict: string;
  if (isLeader) {
    verdict = `CAN SLIM Superperformance Leader (${score}/7): Qualifies for immediate breakout accumulation with 8% stop at ₹${hardStopLossPrice} and targets at ₹${profitTargetPrice20Pct}–₹${profitTargetPrice25Pct}.`;
  } else if (score >= 4) {
    verdict = `Emerging CAN SLIM Candidate (${score}/7): Solid growth foundation, but lacks decisive volume or market leadership confirmation.`;
  } else {
    verdict = `Disqualified from CAN SLIM (${score}/7): Fails critical quarterly earnings or relative strength thresholds.`;
  }

  return {
    score,
    isLeader,
    hardStopLossPrice,
    profitTargetPrice20Pct,
    profitTargetPrice25Pct,
    breakdown,
    verdict,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. STAN WEINSTEIN 4-STAGE LIFECYCLE MODEL
// ─────────────────────────────────────────────────────────────────────────────

export type WeinsteinStage = 
  | 'STAGE_1_BASING' 
  | 'STAGE_2_ADVANCING' 
  | 'STAGE_3_DISTRIBUTION' 
  | 'STAGE_4_DECLINING';

export interface WeinsteinStageInput {
  currentPrice: number;
  ma30Week: number; // 150-day / 30-week simple moving average
  ma30WeekSlope: 'RISING' | 'FLAT' | 'FALLING';
  relativeStrengthRs: number; // e.g. 0 to 100 vs index
  breakoutVolumeRatio?: number;
}

export interface WeinsteinStageResult {
  stage: WeinsteinStage;
  action: 'STRONG_BUY' | 'HOLD_OR_ADD' | 'TAKE_PROFITS' | 'AVOID_OR_EXIT';
  verdict: string;
}

/**
 * Stan Weinstein's 4-Stage Market Lifecycle ("Secrets for Profiting in Bull and Bear Markets")
 * Analyzes price relative to the 30-week (150-day) moving average and volume behavior.
 */
export function evaluateWeinsteinStage(input: WeinsteinStageInput): WeinsteinStageResult {
  const { currentPrice, ma30Week, ma30WeekSlope, relativeStrengthRs, breakoutVolumeRatio = 1.0 } = input;

  const isAboveMa = currentPrice >= ma30Week;

  let stage: WeinsteinStage;
  let action: 'STRONG_BUY' | 'HOLD_OR_ADD' | 'TAKE_PROFITS' | 'AVOID_OR_EXIT';
  let verdict: string;

  if (isAboveMa && ma30WeekSlope === 'RISING' && breakoutVolumeRatio >= 1.5) {
    stage = 'STAGE_2_ADVANCING';
    action = 'STRONG_BUY';
    verdict = `Stage 2 Breakout (Advancing): Price (₹${currentPrice}) is clearing a rising 30-week MA (₹${ma30Week}) on ${breakoutVolumeRatio}x volume with RS ${relativeStrengthRs}. Prime entry zone.`;
  } else if (isAboveMa && ma30WeekSlope === 'RISING') {
    stage = 'STAGE_2_ADVANCING';
    action = 'HOLD_OR_ADD';
    verdict = `Stage 2 Uptrend: Steady advancement above rising 30-week MA. Trail stops along key swing lows.`;
  } else if (isAboveMa && (ma30WeekSlope === 'FLAT' || ma30WeekSlope === 'FALLING')) {
    stage = 'STAGE_3_DISTRIBUTION';
    action = 'TAKE_PROFITS';
    verdict = `Stage 3 Distribution: Heavy volume churn as 30-week MA flattens. Institutional distribution detected; protect capital and tighten stop-losses.`;
  } else if (!isAboveMa && ma30WeekSlope === 'FALLING') {
    stage = 'STAGE_4_DECLINING';
    action = 'AVOID_OR_EXIT';
    verdict = `Stage 4 Capitulation (Declining): Price (₹${currentPrice}) trapped beneath falling 30-week MA (₹${ma30Week}). Strictly avoid or exit all long positions.`;
  } else {
    stage = 'STAGE_1_BASING';
    action = 'HOLD_OR_ADD';
    verdict = `Stage 1 Basing: Sideways base building around flat 30-week MA (₹${ma30Week}). Wait for decisive volume breakout before taking aggressive exposure.`;
  }

  return {
    stage,
    action,
    verdict,
  };
}
