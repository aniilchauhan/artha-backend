/**
 * Provider Freshness and Outage Tracker (M3-06).
 *
 * Tracks the operational freshness, snapshot age, and failure states of market data providers.
 * Reports state to the system health route and logs threshold breaches through lib/logger.ts.
 */

import { logger } from './logger';
import { PROVIDER_POLICY, getSnapshotAgeMs, isSnapshotExpired, isSnapshotStale } from './provider-policy';

export interface ProviderFreshnessRecord {
  source: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  snapshotAgeMs: number | null;
  status: 'ok' | 'stale' | 'unavailable' | 'unknown';
  freshTtlMs: number;
  maxStaleMs: number;
}

export interface FreshnessBreach {
  source: string;
  reason: 'expired_max_stale' | 'consecutive_failures' | 'unavailable';
  snapshotAgeMs: number | null;
  maxStaleMs: number;
  consecutiveFailures: number;
  detail: string;
}

interface InternalSourceState {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const providerStates: Map<string, InternalSourceState> = new Map();

function getPolicyForSource(source: string) {
  if (source in PROVIDER_POLICY) {
    return PROVIDER_POLICY[source as keyof typeof PROVIDER_POLICY];
  }
  // Default to quotes policy for unknown quote-like sources
  return PROVIDER_POLICY.quotes;
}

function getOrCreateState(source: string): InternalSourceState {
  let state = providerStates.get(source);
  if (!state) {
    state = {
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastFailureAt: null,
      lastError: null,
      consecutiveFailures: 0,
    };
    providerStates.set(source, state);
  }
  return state;
}

/**
 * Record a successful fetch from a provider source.
 */
export function recordProviderSuccess(
  source: string,
  meta?: { retrievedAt?: string; durationMs?: number }
): ProviderFreshnessRecord {
  const state = getOrCreateState(source);
  const nowIso = meta?.retrievedAt || new Date(Date.now()).toISOString();
  state.lastAttemptAt = nowIso;
  state.lastSuccessAt = nowIso;
  state.lastError = null;
  state.consecutiveFailures = 0;

  return getProviderFreshness(source);
}

/**
 * Record a failed fetch or network error from a provider source.
 */
export function recordProviderFailure(
  source: string,
  error: unknown,
  meta?: { durationMs?: number }
): ProviderFreshnessRecord {
  const state = getOrCreateState(source);
  const nowIso = new Date(Date.now()).toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown provider error');

  state.lastAttemptAt = nowIso;
  state.lastFailureAt = nowIso;
  state.lastError = errorMessage;
  state.consecutiveFailures += 1;

  const policy = getPolicyForSource(source);
  if (state.consecutiveFailures >= policy.maxRetries) {
    logger.warn(`[Provider Freshness] Source ${source} exceeded retry threshold with ${state.consecutiveFailures} consecutive failures: ${errorMessage}`);
  }

  return getProviderFreshness(source);
}

/**
 * Get current freshness status and snapshot age for a specific provider source.
 */
export function getProviderFreshness(source: string, now = Date.now()): ProviderFreshnessRecord {
  const state = getOrCreateState(source);
  const policy = getPolicyForSource(source);
  const snapshotAgeMs = getSnapshotAgeMs(state.lastSuccessAt, now);

  let status: 'ok' | 'stale' | 'unavailable' | 'unknown' = 'unknown';

  if (!state.lastSuccessAt) {
    status = state.consecutiveFailures > 0 ? 'unavailable' : 'unknown';
  } else if (snapshotAgeMs !== null && isSnapshotExpired(state.lastSuccessAt, policy.maxStaleMs, now)) {
    status = 'unavailable';
  } else if (snapshotAgeMs !== null && isSnapshotStale(state.lastSuccessAt, policy.freshTtlMs, now)) {
    status = 'stale';
  } else {
    status = 'ok';
  }

  return {
    source,
    lastSuccessAt: state.lastSuccessAt,
    lastAttemptAt: state.lastAttemptAt,
    lastFailureAt: state.lastFailureAt,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    snapshotAgeMs,
    status,
    freshTtlMs: policy.freshTtlMs,
    maxStaleMs: policy.maxStaleMs,
  };
}

/**
 * Get freshness summary for all actively tracked sources.
 */
export function getAllProviderFreshness(now = Date.now()): Record<string, ProviderFreshnessRecord> {
  const result: Record<string, ProviderFreshnessRecord> = {};
  for (const source of ['stocks', 'indices']) {
    result[source] = getProviderFreshness(source, now);
  }
  for (const [source] of providerStates) {
    if (!result[source]) {
      result[source] = getProviderFreshness(source, now);
    }
  }
  return result;
}

/**
 * Evaluate all sources for freshness or failure threshold breaches, logging any breaches via lib/logger.ts.
 */
export function checkFreshnessBreaches(now = Date.now()): {
  hasBreaches: boolean;
  breaches: FreshnessBreach[];
} {
  const all = getAllProviderFreshness(now);
  const breaches: FreshnessBreach[] = [];

  for (const [source, rec] of Object.entries(all)) {
    // Only check sources that have recorded attempts
    if (!rec.lastAttemptAt && rec.status === 'unknown') {
      continue;
    }

    if (rec.snapshotAgeMs !== null && rec.snapshotAgeMs > rec.maxStaleMs) {
      const detail = `Provider '${source}' snapshot age (${Math.round(rec.snapshotAgeMs / 1000)}s) breached max allowable staleness (${Math.round(rec.maxStaleMs / 1000)}s).`;
      logger.error(`[Provider Freshness Breach] ${detail}`);
      breaches.push({
        source,
        reason: 'expired_max_stale',
        snapshotAgeMs: rec.snapshotAgeMs,
        maxStaleMs: rec.maxStaleMs,
        consecutiveFailures: rec.consecutiveFailures,
        detail,
      });
    } else if (rec.consecutiveFailures >= getPolicyForSource(source).maxRetries) {
      const detail = `Provider '${source}' has ${rec.consecutiveFailures} consecutive fetch failures: ${rec.lastError || 'Network error'}.`;
      logger.warn(`[Provider Freshness Breach] ${detail}`);
      breaches.push({
        source,
        reason: 'consecutive_failures',
        snapshotAgeMs: rec.snapshotAgeMs,
        maxStaleMs: rec.maxStaleMs,
        consecutiveFailures: rec.consecutiveFailures,
        detail,
      });
    }
  }

  return {
    hasBreaches: breaches.length > 0,
    breaches,
  };
}

/**
 * Reset tracked state for test isolation.
 */
export function _resetProviderFreshnessForTesting(): void {
  providerStates.clear();
}
