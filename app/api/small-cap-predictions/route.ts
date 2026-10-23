import { NextRequest, NextResponse } from 'next/server';
import { scanSmallCapUniverse, SMALL_CAP_BATCH_LIMIT } from '../../../lib/small-cap-universe';
import { readSnapshot, snapshotMetadata } from '../../../lib/backend-snapshots';
import type { SmallCapExchange, SmallCapScanResponse } from '../../../lib/small-cap-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SCAN_CACHE_TTL_MS = 3 * 60_000;
const memoryCache = new Map<string, { data: any; expires: number }>();

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const exchange = query.get('exchange') || 'all';
  const rawOffset = query.get('offset') ?? '0';
  const rawLimit = query.get('limit') ?? String(SMALL_CAP_BATCH_LIMIT);
  const rawCatalogOnly = query.get('catalogOnly');
  if (!['NSE', 'BSE', 'all'].includes(exchange) || !/^\d+$/.test(rawOffset) || !/^\d+$/.test(rawLimit) ||
      !Number.isSafeInteger(Number(rawOffset)) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1 ||
      (rawCatalogOnly !== null && !['true', 'false'].includes(rawCatalogOnly))) {
    return NextResponse.json({ error: 'Use exchange=NSE|BSE|all, a nonnegative offset, and a positive integer limit.' }, { status: 400 });
  }

  const cacheKey = `${exchange}:${rawOffset}:${rawLimit}:${rawCatalogOnly}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=60' },
    });
  }

  // 1. Try reading published snapshot when not explicitly requesting catalog metadata
  if (rawCatalogOnly !== 'true') {
    try {
      const snapshot = await readSnapshot<SmallCapScanResponse>('small-cap-predictions');
      let stocks = snapshot.data.stocks;
      if (exchange !== 'all') {
        stocks = stocks.filter(s => s.exchange === exchange);
      }
      return NextResponse.json({
        ...snapshot.data,
        stocks,
        nextOffset: null,
        snapshot: await snapshotMetadata(snapshot),
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Snapshot is not published yet; fallback to direct scan handler
    }
  }

  // 2. Direct catalog or test-mocked execution
  try {
    const result = await scanSmallCapUniverse({
      exchange: exchange as SmallCapExchange, offset: Number(rawOffset), limit: Math.min(Number(rawLimit), SMALL_CAP_BATCH_LIMIT),
      catalogOnly: rawCatalogOnly === 'true', signal: request.signal,
    });
    memoryCache.set(cacheKey, { data: result, expires: Date.now() + SCAN_CACHE_TTL_MS });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=60' } });
  } catch (error) {
    if (request.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return NextResponse.json({ error: 'The scan was cancelled.' }, { status: 499 });
    }
    return NextResponse.json({ error: 'The company catalog or provider data is currently unavailable.' }, { status: 503 });
  }
}
