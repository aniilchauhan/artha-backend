export type OpportunityHorizon = 'today' | 'next';

export interface OptionsRecommendation {
  ticker: string;
  underlyingPrice: number;
  direction: 'LONG' | 'SHORT';
  optionType: 'CE' | 'PE';
  strikePrice: number;
  symbolFormatted: string;
  lotSize: number;
  recommendedLots: number;
  estimatedPremium: number;
  targetPremium: number;
  stopPremium: number;
  costPerLot: number;
  totalInvestmentInr: number;
  projectedProfitInr: number;
  maxRiskInr: number;
  expectedRoiPct: number;
  maxRiskPct: number;
  delta: number;
  executionGuideline: string;
}

export interface LeverageScenario {
  mode: 'CASH_1X' | 'MIS_5X' | 'OPTIONS_ATM';
  modeLabel: string;
  capitalAllocated: number;
  effectiveExposure: number;
  quantityOrLots: number;
  entryPriceOrPremium: number;
  targetPriceOrPremium: number;
  stopPriceOrPremium: number;
  expectedProfitInr: number;
  maxRiskInr: number;
  roiPct: number;
  riskPct: number;
  rewardRiskRatio: number;
  brokerOrderType: 'CNC / Delivery' | 'MIS (5x Intraday)' | 'NRML / F&O';
}

export interface LeverageDetails {
  capitalBase: number;
  cash1x: LeverageScenario;
  mis5x: LeverageScenario;
  optionsAtm: LeverageScenario;
}

export interface LiquidityAudit {
  isLiquid: boolean;
  status: 'VERIFIED_LIQUID' | 'LOW_TURNOVER' | 'CIRCUIT_RISK' | 'PENNY_STOCK' | 'LOW_VOLUME';
  label: string;
  badgeColor: 'emerald' | 'amber' | 'rose' | 'slate';
  warnings: string[];
  medianTurnoverCr?: number;
  avgVolume?: number;
  isPennyStock?: boolean;
  circuitRiskPct?: number;
}

export interface BookMasterSignalInfo {
  canSlimSetup?: boolean;
  weinsteinStage?: 'STAGE_1_BASING' | 'STAGE_2_ADVANCING' | 'STAGE_3_DISTRIBUTION' | 'STAGE_4_DECLINING';
  hardCutStopPrice?: number;
  extendedTargetPrice?: number;
  convictionAdjustmentPct?: number;
  badges: string[];
  riskWarnings: string[];
}

export interface ShareOpportunity {
  ticker: string;
  name: string;
  asOf: string;
  status: string;
  reference: number;
  target: number;
  stop?: number;
  entryCondition?: string;
  deadline?: string;
  targetVersion?: string;
  calibrationStatus?: string;
  netExpectancy?: string;
  estimate: number | null;
  evidenceCount: number;
  summary: string;
  positives: string[];
  risks: string[];
  metrics: { label: string; value: string }[];
  catalyst: string | null;
  direction?: 'LONG' | 'SHORT';
  targetTiers?: {
    tier: 'T1' | 'T2' | 'T3';
    label: string;
    price: number;
    returnPct: number;
  }[];
  maxPotentialPct?: number;
  potentialCategory?: 'scalp' | 'swing' | 'runner';
  optionsRecommendation?: OptionsRecommendation;
  leverageDetails?: LeverageDetails;
  liquidityAudit?: LiquidityAudit;
  bookMasterSignals?: BookMasterSignalInfo;
}

export interface ScanCoverageInfo {
  requestedUniverse: number;
  scanned: number;
  qualifyingSetups: number;
  condition4Count?: number;
  condition3Count?: number;
  condition2Count?: number;
  condition1Count?: number;
  universeName: string;
  asOfDate: string;
}

export interface QuoteAgeSummary {
  latestQuoteTime: string;
  oldestQuoteTime?: string;
  averageAgeMinutes?: number;
  isMarketOpen?: boolean;
}

export interface OpportunitiesResponse {
  success: true;
  horizon: OpportunityHorizon;
  fetchedAt: string;
  source: string;
  explanation: string;
  coverage: string;
  data: ShareOpportunity[];
  scanCoverage?: ScanCoverageInfo;
  quoteAgeSummary?: QuoteAgeSummary;
  auditedSummary?: {
    totalRecorded: number;
    totalReconciled: number;
    winRate: number | null;
    ece: number;
  };
}

