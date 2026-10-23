import type { CachedStock } from './stock-fetcher';

export type SmallCapExchange = 'NSE' | 'BSE' | 'all';

export interface SmallCapScorePillars {
  trend: number;
  volume: number;
  relativeStrength: number;
  riskPenalty: number;
}

export interface SmallCapStock extends CachedStock {
  providerSymbol: string;
  currency: 'INR';
  quoteAsOf: string;
  fetchedAt: string;
  dataSource: 'provider';
  exchange: 'NSE' | 'BSE';
  series?: string;
  isT2T?: boolean;
  marketCap: number; // Provider INR market capitalization converted to crores.
  marketCapSource: 'yahoo-finance';
  marketCapAsOf: string; // Metadata retrieval time; not a dated financial filing.
  price?: number;
  averageVolume?: number;
  historyCoverage: {
    completedSessions: number;
    requiredSessions: 20;
    sufficient: boolean;
  };
  // Quant & microstructure scoring fields
  convictionScore?: number;
  score?: number;
  isEligibleFor2Pct?: boolean;
  isHighConviction?: boolean;
  confidence?: 'low' | 'medium' | 'high';
  riskLevel?: 'low' | 'medium' | 'high';
  turnoverLakhs?: number;
  circuitHeadroomPercent?: number;
  circuitHeadroomPct?: number;
  isCircuitLocked?: boolean;
  lowerCircuitHeadroomPercent?: number;
  isLowerCircuitLocked?: boolean;
  asmGsmStage?: string | null;
  targetPrice?: number;
  stopLossPrice?: number;
  rewardRiskRatio?: number;
  signals?: string[];
  pillarScores?: SmallCapScorePillars;
  hasEarningsRisk?: boolean;
  daysToEarnings?: number;
  earningsSurprise?: 'beat' | 'miss' | 'inline';
  newsSentiment?: 'Bullish' | 'Bearish' | 'Neutral';
  optionsPcr?: number;
  isShortSqueezeSetup?: boolean;
  optionsSignal?: string;
}

/** Coverage counters describe only the current batch; catalog totals are not additive. */
export interface SmallCapScanCounts {
  totalCatalog: number;
  totalForExchange: number;
  scanned: number;
  quotesUnavailable: number;
  staleQuotes: number;
  unknownMarketCaps: number;
  notSmallCap: number;
  smallCaps: number;
  insufficientHistory: number;
}

export interface SmallCapScanResponse {
  exchange: SmallCapExchange;
  stocks: SmallCapStock[];
  counts: SmallCapScanCounts;
  offset: number;
  limit: number;
  nextOffset: number | null;
  complete: boolean;
  catalogOnly: boolean;
  fetchedAt: string;
  errors?: string[];
  /** Ordered identity fingerprint; cursors must not be combined across revisions. */
  catalogRevision?: string;
  catalogSource?: { name: string; path: string; url: string; snapshotDate?: string; sources?: Array<{ path: string; url: string }> };
}
