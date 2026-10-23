/** Historical gap metrics stay unavailable until a sourced dataset and reproducible method are configured. */
export interface GapMagnitudeStats {
  rangeLabel: string;
  minGap: number;
  maxGap: number;
  sampleSize: number;
  day1FillRatePercent: number;
  day3FillRatePercent: number;
  medianFillTimeMinutes: number;
  continuationRatePercent: number;
}

export interface StrategyExpectancyStats {
  setupType: 'GAP_AND_GO' | 'GAP_FADE' | 'BREAKAWAY';
  label: string;
  winRatePercent: number;
  profitFactor: number;
  sharpeRatio: number;
  avgRewardRiskRatio: number;
  idealRvolThreshold: string;
  ruleSummary: string;
}

export interface SectorGapTendency {
  sector: string;
  historicalGaps: number;
  fillRatePercent: number;
  dominantBehavior: 'FADE_PRONE' | 'CONTINUATION_PRONE' | 'NEUTRAL';
  avgSessionGapPercent: number;
}

export interface HistoricalGapReport {
  datasetUniverse: string;
  samplePeriod: string;
  totalGapsAnalyzed: number;
  overallDay1FillRate: number;
  magnitudeBrackets: GapMagnitudeStats[];
  strategyExpectancies: StrategyExpectancyStats[];
  sectorTendencies: SectorGapTendency[];
  generatedAt: string;
}

export function getHistoricalGapReport(): HistoricalGapReport {
  throw new Error('Historical gap backtest is unavailable because no validated historical dataset is configured.');
}
