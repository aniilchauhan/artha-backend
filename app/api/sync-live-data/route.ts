import { NextRequest, NextResponse } from 'next/server';
import { fetchProviderChart, normalizeChart } from '../../../lib/market-quote';
import { executePythonScript } from '../../../lib/python-runner';
import { requireAdmin, verifyRequestOrigin } from '../../../lib/auth-guard';

export const dynamic = 'force-dynamic';

type IndexQuote = NonNullable<Awaited<ReturnType<typeof fetchLiveIndex>>>;
async function fetchLiveIndex(ticker: string) {
  const quote = normalizeChart(ticker, await fetchProviderChart(ticker));
  return quote ? { symbol: ticker, price: quote.currentPrice, change: quote.change, changePercent: quote.changePercent,
    quoteAsOf: quote.quoteAsOf, fetchedAt: quote.fetchedAt, dataSource: quote.dataSource, quoteStatus: quote.quoteStatus } : null;
}

export async function POST(req: NextRequest) {
  if (!verifyRequestOrigin(req)) {
    return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
  }
  const auth = await requireAdmin(req);
  if (!auth.authorized) return auth.response;
  try {
    const startTime = Date.now();

    // 1. Fetch live market benchmarks in parallel
    const benchmarkTickers = ['^NSEI', '^BSESN', '^INDIAVIX', '^NSEBANK'];
    const indexResults = await Promise.all(benchmarkTickers.map(t => fetchLiveIndex(t)));
    const liveIndices = indexResults.filter((idx): idx is IndexQuote => idx !== null);

    if (liveIndices.length === 0) return NextResponse.json({ success: false, error: 'Timestamped benchmark quotes are unavailable.' }, { status: 503 });

    // 2. Run swing outcome reconciliation script
    let swingReconciled = null;
    try {
      const pyResult = await executePythonScript({
        scriptName: 'scripts/reconcile_swing_outcomes.py',
        args: [],
        timeoutMs: 30000,
        lockKey: 'swing-reconciliation',
      });
      if (pyResult.success) {
        swingReconciled = { status: 'reconciled', durationMs: pyResult.durationMs };
      } else {
        return NextResponse.json(
          { success: false, error: pyResult.error || pyResult.stderr || 'Reconciliation failed' },
          { status: 502 }
        );
      }
    } catch (e: any) {
      console.warn('[SyncLiveData] Swing reconciliation script warning:', e.message);
      swingReconciled = { status: 'skipped', error: e.message };
    }

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      durationMs,
      syncedBenchmarksCount: liveIndices.length,
      benchmarks: liveIndices,
      swingReconciliation: swingReconciled,
      message: `Retrieved timestamped provider benchmarks and reconciled active positions in ${durationMs}ms.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to sync live market data' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ success: true, service: 'sync-live-data', timestamp: new Date().toISOString() });
}
