import { NextRequest, NextResponse } from 'next/server';
import { fetchStocksData } from '../../../lib/stock-fetcher';
import { withCurrentStatus } from '../../../lib/market-quote';
import { PROVIDER_POLICY, getSnapshotAgeMs, isSnapshotExpired, isSnapshotStale, recordProviderSuccess, recordProviderFailure } from '../../../lib/provider-policy';

export const dynamic = 'force-dynamic';

const { freshTtlMs, maxStaleMs } = PROVIDER_POLICY.quotes;
let cachedStocksResponse: any = null;
let cachedStocksExpires = 0;
let pendingStocksPromise: Promise<any> | null = null;

/** Quote labels and snapshot age are computed per response, never frozen at fetch time. */
function serveSnapshot(payload: any, now = Date.now()) {
  if (payload?.error || !Array.isArray(payload?.stocks)) return payload;
  const cacheAgeMs = getSnapshotAgeMs(payload.retrievedAt, now);
  const stale = isSnapshotStale(payload.retrievedAt, freshTtlMs, now);
  return { ...payload, stocks: payload.stocks.map((s: any) => withCurrentStatus(s, now)), cacheAgeMs, stale };
}

export async function GET(req: NextRequest) {
  const customTickers = req.nextUrl.searchParams.get('custom')?.split(',').filter(Boolean) || [];
  const useRealApi = req.nextUrl.searchParams.get('mode') !== 'mock';

  const fetchAction = async () => {
    try {
      const stocks = await fetchStocksData(customTickers, useRealApi);
      const fallbackCount = stocks.filter(s => s.isFallback).length;
      const payload = {
        error: false as const,
        source: stocks.length === 0 ? 'unavailable' : fallbackCount === stocks.length ? 'simulated' : fallbackCount > 0 ? 'mixed' : 'yahoo-finance',
        retrievedAt: new Date(Date.now()).toISOString(),
        stocks: stocks.map(s => ({ ...s, dataSource: s.isFallback ? 'simulated' : s.dataSource }))
      };
      if (useRealApi && customTickers.length === 0) {
        if (stocks.length > 0 && fallbackCount < stocks.length) {
          cachedStocksResponse = payload;
          cachedStocksExpires = Date.now() + freshTtlMs;
          recordProviderSuccess('stocks', { retrievedAt: payload.retrievedAt });
        } else if (stocks.length === 0) {
          recordProviderFailure('stocks', 'Provider returned 0 stocks');
        } else {
          recordProviderFailure('stocks', 'All stocks fallen back to simulated');
        }
      }
      return payload;
    } catch (error: any) {
      console.error('[Stocks API] GET error:', error);
      if (useRealApi && customTickers.length === 0) {
        recordProviderFailure('stocks', error);
      }
      return {
        error: true as const,
        source: 'unavailable',
        message: error?.message || 'Failed to fetch stock data',
        stocks: []
      };
    }
  };

  if (useRealApi && customTickers.length === 0) {
    const now = Date.now();
    // 1. Fresh cache hit: instant response
    if (cachedStocksResponse && cachedStocksExpires > now) {
      return NextResponse.json(serveSnapshot(cachedStocksResponse, now));
    }

    // 2. Stale-While-Revalidate: return existing snapshot immediately if within maxStaleMs, revalidate in background
    if (cachedStocksResponse) {
      if (isSnapshotExpired(cachedStocksResponse.retrievedAt, maxStaleMs, now)) {
        // Exceeded maximum allowable staleness - discard stale snapshot
        cachedStocksResponse = null;
      } else {
        if (!pendingStocksPromise) {
          pendingStocksPromise = fetchAction().finally(() => {
            pendingStocksPromise = null;
          });
        }
        return NextResponse.json(serveSnapshot(cachedStocksResponse, now));
      }
    }

    // 3. Cold boot or expired snapshot: await load
    if (pendingStocksPromise) {
      const data = await pendingStocksPromise;
      if (data?.error) {
        return NextResponse.json(data, { status: 503 });
      }
      return NextResponse.json(serveSnapshot(data));
    }

    pendingStocksPromise = fetchAction().finally(() => {
      pendingStocksPromise = null;
    });
    const result = await pendingStocksPromise;
    if (result?.error) {
      return NextResponse.json(result, { status: 503 });
    }
    return NextResponse.json(serveSnapshot(result));
  }

  const result = await fetchAction();
  if (result?.error) {
    return NextResponse.json(result, { status: 503 });
  }
  return NextResponse.json(serveSnapshot(result));
}
