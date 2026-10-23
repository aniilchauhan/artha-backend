import type { QuoteProvenance } from './market-quote';
export type PostIpoBreakoutStatus = 
  | 'BREAKOUT_TRIGGERED' 
  | 'NEAR_PIVOT_ACCUMULATION' 
  | 'BASE_CONSOLIDATION';

export type AnchorLockinStatus = 
  | 'ABSORBED_STRONG' 
  | 'IN_PROGRESS' 
  | 'PENDING_30D';

export interface PostIpoPrediction {
  ticker: string;
  symbol: string;
  predictedTarget15d?: number;         // T+15D Rapid Listing Breakout Target (+50% to +100%)
  predictedCurrentToT15Pct?: number;   // Expected % return over 1-2 weeks
  predictedTarget30d: number;          // T+30D Short-Term Breakout Target
  predictedCurrentToT30Pct: number;    // Expected % return over 30 days
  predictedTarget90d: number;          // T+90D Post-Anchor Absorption Target
  predictedCurrentToT90Pct: number;    // Expected % return over 90 days
  predictedTarget1yr: number;          // 1-Year Stage-1 Compounder Target
  predictedTarget1yrPct: number;       // 1-Year Multi-Bagger %
  invalidationStopLoss: number;        // Base low structural stop
  stopLossRiskPct: number;             // Max drawdown to invalidation
  riskRewardRatio: number;             // R:R Multiple
  winProbabilityPct: number;           // Microstructure win probability (0-100%)
  predictionModel: 'POST_IPO_STAGE1_ANCHOR_CALIBRATED';
  anchorUnlockScore: number;           // 0-100 Anchor absorption score
  baseTightnessScore: number;          // 0-100 Base tightness score
  flipperExhaustionIndex: number;      // 0-100 Flipper washout score
  ldhDistancePct: number;              // Proximity % to Listing Day High
  modelRationale: string[];            // Key reasons why this prediction differs from 200 DMA legacy models
  horizonTimelineWeeks: {
    t30Weeks: number;
    t90Weeks: number;
    t1yrWeeks: number;
  };
}

export interface PostIpoCandidate extends Partial<QuoteProvenance> {
  ticker: string;
  symbol: string;
  companyName: string;
  sector: string;
  listingDate: string;
  daysSinceListing: number;
  issuePrice: number;
  listingPrice: number;
  listingDayHigh: number;
  currentPrice: number;
  breakoutTriggerPrice: number; // Buy trigger above listing base
  target1: number;              // Short-term base target (+30% to +50%)
  targetMultiBagger: number;    // Long-term compounder target (+100% to +300%)
  stopLoss: number;             // Base invalidation stop
  expectedUpsidePct: number;    // Multi-bagger upside %
  breakoutStatus: PostIpoBreakoutStatus;
  anchorLockinStatus: AnchorLockinStatus;
  baseDurationWeeks: number;
  baseDepthPct: number;
  volumeSurgeRatio: number;
  convictionScore: number;      // 0 to 100
  institutionalOwnershipPct: number;
  promoterHoldingPct?: number;  // Promoter & Founders %
  fiiHoldingPct?: number;       // Foreign Institutional %
  diiHoldingPct?: number;       // Domestic Mutual Funds %
  retailHoldingPct?: number;    // Public & Retail %
  anchorSharesPercent?: number; // Total shares issued to anchor book
  anchorLockin30d?: { expiryDate: string; status: 'EXPIRED' | 'IMMINENT' | 'PENDING'; sharesPct: number; daysRemaining?: number };
  anchorLockin90d?: { expiryDate: string; status: 'EXPIRED' | 'IMMINENT' | 'PENDING'; sharesPct: number; daysRemaining?: number };
  anchorLockin180d?: { expiryDate: string; status: 'EXPIRED' | 'IMMINENT' | 'PENDING'; sharesPct: number; daysRemaining?: number };
  listingGainsPct?: number;
  ipoYear?: number;
  keyCatalysts: string[];
  risks: string[];
  setupSummary: string;
  livePrice?: number;
  dayChangePct?: number;
  isLiveFeed?: boolean;
  lastUpdated?: string;
  isFresh15DaySurge?: boolean;
  surgeTarget15d?: number;
  surgeTarget15dPct?: number;
  differentiatedPrediction?: PostIpoPrediction;
}

export interface PostIpoResponse {
  success: boolean;
  count: number;
  generatedAt: string;
  isLiveFeed?: boolean;
  liveSyncedAt?: string;
  marketStats: {
    averageBaseDurationWeeks: number;
    breakoutsTriggeredCount: number;
    settingUpCount: number;
    absorbedAnchorOverhangPct?: number;
    averageTotalGainsSinceIpoPct?: number;
  };
  data: PostIpoCandidate[];
}
