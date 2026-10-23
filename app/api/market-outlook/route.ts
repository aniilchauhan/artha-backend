import { getAxionProjectRoot } from '../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import { calculateTomorrowMarketOutlook } from '../../../lib/market-outlook-engine';
import { fetchProviderChart, normalizeChart, withCurrentStatus } from '../../../lib/market-quote';
import { PROVIDER_POLICY, getSnapshotAgeMs, isSnapshotExpired, isSnapshotStale } from '../../../lib/provider-policy';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MACRO_FILE = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'macro', 'macro_snapshot.json');
const { freshTtlMs, maxStaleMs } = PROVIDER_POLICY.indices;

let cachedOutlook: any = null;
let cachedOutlookExpires = 0;
let pendingOutlookPromise: Promise<any> | null = null;

function serveOutlookSnapshot(payload: any, now = Date.now()) {
  if (!payload?.success || !payload.data) return payload;
  const cacheAgeMs = getSnapshotAgeMs(payload.retrievedAt, now);
  const stale = isSnapshotStale(payload.retrievedAt, freshTtlMs, now);
  const updatedData = payload.data.quoteAsOf ? withCurrentStatus(payload.data, now) : payload.data;
  return { ...payload, data: updatedData, cacheAgeMs, stale };
}

async function executeOutlookFetch() {
  try {
    // 1. Fetch Nifty 50 Chart & Quote
    let niftyPrice = 24150;
    let niftyChange1d = 85.5;
    let niftyChange1dPct = 0.35;
    let niftyHistory: Array<{ date: string; close: number; high?: number; low?: number }> = [];
    let liveQuote: any = null;

    try {
      const rawChart = await fetchProviderChart('^NSEI');
      const quote = normalizeChart('^NSEI', rawChart);
      if (quote) {
        liveQuote = quote;
        niftyPrice = quote.currentPrice;
        niftyChange1d = quote.change;
        niftyChange1dPct = quote.changePercent;
        niftyHistory = quote.history.map(h => ({
          date: h.date,
          close: h.price,
        }));
      }
    } catch (e) {
      console.warn('[Market Outlook API] Failed to fetch live Nifty quote, using fallback:', e);
    }

    // 2. Fetch Macro Snapshot (India VIX, Crude, USDINR)
    let indiaVix = 13.8;
    let indiaVixChangePct = -0.5;
    let brentCrudeChangePct = 0;
    let usdinrChangePct = 0;

    try {
      if (fs.existsSync(MACRO_FILE)) {
        const raw = fs.readFileSync(MACRO_FILE, 'utf-8');
        const macro = JSON.parse(raw);
        if (macro.indicators?.vix_india?.price) {
          indiaVix = macro.indicators.vix_india.price;
          indiaVixChangePct = macro.indicators.vix_india.change_1d_pct ?? 0;
        }
        if (macro.indicators?.crude?.change_1d_pct) {
          brentCrudeChangePct = macro.indicators.crude.change_1d_pct;
        }
        if (macro.indicators?.usdinr?.change_1d_pct) {
          usdinrChangePct = macro.indicators.usdinr.change_1d_pct;
        }
      }
    } catch (e) {
      console.warn('[Market Outlook API] Failed to parse macro snapshot:', e);
    }

    // 3. Compute Tomorrow's Market Outlook with explicit data provenance
    const outlook = calculateTomorrowMarketOutlook({
      niftyPrice,
      niftyChange1d,
      niftyChange1dPct,
      niftyHistory,
      indiaVix,
      indiaVixChangePct,
      advanceCount: 1350,
      declineCount: 880,
      brentCrudeChangePct,
      usdinrChangePct,
      dataSource: liveQuote ? 'provider' : 'simulated',
      isFallback: !liveQuote,
      quoteStatus: liveQuote ? liveQuote.quoteStatus : 'simulated',
      quoteAsOf: liveQuote?.quoteAsOf,
    });

    const responsePayload = {
      success: true,
      source: liveQuote ? 'yahoo-finance' : 'simulated',
      isFallback: !liveQuote,
      retrievedAt: new Date(Date.now()).toISOString(),
      data: outlook,
    };

    cachedOutlook = responsePayload;
    cachedOutlookExpires = Date.now() + freshTtlMs;
    return responsePayload;
  } catch (error: any) {
    console.error('[Market Outlook API] Error:', error);
    return { success: false, error: error.message || 'Failed to compute market outlook' };
  } finally {
    pendingOutlookPromise = null;
  }
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  // 1. Fresh cache hit
  if (cachedOutlook && cachedOutlookExpires > now) {
    return NextResponse.json(serveOutlookSnapshot(cachedOutlook, now));
  }

  // 2. Stale-While-Revalidate: return immediately if within maxStaleMs, revalidate in background
  if (cachedOutlook) {
    if (isSnapshotExpired(cachedOutlook.retrievedAt, maxStaleMs, now)) {
      cachedOutlook = null;
    } else {
      if (!pendingOutlookPromise) {
        pendingOutlookPromise = executeOutlookFetch();
      }
      return NextResponse.json(serveOutlookSnapshot(cachedOutlook, now));
    }
  }

  // 3. Cold boot or expired snapshot
  if (pendingOutlookPromise) {
    const data = await pendingOutlookPromise;
    return NextResponse.json(serveOutlookSnapshot(data, now), { status: data.success ? 200 : 503 });
  }

  pendingOutlookPromise = executeOutlookFetch();
  const result = await pendingOutlookPromise;
  return NextResponse.json(serveOutlookSnapshot(result, now), { status: result.success ? 200 : 503 });
}
