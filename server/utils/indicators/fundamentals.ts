/**
 * FUNDAMENTAL ANALYSIS INDICATORS SUITE (FUNDAMENTAL PROTOCOL)
 * 
 * DESIGN PROTOCOL:
 * Implements fundamental metric scoring algorithms that evaluate a stock based on real financial ratios:
 * Price-to-Earnings (P/E), Debt-to-Equity, Dividend Yield, and Year-over-Year (YoY) Revenue Growth.
 * This complements technical oscillators to provide a balanced macro + micro quantitative assessment.
 */

// Sector-specific average P/E ratios used for relative valuation checks
const SECTOR_AVERAGE_PE: Record<string, number> = {
  'Technology': 30.0,
  'Consumer Cyclical': 25.0,
  'Financials': 14.0,
  'Healthcare': 18.0,
  'Energy': 11.0,
};

/**
 * 1. RELATIVE PRICE-TO-EARNINGS (P/E) RATIO
 * Math in Plain English:
 * Compares the stock's current P/E ratio against its sector's historical average.
 *   - Stock P/E < Sector Average: The asset is undervalued relative to peers (Bullish)
 *   - Stock P/E > Sector Average * 1.4: The asset is trading at an overvaluation premium (Bearish)
 */
export function evaluatePERatio(peRatio: number, sector: string): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  details: string;
} {
  const averagePE = SECTOR_AVERAGE_PE[sector] || 20.0;
  
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (peRatio < averagePE * 0.85) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (peRatio > averagePE * 1.4) {
    signal = 'BEARISH';
    score = -1.0;
  } else {
    signal = 'NEUTRAL';
    score = 0;
  }
  
  const details = `P/E Ratio is ${peRatio}x compared to its sector average of ${averagePE}x. This represents a relative ${peRatio < averagePE ? 'valuation discount (attractive)' : 'premium (fully priced)'}.`;
  
  return { signal, score, details };
}

/**
 * 2. DEBT-TO-EQUITY RATIO (LEVERAGE SAFETY)
 * Math in Plain English:
 * Measures a company's total liabilities divided by its shareholder equity. It reveals
 * how much a company is relying on borrowed debt to finance its operations.
 *   - Ratio < 0.75: Minimal debt burden, excellent balance sheet health (Bullish)
 *   - Ratio > 1.8: Heavy leverage, high structural debt risk under tight credit cycles (Bearish)
 */
export function evaluateDebtToEquity(debtToEquity: number): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  details: string;
} {
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (debtToEquity < 0.8) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (debtToEquity > 1.8) {
    signal = 'BEARISH';
    score = -1.0;
  } else {
    signal = 'NEUTRAL';
    score = 0;
  }
  
  const details = `Debt-to-Equity is ${debtToEquity.toFixed(2)}. Ratios under 1.00 signify a clean balance sheet, whereas leverage ratios exceeding 1.80 increase credit sensitivity.`;
  
  return { signal, score, details };
}

/**
 * 3. DIVIDEND YIELD (INCOME SUPPORT)
 * Math in Plain English:
 * Shows what percentage of its share price a company pays out in annual dividends.
 * While growth companies may re-invest rather than pay dividends, a substantial dividend yield
 * (>3%) provides an income safety cushion that limits downside price depreciation.
 */
export function evaluateDividendYield(dividendYield: number): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  details: string;
} {
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (dividendYield >= 2.5) {
    signal = 'BULLISH';
    score = 0.8;
  } else if (dividendYield === 0) {
    signal = 'NEUTRAL';
    score = 0; // standard for high-growth Tech
  } else {
    signal = 'NEUTRAL';
    score = 0.2; // modest dividend floor
  }
  
  const details = `Dividend Yield is ${dividendYield.toFixed(2)}%. Consistent cash yields provide an income buffer and capital support during consolidation phases.`;
  
  return { signal, score, details };
}

/**
 * 4. REVENUE GROWTH (YoY SALES ACCELERATION)
 * Math in Plain English:
 * Tracks how fast a business is scaling its top-line sales year-over-year.
 *   - Revenue Growth > 15%: Rocketing scaling velocity, indicating strong customer demand (Bullish)
 *   - Revenue Growth < 0%: Sales contraction, warning of business decay (Bearish)
 */
export function evaluateRevenueGrowth(revenueGrowth: number): {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  details: string;
} {
  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let score = 0;
  
  if (revenueGrowth >= 15.0) {
    signal = 'BULLISH';
    score = 1.0;
  } else if (revenueGrowth < 0.0) {
    signal = 'BEARISH';
    score = -1.0;
  } else {
    signal = 'NEUTRAL';
    score = revenueGrowth / 30.0; // scales modestly
  }
  
  const details = `Year-over-Year Revenue Growth stands at ${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth.toFixed(1)}%. Rapid sales growth (> 15%) proves healthy business expansion.`;
  
  return { signal, score, details };
}
