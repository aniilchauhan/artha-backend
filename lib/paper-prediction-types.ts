export type PredictionCohort =
  | 'COHORT_A_CLEAN_MODEL'
  | 'COHORT_B_MODEL_AND_FILINGS'
  | 'COHORT_C_MODEL_FILINGS_SOCIAL';

export interface ProspectiveObservation {
  id: string; // e.g. obs_2026-09-25_RELIANCE_COHORT_A
  ticker: string;
  symbol: string;
  cohort: PredictionCohort;
  modelVersion: string;
  predictedAt: string; // ISO 8601, must precede session open (09:15 IST)
  sessionDate: string; // YYYY-MM-DD
  referenceClose: number;
  rawProbability: number;
  calibratedProbability: number;
  indicativeTargetPrice: number; // typically +2.5% from reference close / open
  indicativeStopLossPrice: number; // conservative stop
  evidenceBundleHash: string; // SHA-256 digest of attributable evidence bundle
  evidenceCount: number;
  evidenceCategories: string[];
}

export type SessionOutcome =
  | 'TARGET_HIT'
  | 'STOP_HIT'
  | 'BOTH_TOUCHED_STOP_FIRST'
  | 'NEITHER_CLOSED_AT_EOD';

export interface CandleQuoteInput {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ReconciledObservation extends ProspectiveObservation {
  openFillPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  outcome: SessionOutcome;
  exitPrice: number;
  grossReturnPercent: number;
  netReturnPercent: number; // After 15 bps roundtrip fees and slippage
  stressedNetReturnPercent: number; // After 2x cost stress (30 bps)
  isWin: boolean;
  reconciledAt: string;
}

export interface CohortEvaluationReport {
  cohort: PredictionCohort;
  totalPredictions: number;
  completedSessions: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  winRatePercent: number;
  meanGrossReturnPercent: number;
  meanNetReturnPercent: number;
  meanStressedNetReturnPercent: number;
  brierScore: number;
  maxDrawdownPercent: number;
  gatingChecklist: {
    minimumSessionsMet: boolean; // >= 60 sessions
    minimumTradesMet: boolean; // >= 100 trades
    positiveNetReturn: boolean;
    positiveStressedReturn: boolean;
    drawdownUnderLimit: boolean; // <= 8% max drawdown
  };
  eligibleForPromotion: boolean;
}

export const ROUNDTRIP_FEE_BPS = 10; // 0.10%
export const SLIPPAGE_BPS = 5; // 0.05%
export const TOTAL_COST_PERCENT = (ROUNDTRIP_FEE_BPS + SLIPPAGE_BPS) / 100; // 0.15%
export const STRESSED_COST_PERCENT = TOTAL_COST_PERCENT * 2.0; // 0.30%

export interface ExecutionAssumptions {
  roundtripFeeBps: number;
  slippageBps: number;
  totalCostPct: number;
  stressedCostPct: number;
  stopFirstRule: string;
  fillModel: string;
  sttAndTaxesDescription: string;
}

export const EXECUTION_ASSUMPTIONS: ExecutionAssumptions = {
  roundtripFeeBps: ROUNDTRIP_FEE_BPS,
  slippageBps: SLIPPAGE_BPS,
  totalCostPct: TOTAL_COST_PERCENT,
  stressedCostPct: STRESSED_COST_PERCENT,
  stopFirstRule: 'Stop-first priority invariant applied if both target and stop levels are touched intraday on the same candle.',
  fillModel: 'Conservative fill at next session Open (or limit breakout trigger). No intra-bar hindsight fills.',
  sttAndTaxesDescription: 'Includes Securities Transaction Tax (STT 0.1%), exchange turnover charges, GST, and SEBI turnover fees modeled as 10 bps.',
};

