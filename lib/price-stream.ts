/**
 * Live Price Streaming Engine — Server-Sent Events (SSE) Price Feed
 *
 * Provides real-time market price ticks via SSE for subscribed symbols.
 * Integrates with the bracket trailing stop engine for live stop ratcheting.
 *
 * Architecture:
 * - Server: SSE endpoint emits price ticks at configurable intervals
 * - Client: EventSource subscription with automatic reconnection
 * - Bracket: Live ticks feed into updateBracketTrailingStop() for real-time risk management
 */

import { fetchProviderChart, normalizeChart } from './market-quote';
import { stockSymbol } from './stock-fetcher';

// ─── Types ──────────────────────────────────────────────────────────────

export interface PriceTick {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteAsOf: string;
  fetchedAt: string;
  quoteStatus: 'recent' | 'delayed' | 'historical' | 'simulated';
}

export interface StreamSubscription {
  symbols: string[];
  intervalMs: number;
  startedAt: string;
  lastTickAt: string | null;
  tickCount: number;
  isActive: boolean;
}

export interface StreamHeartbeat {
  type: 'heartbeat';
  timestamp: string;
  uptimeMs: number;
  subscribedSymbols: number;
  totalTicks: number;
}

export type StreamEvent =
  | { type: 'tick'; data: PriceTick }
  | { type: 'heartbeat'; data: StreamHeartbeat }
  | { type: 'error'; data: { symbol: string; error: string } }
  | { type: 'subscribed'; data: { symbols: string[]; intervalMs: number } };

// ─── Configuration ──────────────────────────────────────────────────────

export const STREAM_CONFIG = {
  /** Default polling interval for price fetches (15 seconds) */
  DEFAULT_INTERVAL_MS: 15_000,
  /** Minimum allowed polling interval (5 seconds) */
  MIN_INTERVAL_MS: 5_000,
  /** Maximum symbols per subscription */
  MAX_SYMBOLS: 20,
  /** Heartbeat interval (30 seconds) */
  HEARTBEAT_INTERVAL_MS: 30_000,
  /** Maximum subscription duration (4 hours, covers full Indian market session) */
  MAX_DURATION_MS: 4 * 60 * 60 * 1000,
  /** SSE retry interval hint for clients (5 seconds) */
  SSE_RETRY_MS: 5_000,
} as const;

// ─── Server-Side Stream Manager ─────────────────────────────────────────

/**
 * Creates an SSE-compatible ReadableStream that emits price ticks for subscribed symbols.
 * The stream includes periodic heartbeats and automatic expiration.
 */
export function createPriceStream(
  symbols: string[],
  intervalMs: number = STREAM_CONFIG.DEFAULT_INTERVAL_MS,
  signal?: AbortSignal
): { stream: ReadableStream<Uint8Array>; subscription: StreamSubscription } {
  const validSymbols = symbols
    .map(s => stockSymbol(s))
    .filter((s): s is string => s !== null)
    .slice(0, STREAM_CONFIG.MAX_SYMBOLS);

  if (validSymbols.length === 0) {
    throw new Error('At least one valid symbol is required');
  }

  const effectiveInterval = Math.max(intervalMs, STREAM_CONFIG.MIN_INTERVAL_MS);
  const encoder = new TextEncoder();
  const startTime = Date.now();

  const subscription: StreamSubscription = {
    symbols: validSymbols,
    intervalMs: effectiveInterval,
    startedAt: new Date().toISOString(),
    lastTickAt: null,
    tickCount: 0,
    isActive: true,
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send initial subscription confirmation
      const subEvent: StreamEvent = {
        type: 'subscribed',
        data: { symbols: validSymbols, intervalMs: effectiveInterval },
      };
      controller.enqueue(encoder.encode(formatSSE(subEvent)));

      // Send SSE retry hint
      controller.enqueue(encoder.encode(`retry: ${STREAM_CONFIG.SSE_RETRY_MS}\n\n`));

      let priceInterval: ReturnType<typeof setInterval>;
      let heartbeatInterval: ReturnType<typeof setInterval>;
      let stopped = false;

      const stop = () => {
        if (stopped) return;
        stopped = true;
        subscription.isActive = false;
        clearInterval(priceInterval);
        clearInterval(heartbeatInterval);
        try { controller.close(); } catch { /* already closed */ }
      };

      // Handle abort signal
      signal?.addEventListener('abort', stop, { once: true });

      // Price tick polling
      const fetchTicks = async () => {
        if (stopped) return;

        // Check max duration
        if (Date.now() - startTime > STREAM_CONFIG.MAX_DURATION_MS) {
          stop();
          return;
        }

        for (const sym of validSymbols) {
          if (stopped) break;
          try {
            const tick = await fetchSingleTick(sym);
            if (tick && !stopped) {
              const event: StreamEvent = { type: 'tick', data: tick };
              controller.enqueue(encoder.encode(formatSSE(event)));
              subscription.lastTickAt = tick.fetchedAt;
              subscription.tickCount++;
            }
          } catch (err) {
            if (!stopped) {
              const event: StreamEvent = {
                type: 'error',
                data: { symbol: sym, error: err instanceof Error ? err.message : 'Fetch failed' },
              };
              controller.enqueue(encoder.encode(formatSSE(event)));
            }
          }
        }
      };

      // Heartbeat emitter
      const sendHeartbeat = () => {
        if (stopped) return;
        const heartbeat: StreamEvent = {
          type: 'heartbeat',
          data: {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            uptimeMs: Date.now() - startTime,
            subscribedSymbols: validSymbols.length,
            totalTicks: subscription.tickCount,
          },
        };
        try {
          controller.enqueue(encoder.encode(formatSSE(heartbeat)));
        } catch {
          stop();
        }
      };

      // Start fetching immediately, then on interval
      fetchTicks();
      priceInterval = setInterval(fetchTicks, effectiveInterval);
      heartbeatInterval = setInterval(sendHeartbeat, STREAM_CONFIG.HEARTBEAT_INTERVAL_MS);
    },
  });

  return { stream, subscription };
}

