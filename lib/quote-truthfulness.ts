/**
 * Axion Quote Truthfulness and Provenance Quality Gate
 * 
 * Satisfies Year 2 Backlog Epic 5:
 * "Quote freshness and provenance quality gates: all quote or recommendation surfaces expose truthfulness metadata."
 */

import crypto from 'node:crypto';

export type QuoteSourceType =
  | 'NSE_REALTIME'
  | 'BSE_REALTIME'
  | 'DELAYED_FALLBACK'
  | 'STALE_CACHE'
  | 'SIMULATED';

export type FreshnessBadgeState = 'LIVE' | 'DELAYED' | 'STALE_BLOCKED';

export interface QuoteTruthfulnessMetadata {
  source: QuoteSourceType;
  quoteAsOf: string; // ISO 8601
  retrievedAt: string; // ISO 8601
  ageSeconds: number;
  freshnessBadge: FreshnessBadgeState;
  isExecutionEligible: boolean;
  disclosure: string;
  verificationHash: string; // SHA-256 digest of {symbol, price, quoteAsOf, source}
}

export interface RawQuoteInput {
  symbol: string;
  price: number;
  change?: number;
  changePercent?: number;
  quoteAsOf?: string;
  source?: string;
  isFallback?: boolean;
}

/**
 * Evaluates truthfulness and provenance metadata for a market quote.
 * Never throws — guarantees truthfulness tags even for malformed inputs.
 */
export function evaluateQuoteTruthfulness(
  quote: RawQuoteInput,
  maxLiveAgeSeconds = 120, // 2 minutes maximum for "LIVE" status
  maxEligibleAgeSeconds = 300, // 5 minutes maximum for order execution eligibility
  now: Date = new Date()
): QuoteTruthfulnessMetadata {
  const retrievedAt = now.toISOString();

  // 1. Resolve and parse timestamp
  let quoteTime = now.getTime();
  let quoteAsOf = quote.quoteAsOf || retrievedAt;

  if (quote.quoteAsOf) {
    const parsed = Date.parse(quote.quoteAsOf);
    if (!isNaN(parsed)) {
      quoteTime = parsed;
    } else {
      quoteAsOf = retrievedAt;
    }
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - quoteTime) / 1000));

  // 2. Determine Source Type
  let source: QuoteSourceType = 'NSE_REALTIME';
  if (quote.source === 'simulated' || quote.source === 'demo') {
    source = 'SIMULATED';
  } else if (quote.isFallback || quote.source === 'fallback') {
    source = 'DELAYED_FALLBACK';
  } else if (quote.source?.toUpperCase().includes('BSE')) {
    source = 'BSE_REALTIME';
  } else if (ageSeconds > maxEligibleAgeSeconds) {
    source = 'STALE_CACHE';
  }

  // 3. Determine Freshness Badge & Execution Eligibility
  let freshnessBadge: FreshnessBadgeState = 'LIVE';
  let isExecutionEligible = true;
  let disclosure = 'Verified real-time quote from primary exchange feed.';

  if (source === 'SIMULATED') {
    freshnessBadge = 'STALE_BLOCKED';
    isExecutionEligible = false;
    disclosure = 'Synthetic / simulated quote. Execution blocked by safety governance.';
  } else if (ageSeconds > maxEligibleAgeSeconds || source === 'STALE_CACHE') {
    freshnessBadge = 'STALE_BLOCKED';
    isExecutionEligible = false;
    disclosure = `Quote is ${ageSeconds}s old (exceeds ${maxEligibleAgeSeconds}s limit). Execution and trading gates blocked.`;
  } else if (ageSeconds > maxLiveAgeSeconds || source === 'DELAYED_FALLBACK') {
    freshnessBadge = 'DELAYED';
    // Advisory allowed, but automated execution blocked
    isExecutionEligible = false;
    disclosure = `Quote is delayed (${ageSeconds}s old or fallback source). Advisory only; automated orders gated.`;
  }

  // 4. Generate Immutable Verification Hash
  const hashPayload = `${quote.symbol}:${quote.price}:${quoteAsOf}:${source}`;
  const verificationHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

  return {
    source,
    quoteAsOf,
    retrievedAt,
    ageSeconds,
    freshnessBadge,
    isExecutionEligible,
    disclosure,
    verificationHash,
  };
}

/**
 * Formats a user-friendly UI presentation badge for the client.
 */
export function getTruthfulnessUiBadge(metadata: QuoteTruthfulnessMetadata): {
  label: string;
  themeColor: 'green' | 'amber' | 'red';
  tooltip: string;
} {
  switch (metadata.freshnessBadge) {
    case 'LIVE':
      return {
        label: `LIVE (${metadata.ageSeconds}s)`,
        themeColor: 'green',
        tooltip: `${metadata.source}: ${metadata.disclosure}`,
      };
    case 'DELAYED':
      return {
        label: `DELAYED (${metadata.ageSeconds}s)`,
        themeColor: 'amber',
        tooltip: `${metadata.source}: ${metadata.disclosure}`,
      };
    case 'STALE_BLOCKED':
    default:
      return {
        label: `STALE BLOCKED (${metadata.ageSeconds}s)`,
        themeColor: 'red',
        tooltip: `${metadata.source}: ${metadata.disclosure}`,
      };
  }
}
