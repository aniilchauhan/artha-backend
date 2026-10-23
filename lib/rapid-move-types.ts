export type MoveHorizon = 1 | 2 | 3 | 4 | 5;
export interface PriceBand { upper: number; lower: number; asOf: string; dynamic: boolean; source: 'NSE'; }
export interface RapidMoveCandidate {
  ticker: string; name: string; asOf: string; price: number; changePct: number;
  quoteStatus?: 'recent' | 'delayed' | 'historical' | 'simulated';
  entry: number; target: number; invalidation: number; score: number;
  atrPct: number; volumeRatio: number; turnoverCr: number; momentum5Pct: number;
  setup: 'breakout' | 'building'; circuitMomentum: boolean; band: PriceBand | null;
  horizons: Array<{ days: MoveHorizon; rangePct: number; stretch: boolean; historicalHits: number; historicalSamples: number }>;
  reasons: string[]; risks: string[];
  resistance20d?: number;
  signalId?: string;
  series?: string;
  statutoryFrictionPct?: number;
  expectedRealisticNetReturnPct?: number;
  riskRewardRatio?: number;
  statutoryBreakevenPrice?: number;
  profitLockPrice?: number;
}
export interface RapidMoveBatch {
  candidates: RapidMoveCandidate[]; scannedTickers: string[]; evaluatedTickers: string[]; scanned: number; unavailable: number;
  total: number; nextOffset: number | null; catalogRevision: string; fetchedAt: string;
}
