export type ForwardHistoryHorizon = 'today' | 'next';
export type ForwardHistoryPolicy =
  | 'after-recorded-quote-high-2pct-v1'
  | 'next-open-target-before-stop-2pct-v1';

export const FORWARD_TODAY_POLICY: ForwardHistoryPolicy = 'after-recorded-quote-high-2pct-v1';
export const FORWARD_NEXT_POLICY: ForwardHistoryPolicy = 'next-open-target-before-stop-2pct-v1';

export interface ForwardHistoryOutcome {
  status: 'pending' | 'right' | 'wrong' | 'unscorable';
  reason: string;
  evaluatedAt: string;
  deadline?: string;
  dataAsOf?: string;
  targetSessionDate?: string;
  /** End-of-session change from the frozen quote (today) or actual open (next), not trading profit. */
  closeReturnPercent?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopPrice?: number;
}

/** Server-recorded prospective snapshot. Outcome is the only mutable field. */
export interface ForwardHistoryEntry {
  id: string;
  ticker: string;
  name: string;
  horizon: ForwardHistoryHorizon;
  recordedAt: string;
  quoteAsOf: string;
  inputDate?: string;
  modelVersion: string;
  policyVersion: ForwardHistoryPolicy;
  reference: number;
  /** Frozen quote-based scenario; next-session scoring derives a separate target from the actual open. */
  target: number;
  estimate: number | null;
  evidenceCount: number;
  outcome?: ForwardHistoryOutcome;
}

export interface ForwardHistoryBar {
  /** Provider candle start, Unix seconds. */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Only observed provider OHLC belongs here; no fallback or simulated prices. */
export interface ForwardHistoryChart {
  symbol: string;
  currency: string;
  fetchedAt: string;
  observedAt: string;
  bars: ForwardHistoryBar[];
  barSeconds: 300 | 86400;
  /** Current provider exchange-session metadata, Unix seconds. */
  sessionStart?: number;
  sessionEnd?: number;
}

export type IntradayHistoryChart = ForwardHistoryChart;

export interface ForwardHistoryCounts {
  saved: number;
  right: number;
  wrong: number;
  pending: number;
  unscorable: number;
  scored: number;
  /** Observed fraction among right/wrong outcomes only; null means no completed denominator. */
  rightRate: number | null;
}

export interface ForwardHistoryDaySummary extends ForwardHistoryCounts {
  date: string;
  horizon: ForwardHistoryHorizon;
  modelVersion: string;
  policyVersion: ForwardHistoryPolicy;
}

export interface ForwardHistorySummary extends ForwardHistoryCounts {
  days: ForwardHistoryDaySummary[];
}
