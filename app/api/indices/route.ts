import { NextRequest, NextResponse } from 'next/server';
import { fetchProviderChart, normalizeChart, withCurrentStatus } from '../../../lib/market-quote';
import { PROVIDER_POLICY, getSnapshotAgeMs, isSnapshotExpired, isSnapshotStale, recordProviderSuccess, recordProviderFailure } from '../../../lib/provider-policy';

export const dynamic = 'force-dynamic';

const { freshTtlMs, maxStaleMs } = PROVIDER_POLICY.indices;
const INDEX_KEYS = ['nifty', 'sensex', 'banknifty', 'niftyit'] as const;
let cachedIndicesResponse: any = null;
let cachedIndicesExpires = 0;
let pendingIndicesPromise: Promise<any> | null = null;

/** Quote labels and snapshot age are computed per response, never frozen at fetch time. */
function serveSnapshot(payload: any, now = Date.now()) {
  const cacheAgeMs = getSnapshotAgeMs(payload?.retrievedAt, now);
  const stale = isSnapshotStale(payload?.retrievedAt, freshTtlMs, now);
  const served: any = { ...payload, indices: (payload?.indices ?? []).map((q: any) => withCurrentStatus(q, now)), cacheAgeMs, stale };
  for (const key of INDEX_KEYS) served[key] = payload?.[key] ? withCurrentStatus(payload[key], now) : null;
  return served;
}

const fetchIndex = async (symbol: string, name: string) => {
  try {
    const quote = normalizeChart(symbol, await fetchProviderChart(symbol));
    return quote ? { ...quote, price: quote.currentPrice, symbol, name } : null;
  } catch {
    return null;
  }
};

const executeIndicesFetch = async () => {
  try {
    const [nifty, sensex, banknifty, niftyit] = await Promise.all([
      fetchIndex('^NSEI', 'Nifty 50'),
      fetchIndex('^BSESN', 'Sensex'),
      fetchIndex('^NSEBANK', 'Bank Nifty'),
      fetchIndex('^CNXIT', 'Nifty IT'),
    ]);
    const indices = [nifty, sensex, banknifty, niftyit].filter(Boolean);
    const payload = {
      source: indices.length > 0 ? 'yahoo-finance' : 'unavailable',
      retrievedAt: new Date(Date.now()).toISOString(),
      nifty,
      sensex,
      banknifty,
      niftyit,
      indices,
    };
    if (indices.length > 0) {
      cachedIndicesResponse = payload;
      cachedIndicesExpires = Date.now() + freshTtlMs;
      recordProviderSuccess('indices', { retrievedAt: payload.retrievedAt });
    } else {
      recordProviderFailure('indices', 'All index fetches returned null');
    }
    return payload;
  } catch (error) {
    recordProviderFailure('indices', error);
    throw error;
  } finally {
    pendingIndicesPromise = null;
  }
};

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('mode') === 'mock') {
    return NextResponse.json({
      source: 'simulated',
      indices: [],
      nifty: { price: 24133.02, change: 120.50, changePercent: 0.5, quoteStatus: 'simulated', name: 'Nifty 50', symbol: '^NSEI' },
      sensex: { price: 79638.98, change: 350.20, changePercent: 0.44, quoteStatus: 'simulated', name: 'Sensex', symbol: '^BSESN' },
      banknifty: { price: 51840.40, change: 275.60, changePercent: 0.53, quoteStatus: 'simulated', name: 'Bank Nifty', symbol: '^NSEBANK' },
      niftyit: { price: 38450.15, change: -110.25, changePercent: -0.29, quoteStatus: 'simulated', name: 'Nifty IT', symbol: '^CNXIT' },
    });
  }

  const now = Date.now();
  // 1. Fresh cache hit: instant response
  if (cachedIndicesResponse && cachedIndicesExpires > now) {
    return NextResponse.json(serveSnapshot(cachedIndicesResponse, now));
  }

  // 2. Stale-While-Revalidate: return stale snapshot immediately if within maxStaleMs, revalidate in background
  if (cachedIndicesResponse) {
    if (isSnapshotExpired(cachedIndicesResponse.retrievedAt, maxStaleMs, now)) {
      // Exceeded maximum allowable staleness - discard stale snapshot
      cachedIndicesResponse = null;
    } else {
      if (!pendingIndicesPromise) {
        pendingIndicesPromise = executeIndicesFetch();
      }
      return NextResponse.json(serveSnapshot(cachedIndicesResponse, now));
    }
  }

  if (pendingIndicesPromise) {
    const data = await pendingIndicesPromise;
    return NextResponse.json(serveSnapshot(data));
  }

  pendingIndicesPromise = executeIndicesFetch();
  const result = await pendingIndicesPromise;
  return NextResponse.json(serveSnapshot(result));
}
