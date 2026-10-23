/**
 * Provider Retry, Timeout, and Cache Staleness Policy (M3-05).
 * 
 * Formalizes TTLs, timeouts, failovers, and maximum allowable staleness bounds.
 * When provider data exceeds maxStaleMs, services MUST report data unavailable
 * rather than serving an indefinitely old cached snapshot.
 */

export interface CacheFreshnessConfig {
  /** Maximum duration (ms) for which a cached result is considered fresh. */
  freshTtlMs: number;
  /** Maximum duration (ms) beyond which cached data CANNOT be served under outage, and MUST report unavailable. */
  maxStaleMs: number;
  /** Per-request network timeout (ms). */
  timeoutMs: number;
  /** Number of host or retry attempts before reporting failure. */
  maxRetries: number;
}

export const PROVIDER_POLICY = {
  quotes: {
    freshTtlMs: 90_000,          // 90 seconds fresh cache
    maxStaleMs: 15 * 60_000,     // 15 minutes max stale fallback
    timeoutMs: 4_000,            // 4 seconds per host
    maxRetries: 2,               // query1.finance.yahoo.com -> query2.finance.yahoo.com
  },
  indices: {
    freshTtlMs: 60_000,          // 60 seconds fresh cache
    maxStaleMs: 10 * 60_000,     // 10 minutes max stale fallback
    timeoutMs: 4_000,            // 4 seconds per host
    maxRetries: 2,
  },
  fundamentals: {
    freshTtlMs: 24 * 60 * 60_000,       // 24 hours fresh cache
    maxStaleMs: 7 * 24 * 60 * 60_000,  // 7 days max stale
    timeoutMs: 8_000,
    maxRetries: 2,
  },
  newsSentiment: {
    freshTtlMs: 10 * 60_000,     // 10 minutes fresh
    maxStaleMs: 60 * 60_000,     // 1 hour max stale
    timeoutMs: 6_000,
    maxRetries: 2,
  },
} as const satisfies Record<string, CacheFreshnessConfig>;

/**
 * Calculates snapshot age in milliseconds.
 * Returns null if retrievedAt is invalid or unparseable.
 */
export function getSnapshotAgeMs(retrievedAt: string | number | undefined | null, now = Date.now()): number | null {
  if (!retrievedAt) return null;
  const timestamp = typeof retrievedAt === 'number' ? retrievedAt : Date.parse(retrievedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, now - timestamp);
}

/**
 * Returns true if the snapshot has exceeded freshTtlMs.
 */
export function isSnapshotStale(retrievedAt: string | number | undefined | null, freshTtlMs: number, now = Date.now()): boolean {
  const age = getSnapshotAgeMs(retrievedAt, now);
  if (age === null) return true;
  return age > freshTtlMs;
}

/**
 * Returns true if the snapshot has exceeded maxStaleMs and MUST NOT be served.
 */
export function isSnapshotExpired(retrievedAt: string | number | undefined | null, maxStaleMs: number, now = Date.now()): boolean {
  const age = getSnapshotAgeMs(retrievedAt, now);
  if (age === null) return true;
  return age > maxStaleMs;
}

export {
  recordProviderSuccess,
  recordProviderFailure,
  getProviderFreshness,
  getAllProviderFreshness,
  checkFreshnessBreaches,
  _resetProviderFreshnessForTesting,
  type ProviderFreshnessRecord,
  type FreshnessBreach,
} from './provider-freshness-tracker';