// ─── Price Fetcher ──────────────────────────────────────────────────────

/**
 * Fetches a single price tick for a symbol from the provider.
 */
export async function fetchSingleTick(symbol: string): Promise<PriceTick | null> {
  const ticker = stockSymbol(symbol);
  if (!ticker) return null;
  const rawChart = await fetchProviderChart(ticker);
  if (!rawChart) return null;

  const quote = normalizeChart(ticker, rawChart);
  if (!quote) return null;

  return {
    symbol: ticker.replace(/\.(NS|BO)$/i, ''),
    price: quote.currentPrice,
    change: quote.change,
    changePercent: quote.changePercent,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    quoteAsOf: quote.quoteAsOf,
    fetchedAt: quote.fetchedAt,
    quoteStatus: quote.quoteStatus,
  };
}

// ─── SSE Formatter ──────────────────────────────────────────────────────

/**
 * Formats a StreamEvent as an SSE text block (event: type\ndata: json\n\n).
 */
export function formatSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

// ─── Client-Side Hook Helpers ───────────────────────────────────────────

/**
 * Configuration for the client-side SSE price stream hook.
 */
export interface UseStreamConfig {
  symbols: string[];
  intervalMs?: number;
  enabled?: boolean;
  onTick?: (tick: PriceTick) => void;
  onHeartbeat?: (hb: StreamHeartbeat) => void;
  onError?: (err: { symbol: string; error: string }) => void;
}

/**
 * Builds the SSE endpoint URL with query parameters.
 */
export function buildStreamUrl(symbols: string[], intervalMs?: number): string {
  const params = new URLSearchParams();
  params.set('symbols', symbols.join(','));
  if (intervalMs) params.set('interval', String(intervalMs));
  return `/api/price-stream?${params.toString()}`;
}

/**
 * Validates stream parameters and returns normalized config.
 */
export function validateStreamParams(params: {
  symbols?: string;
  interval?: string;
}): { symbols: string[]; intervalMs: number } | { error: string } {
  const rawSymbols = params.symbols?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) ?? [];

  if (rawSymbols.length === 0) {
    return { error: 'At least one symbol is required (e.g., ?symbols=RELIANCE,TCS)' };
  }

  if (rawSymbols.length > STREAM_CONFIG.MAX_SYMBOLS) {
    return { error: `Maximum ${STREAM_CONFIG.MAX_SYMBOLS} symbols allowed per stream` };
  }

  const intervalMs = params.interval
    ? Math.max(Number(params.interval) || STREAM_CONFIG.DEFAULT_INTERVAL_MS, STREAM_CONFIG.MIN_INTERVAL_MS)
    : STREAM_CONFIG.DEFAULT_INTERVAL_MS;

  return { symbols: rawSymbols, intervalMs };
}
