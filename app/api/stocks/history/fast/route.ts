import { NextRequest, NextResponse } from 'next/server';
import { loadLocalCandles, saveLocalCandles, hasLocalCandles } from '@/lib/local-time-series-store';
import { fetchProviderChart, normalizeChart } from '@/lib/market-quote';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  if (!ticker || typeof ticker !== 'string') {
    return NextResponse.json({ success: false, error: 'Ticker is required.' }, { status: 400 });
  }

  const cleanTicker = ticker.trim().toUpperCase().replace(/\.NS$/, '');

  try {
    // 1. Attempt sub-20ms local disk read
    const local = await loadLocalCandles(cleanTicker, limit);
    if (local.hit && local.candles.length > 0) {
      const readLatencyMs = Date.now() - startTime;
      return NextResponse.json({
        success: true,
        data: {
          ticker: cleanTicker,
          candles: local.candles,
          meta: local.meta,
          source: 'local_disk_store',
          latencyMs: readLatencyMs,
          cached: true,
        },
      }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // 2. Cache miss: fetch from provider and save to local store
    let candles: any[] = [];
    try {
      const symbol = `${cleanTicker}.NS`;
      const raw = await fetchProviderChart(symbol);
      if (raw) {
        const normalized = normalizeChart(symbol, raw);
        if (normalized?.history && normalized.history.length > 0) {
          candles = normalized.history;
          await saveLocalCandles(cleanTicker, candles);
        }
      }
    } catch {
      // Return empty if fetch fails
    }

    const latencyMs = Date.now() - startTime;
    return NextResponse.json({
      success: true,
      data: {
        ticker: cleanTicker,
        candles: limit ? candles.slice(-limit) : candles,
        source: candles.length > 0 ? 'provider_cached_to_local' : 'empty',
        latencyMs,
        cached: false,
      },
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Failed to read time series.',
    }, { status: 500 });
  }
}
