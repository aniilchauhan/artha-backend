export type GapDirection = 'GAP_UP' | 'GAP_DOWN' | 'FLAT';

export type GapClassification =
  | 'STRONG_GAP_UP'
  | 'MODERATE_GAP_UP'
  | 'MILD_GAP_UP'
  | 'FLAT'
  | 'MILD_GAP_DOWN'
  | 'MODERATE_GAP_DOWN'
  | 'STRONG_GAP_DOWN';

export type GapSetupType =
  | 'GAP_AND_GO'
  | 'GAP_FADE'
  | 'EXHAUSTION_GAP'
  | 'BREAKAWAY_GAP';

export function gapSetupLabel(setupType: GapSetupType): string {
  switch (setupType) {
    case 'GAP_AND_GO': return 'Price beyond open in gap direction';
    case 'GAP_FADE': return 'Price retraced across open';
    case 'EXHAUSTION_GAP': return 'At least 70% of gap filled';
    case 'BREAKAWAY_GAP': return 'Gap with high relative volume';
  }
}

export type GapFillStatus = 'FILLED' | 'PARTIALLY_FILLED' | 'UNFILLED';

export type GapRiskRating = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME_CHASE';

export interface GapTradeLevels {
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  rewardRiskRatio: number;
  maxRiskPercent: number;
  projectedProfitPercent: number;
  gapSlippageWarning: boolean;
}

export interface GapItem {
  ticker: string;
  symbol: string;
  name: string;
  sector: string;
  marketCap: number | null;
  marketCapCategory: 'LARGE_CAP' | 'MID_CAP' | 'SMALL_CAP' | 'UNKNOWN';
  previousClose: number;
  openPrice: number;
  currentPrice: number;
  highPrice: number;
  lowPrice: number;
  gapAmount: number;
  gapPercent: number;
  currentChangePercent: number;
  dayChangeFromOpenPercent: number;
  direction: GapDirection;
  classification: GapClassification;
  setupType: GapSetupType;
  fillStatus: GapFillStatus;
  fillPercent: number;
  volume: number;
  relativeVolume: number | null;
  tradeLevels: GapTradeLevels;
  riskRating: GapRiskRating;
  isExtendedGap: boolean; // Gap > 3%, violates chase filter per TARGET_SPECIFICATION
  analysisSummary: string;
}

export interface GapScreenSummary {
  totalScanned: number;
  totalGaps: number;
  gapUpCount: number;
  gapDownCount: number;
  filledCount: number;
  unfilledCount: number;
  avgGapPercent: number;
  maxGapUp: { symbol: string; percent: number } | null;
  maxGapDown: { symbol: string; percent: number } | null;
  gapAndGoCount: number;
  gapFadeCount: number;
  lastUpdated: string;
}

export interface GapScanSource {
  dataSource: 'provider';
  provider: 'Yahoo Finance chart';
  sessionDate: string;
  quoteAsOf: string;
  latestQuoteAsOf: string;
  evaluated: number;
  total: number;
}

export interface GapScreenerResponse {
  success: boolean;
  timestamp: string;
  summary: GapScreenSummary;
  items: GapItem[];
  source: GapScanSource;
}
