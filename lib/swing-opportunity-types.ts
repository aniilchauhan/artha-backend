/**
 * Type definitions for 10% Swing Opportunities Engine.
 * Per docs/SWING_TARGET_SPECIFICATION.md.
 */

export type SwingSetupType = 'breakout' | 'pullback';
export type SwingHorizon = 20 | 10 | 40;
export type SwingStatus = 'watching' | 'triggered' | 'active' | 'target_hit' | 'stopped' | 'expired';

export interface SwingOpportunity {
  symbol: string;
  companyName: string;
  sector: string;
  signalDate: string;
  dataCutoff: string;
  setupType: SwingSetupType;
  horizonSessions: SwingHorizon; // 20 is primary frozen horizon
  validityDays: number;          // e.g. 3 sessions
  status: SwingStatus;

  // Explicit Price Levels
  triggerPrice: number;
  entryPrice: number | null;
  targetPrice: number;           // Entry * 1.10
  stopPrice: number;             // Invalidation level
  stopDistancePct: number;       // e.g. -4.8%
  breakevenTrailingStopActive?: boolean;

  // Discrete Probabilities & Metrics
  targetProbability: number;     // Calibrated P(+10% before stop/expiry | Entry)
  entryProbability: number;      // P(Trigger reached within validity window)
  expectedNetReturnPct: number;  // Net return after baseline friction
  expectedRealisticNetReturnPct?: number; // Net return after exact Indian statutory delivery taxes (STT, DP, GST, slippage)
  statutoryFrictionPct?: number; // e.g. 0.65%
  riskRewardRatio?: number;      // e.g. 2.85:1
  tradabilityStatus: 'eligible' | 'low_turnover' | 'circuit_risk' | 'penny_stock';
  liquidityAudit?: {
    isLiquid: boolean;
    status: 'VERIFIED_LIQUID' | 'LOW_TURNOVER' | 'CIRCUIT_RISK' | 'PENNY_STOCK' | 'LOW_VOLUME';
    label: string;
    badgeColor: 'emerald' | 'amber' | 'rose' | 'slate';
    warnings: string[];
    medianTurnoverCr?: number;
    avgVolume?: number;
    isPennyStock?: boolean;
    circuitRiskPct?: number;
  };

  // Explanations & Evidence
  evidence: {
    resistanceDays: number;
    bollingerBandSqueezeRatio: number;
    relativeStrengthVsNifty: number;
    volumeSurgeRatio: number;
    chaikinMoneyFlow?: number;
    institutionalAccumulation?: string;
    volumePriceTrendSlope?: number;
  };
  risks: {
    stopDistancePct: number;
    gapRiskRating: 'low' | 'moderate' | 'high';
    marketTrendContext: 'bullish' | 'neutral' | 'bearish';
    upcomingEarningsInWindow: boolean;
  };

  // Exit & Lifecycle details (if matured)
  exitPrice?: number;
  netReturnPct?: number;
}

export interface SwingPortfolioMetrics {
  initial_capital: number;
  final_equity: number;
  total_net_return_pct: number;
  max_drawdown_pct: number;
  annualized_sharpe: number;
  win_rate_pct: number;
  total_trades_executed: number;
  max_concurrent_positions_limit: number;
  risk_budget_per_trade_pct: number;
  friction_per_trade_pct: number;
}

export interface SwingOpportunitiesResponse {
  data: SwingOpportunity[];
  portfolioMetrics: SwingPortfolioMetrics | null;
  horizon: number;
  source: string;
  explanation: string;
  fetchedAt: string;
  count: number;
  scanCoverage?: {
    auditedTotal: number;
    tradabilityQualified: number;
    breakoutSetupsActive: number;
    scope: string;
  };
}
