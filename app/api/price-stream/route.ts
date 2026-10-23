import { NextRequest } from 'next/server';
import { createPriceStream, validateStreamParams, STREAM_CONFIG } from '../../../lib/price-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/price-stream?symbols=RELIANCE,TCS&interval=15000
 *
 * Server-Sent Events (SSE) endpoint for live price streaming.
 * Emits price ticks at configurable intervals for subscribed symbols.
 *
 * Events:
 * - subscribed: Initial confirmation with stream parameters
 * - tick: Price update for a symbol
 * - heartbeat: Keep-alive with uptime stats
 * - error: Per-symbol fetch error
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const result = validateStreamParams({
    symbols: url.searchParams.get('symbols') ?? undefined,
    interval: url.searchParams.get('interval') ?? undefined,
  });

  if ('error' in result) {
    return new Response(JSON.stringify({ success: false, error: result.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const controller = new AbortController();

  // Abort when client disconnects
  req.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const { stream } = createPriceStream(result.symbols, result.intervalMs, controller.signal);

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
