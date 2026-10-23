import type { QuoteProvenance } from './market-quote';
export type MarketCapTier = 
  | 'Nano-Cap (< ₹500 Cr)'
  | 'Micro-Cap (< ₹1,500 Cr)'
  | 'Small-Cap (₹1,500–₹10,000 Cr)' 
  | 'Mid-Cap (₹10,000–₹35,000 Cr)' 
  | 'Large-Cap (> ₹35,000 Cr)';

export type ConvictionTier = 
  | 'ULTRA_CONVICTION' 
  | 'HIGH_GROWTH' 
  | 'EMERGING_COMPOUNDER';

export interface MultiBaggerPillars {
  capitalEfficiency: {
    roe: number;          // Return on Equity %
    roce: number;         // Return on Capital Employed %
    passed: boolean;
    verdict: string;
  };
  growthAcceleration: {
    salesGrowth3Y: number;  // 3-Year Sales CAGR %
    profitGrowth3Y: number; // 3-Year Profit CAGR %
    passed: boolean;
    verdict: string;
  };
  balanceSheetSolvency: {
    debtToEquity: number;    // D/E ratio
    interestCoverage: number; // x times
    passed: boolean;
    verdict: string;
  };
  institutionalFootprint: {
    fiiDiiHolding: number; // Total Institutional Holding %
    fiiQoQChange: number;  // QoQ Change %
    passed: boolean;
    verdict: 'HEAVY_ACCUMULATION' | 'STEADY_INFLOW' | 'STABLE';
  };
  valuationRunway: {
    peRatio: number;
    pegRatio: number;
    passed: boolean;
    verdict: string;
  };
  technicalStage: {
    stage: 'Stage-2 Continuation' | 'Stage-2 Cup & Handle Breakout' | 'High-Tight Flag' | 'Multi-Month Base Breakout';
    support200D: number;
    breakoutVolumeRatio: number;
    passed: boolean;
    verdict: string;
  };
}

export interface MultiBaggerCandidate extends Partial<QuoteProvenance> {
  ticker: string;
  symbol: string;
  name: string;
  sector: string;
  marketCapCategory: MarketCapTier;
  marketCapCr: number;
  currentPrice: number;
  entryPrice: number;
  target1Y: number;         // ~2x Target (+100%)
  target3Y: number;         // ~3x-5x Target (+200% to +400%)
  expectedMultiplier: string; // e.g. "3.5x Potential"
  stopLossLongTerm: number;  // Structural invalidation level
  multiBaggerScore: number;  // 0 - 100
  convictionTier: ConvictionTier;
  pillars: MultiBaggerPillars;
  pillarsPassedCount: number; // e.g. 6/6
  keyMoats: string[];
  catalysts: string[];
  risks: string[];
  investmentThesis: string;
}

export interface MultiBaggerResponse {
  success: boolean;
  count: number;
  generatedAt: string;
  marketContext: {
    macroCycle: string;
    smallCapIndexBreadth: string;
    averageScore: number;
  };
  data: MultiBaggerCandidate[];
}
