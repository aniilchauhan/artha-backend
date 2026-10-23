import { NextRequest, NextResponse } from 'next/server';
import { getLiveDataHub } from '../../../lib/live-data-hub';
import { generateInstantDecisions, heuristicDecisionProvider } from '../../../lib/instant-decision-engine';
import { fetchSingleTick } from '../../../lib/price-stream';

export const dynamic = 'force-dynamic';

/**
 * POST /api/live-decisions
 *
 * Fetches live prices, ingests them into the Live Data Hub,
 * and generates instant LLM-powered trade decisions.
 *
 * Body:
 * - symbols: string[] — NSE tickers to analyze (required)
 * - useLLM?: boolean — Whether to use Gemini (default: true, falls back to heuristic)
 *
 * Response:
 * - decisions: InstantDecision[] — trade signals with entry/exit/confidence
 * - marketContext: market breadth and bias
 * - snapshots: live data snapshots for each symbol
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbols: string[] = body.symbols;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Provide an array of NSE symbols (e.g., ["RELIANCE", "TCS"])' },
        { status: 400 }
      );
    }

    if (symbols.length > 20) {
      return NextResponse.json(
        { success: false, error: 'Maximum 20 symbols per request' },
        { status: 400 }
      );
    }

    const hub = getLiveDataHub();
    const startTime = Date.now();

    // 1. Fetch fresh live prices and ingest into hub
    const fetchResults = await Promise.allSettled(
      symbols.map(async sym => {
        const tick = await fetchSingleTick(sym);
        if (tick) {
          hub.ingestTick(tick);
          return tick;
        }
        return null;
      })
    );

    const successfulTicks = fetchResults
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    const failedSymbols = symbols.filter((sym, i) =>
      fetchResults[i].status === 'rejected' ||
      (fetchResults[i].status === 'fulfilled' && (fetchResults[i] as PromiseFulfilledResult<any>).value === null)
    );

    if (successfulTicks.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Could not fetch live prices for any of the provided symbols', failedSymbols },
        { status: 503 }
      );
    }

    // 2. Build LLM context from hub
    const context = hub.buildLLMContext(symbols);

    // 3. Generate decisions (Gemini → heuristic fallback)
    const useLLM = body.useLLM !== false;
    let batch;

    if (useLLM) {
      batch = await generateInstantDecisions(context, symbols);
    } else {
      batch = heuristicDecisionProvider(context);
    }

    // 4. Gather snapshots
    const snapshots = symbols
      .map(s => hub.getSnapshot(s))
      .filter(s => s !== null);

    const totalLatencyMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      decisions: batch.decisions,
      marketContext: batch.marketContext,
      snapshots,
      sessionStats: hub.getSessionStats(),
      meta: {
        symbolsRequested: symbols.length,
        symbolsFetched: successfulTicks.length,
        failedSymbols: failedSymbols.length > 0 ? failedSymbols : undefined,
        decisionSource: batch.decisions[0]?.source ?? 'none',
        decisionModel: batch.decisions[0]?.model ?? 'none',
        totalLatencyMs,
        fetchLatencyMs: totalLatencyMs - batch.totalLatencyMs,
        inferenceLatencyMs: batch.totalLatencyMs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to generate live decisions' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const hub = getLiveDataHub();
  return NextResponse.json({
    success: true,
    service: 'live-decisions',
    description: 'Gemini-powered instant trade decision engine with live NSE price feeds',
    sessionStats: hub.getSessionStats(),
    snapshots: hub.getAllSnapshots(),
    timestamp: new Date().toISOString(),
  });
}
