/**
 * AX-05: Observation Quality Pipeline & Rejection Telemetry
 *
 * Runs batch validation across candidate universes, categorizes rejections,
 * and maintains data health metrics for the Data Health view.
 */

import {
  normalizeObservation,
  MarketObservation,
  ObservationRejectionCategory,
  RawCandlePayload,
  getIndianMarketSession,
} from './observation-contract';

export interface DataHealthSummary {
  timestamp: string;
  status: 'healthy' | 'degraded' | 'outage';
  marketSession: string;
  catalogSize: number;
  evaluatedCount: number;
  validCount: number;
  staleCount: number;
  missingCount: number;
  rejectedCount: number;
  rejectionBreakdown: Record<ObservationRejectionCategory, number>;
  lastSuccessfulScanAt: string | null;
  daemonHeartbeat: {
    status: 'active' | 'idle' | 'stopped' | 'unknown';
    phase: string;
    lastPingAt: string | null;
  };
  providerStatus: {
    name: string;
    status: 'connected' | 'slow' | 'unreachable' | 'unknown';
    latencyMs: number | null;
  };
}

let pipelineMetrics: DataHealthSummary | null = null;

/**
 * Runs the quality pipeline over a list of raw stock payloads.
 */
export function runObservationQualityPipeline(
  stocks: RawCandlePayload[],
  now: number = Date.now()
): {
  validObservations: MarketObservation[];
  rejectedItems: Array<{ symbol: string; category: ObservationRejectionCategory; reason: string }>;
  summary: DataHealthSummary;
} {
  const session = getIndianMarketSession(new Date(now));
  const validObservations: MarketObservation[] = [];
  const rejectedItems: Array<{ symbol: string; category: ObservationRejectionCategory; reason: string }> = [];

  const breakdown: Record<ObservationRejectionCategory, number> = {
    INVALID_OHLC: 0,
    FUTURE_TIMESTAMP: 0,
    STALE_QUOTE: 0,
    CIRCUIT_LOCKED: 0,
    SPLIT_DISCONTINUITY: 0,
    MISSING_VOLUME: 0,
    WRONG_SYMBOL: 0,
    UNSUPPORTED_CURRENCY: 0,
    UNFINISHED_CANDLE_FOR_BASELINE: 0,
  };

  let staleCount = 0;
  let missingCount = 0;

  for (const stock of stocks) {
    if (!stock || (!stock.symbol && !stock.ticker)) {
      missingCount++;
      continue;
    }

    const norm = normalizeObservation(stock, { now });
    if (!norm.success || !norm.observation) {
      const category = norm.rejectionCategory || 'INVALID_OHLC';
      const reason = norm.rejectionReason || 'Unknown rejection';
      breakdown[category] = (breakdown[category] || 0) + 1;
      rejectedItems.push({
        symbol: stock.symbol || stock.ticker || 'UNKNOWN',
        category,
        reason,
      });
    } else {
      if (norm.observation.qualityStatus === 'stale') {
        staleCount++;
      }
      validObservations.push(norm.observation);
    }
  }

  const validCount = validObservations.length;
  const rejectedCount = rejectedItems.length;
  const evaluatedCount = validCount + rejectedCount;

  // Determine overall status
  let status: DataHealthSummary['status'] = 'healthy';
  if (missingCount > evaluatedCount * 0.2 || breakdown.STALE_QUOTE > validCount * 0.3) {
    status = 'degraded';
  }
  if (validCount === 0 && evaluatedCount > 0) {
    status = 'outage';
  }

  pipelineMetrics = {
    timestamp: new Date(now).toISOString(),
    status,
    marketSession: session.sessionLabel,
    catalogSize: stocks.length,
    evaluatedCount,
    validCount,
    staleCount,
    missingCount,
    rejectedCount,
    rejectionBreakdown: breakdown,
    lastSuccessfulScanAt: validCount > 0 ? new Date(now).toISOString() : pipelineMetrics?.lastSuccessfulScanAt ?? null,
    daemonHeartbeat: {
      status: 'unknown',
      phase: 'Heartbeat telemetry not connected',
      lastPingAt: null,
    },
    providerStatus: {
      name: 'Provider telemetry not connected',
      status: 'unknown',
      latencyMs: null,
    },
  };

  return {
    validObservations,
    rejectedItems,
    summary: pipelineMetrics,
  };
}

/**
 * Returns the current cached data health summary.
 */
export function getDataHealthSummary(): DataHealthSummary | null {
  return pipelineMetrics;
}
