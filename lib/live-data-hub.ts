/**
 * Live Market Data Hub — Central Aggregator & Real-Time Distribution
 *
 * Collects live price ticks from the SSE stream engine and distributes them
 * to all consumers: bracket trailing stop engine, gap screener, portfolio
 * valuations, and the LLM decision engine.
 *
 * Architecture:
 * - Pub/Sub: Listeners subscribe to specific symbols or all-tick feeds
 * - Snapshot: Latest price state for each tracked symbol
 * - Derived: Computes intraday VWAP, momentum, and session statistics
 */

import type { PriceTick } from './price-stream';

// ─── Types ──────────────────────────────────────────────────────────────

export interface LiveSnapshot {
  symbol: string;
  price: number;
  previousClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePercent: number;
  /** Intraday tick count */
  tickCount: number;
  /** Intraday VWAP approximation */
  vwap: number;
  /** 1-minute momentum (latest price vs price 1 min ago) */
  momentum1m: number;
  /** 5-minute momentum */
  momentum5m: number;
  /** Session high-low range as % of open */
  intradayRangePercent: number;
  /** Price velocity: avg % change per tick */
  velocityBps: number;
  /** Consecutive ticks in same direction */
  trendStreak: number;
  trendDirection: 'UP' | 'DOWN' | 'FLAT';
  quoteStatus: string;
  firstTickAt: string;
  lastTickAt: string;
}

export interface SessionStats {
  totalSymbols: number;
  totalTicks: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  avgChangePercent: number;
  breadthRatio: number;
  sessionStartedAt: string;
  lastUpdateAt: string;
}

export type TickListener = (tick: PriceTick, snapshot: LiveSnapshot) => void;

// ─── Internal State ─────────────────────────────────────────────────────

interface TickHistory {
  prices: Array<{ price: number; timestamp: number }>;
  volumeSum: number;
  priceVolumeSum: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  streak: number;
}

// ─── Live Data Hub Class ────────────────────────────────────────────────

export class LiveDataHub {
  private snapshots = new Map<string, LiveSnapshot>();
  private tickHistories = new Map<string, TickHistory>();
  private listeners = new Map<string, Set<TickListener>>();
  private globalListeners = new Set<TickListener>();
  private sessionStartedAt = new Date().toISOString();
  private totalTicks = 0;

  /**
   * Ingest a new price tick from the SSE stream.
   * Updates snapshot, computes derived metrics, and notifies all listeners.
   */
  ingestTick(tick: PriceTick): LiveSnapshot {
    this.totalTicks++;

    // Get or create tick history
    let history = this.tickHistories.get(tick.symbol);
    if (!history) {
      history = { prices: [], volumeSum: 0, priceVolumeSum: 0, direction: 'FLAT', streak: 0 };
      this.tickHistories.set(tick.symbol, history);
    }

    const now = Date.now();
    history.prices.push({ price: tick.price, timestamp: now });
    // Keep last 30 minutes of ticks (approximate)
    const cutoff = now - 30 * 60 * 1000;
    history.prices = history.prices.filter(p => p.timestamp > cutoff);

    // VWAP components
    history.volumeSum += tick.volume;
    history.priceVolumeSum += tick.price * tick.volume;

    // Direction tracking
    const prevSnapshot = this.snapshots.get(tick.symbol);
    if (prevSnapshot) {
      const dir = tick.price > prevSnapshot.price ? 'UP' : tick.price < prevSnapshot.price ? 'DOWN' : 'FLAT';
      if (dir === history.direction && dir !== 'FLAT') {
        history.streak++;
      } else if (dir !== 'FLAT') {
        history.direction = dir;
        history.streak = 1;
      }
    } else {
      history.direction = tick.changePercent > 0 ? 'UP' : tick.changePercent < 0 ? 'DOWN' : 'FLAT';
      history.streak = 1;
    }

    // Compute momentums
    const prices1mAgo = history.prices.filter(p => p.timestamp <= now - 60_000);
    const prices5mAgo = history.prices.filter(p => p.timestamp <= now - 300_000);
    const price1m = prices1mAgo.length > 0 ? prices1mAgo[prices1mAgo.length - 1].price : tick.price;
    const price5m = prices5mAgo.length > 0 ? prices5mAgo[prices5mAgo.length - 1].price : tick.price;

    const momentum1m = price1m > 0 ? ((tick.price / price1m) - 1) * 100 : 0;
    const momentum5m = price5m > 0 ? ((tick.price / price5m) - 1) * 100 : 0;

    // Velocity: average bps per tick
    const velocityBps = history.prices.length > 1
      ? Math.abs(tick.price / history.prices[0].price - 1) * 10000 / history.prices.length
      : 0;

    const tickCount = (prevSnapshot?.tickCount ?? 0) + 1;
    const open = prevSnapshot?.open ?? tick.price;
    const previousClose = tick.price - tick.change;

    const snapshot: LiveSnapshot = {
      symbol: tick.symbol,
      price: tick.price,
      previousClose,
      open,
      high: Math.max(tick.high, prevSnapshot?.high ?? tick.high),
      low: Math.min(tick.low, prevSnapshot?.low ?? tick.low),
      volume: tick.volume,
      change: tick.change,
      changePercent: tick.changePercent,
      tickCount,
      vwap: history.volumeSum > 0 ? round(history.priceVolumeSum / history.volumeSum, 2) : tick.price,
      momentum1m: round(momentum1m, 4),
      momentum5m: round(momentum5m, 4),
      intradayRangePercent: open > 0 ? round(((Math.max(tick.high, prevSnapshot?.high ?? tick.high) - Math.min(tick.low, prevSnapshot?.low ?? tick.low)) / open) * 100, 2) : 0,
      velocityBps: round(velocityBps, 2),
      trendStreak: history.streak,
      trendDirection: history.direction,
      quoteStatus: tick.quoteStatus,
      firstTickAt: prevSnapshot?.firstTickAt ?? tick.fetchedAt,
      lastTickAt: tick.fetchedAt,
    };

    this.snapshots.set(tick.symbol, snapshot);

    // Notify listeners
    const symbolListeners = this.listeners.get(tick.symbol);
    if (symbolListeners) {
      for (const listener of symbolListeners) {
        try { listener(tick, snapshot); } catch { /* listener errors don't break the hub */ }
      }
    }
    for (const listener of this.globalListeners) {
      try { listener(tick, snapshot); } catch { /* listener errors don't break the hub */ }
    }

    return snapshot;
  }

  /** Subscribe to ticks for a specific symbol. Returns unsubscribe function. */
  subscribe(symbol: string, listener: TickListener): () => void {
    const key = symbol.toUpperCase();
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(listener);
    return () => { this.listeners.get(key)?.delete(listener); };
  }

  /** Subscribe to all ticks. Returns unsubscribe function. */
  subscribeAll(listener: TickListener): () => void {
    this.globalListeners.add(listener);
    return () => { this.globalListeners.delete(listener); };
  }

  /** Get latest snapshot for a symbol. */
  getSnapshot(symbol: string): LiveSnapshot | null {
    return this.snapshots.get(symbol.toUpperCase()) ?? null;
  }

  /** Get all current snapshots. */
  getAllSnapshots(): LiveSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Compute session-wide market statistics. */
  getSessionStats(): SessionStats {
    const snapshots = this.getAllSnapshots();
    const advancers = snapshots.filter(s => s.changePercent > 0).length;
    const decliners = snapshots.filter(s => s.changePercent < 0).length;
    const unchanged = snapshots.length - advancers - decliners;
    const avgChange = snapshots.length > 0
      ? snapshots.reduce((sum, s) => sum + s.changePercent, 0) / snapshots.length
      : 0;

    return {
      totalSymbols: snapshots.length,
      totalTicks: this.totalTicks,
      advancers,
      decliners,
      unchanged,
      avgChangePercent: round(avgChange, 2),
      breadthRatio: (advancers + decliners) > 0 ? round(advancers / (advancers + decliners), 2) : 0.5,
      sessionStartedAt: this.sessionStartedAt,
      lastUpdateAt: new Date().toISOString(),
    };
  }

  /** Build a compact context object suitable for LLM consumption. */
  buildLLMContext(symbols?: string[]): LiveDataLLMContext {
    const targetSnapshots = symbols
      ? symbols.map(s => this.getSnapshot(s)).filter((s): s is LiveSnapshot => s !== null)
      : this.getAllSnapshots();

    return {
      sessionStats: this.getSessionStats(),
      stocks: targetSnapshots.map(s => ({
        symbol: s.symbol,
        price: s.price,
        change: s.change,
        changePct: s.changePercent,
        high: s.high,
        low: s.low,
        volume: s.volume,
        vwap: s.vwap,
        momentum1m: s.momentum1m,
        momentum5m: s.momentum5m,
        rangePercent: s.intradayRangePercent,
        trendStreak: s.trendStreak,
        trendDir: s.trendDirection,
        velocityBps: s.velocityBps,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  /** Reset all state (new trading session). */
  reset(): void {
    this.snapshots.clear();
    this.tickHistories.clear();
    this.totalTicks = 0;
    this.sessionStartedAt = new Date().toISOString();
  }
}

// ─── LLM Context Type ──────────────────────────────────────────────────

export interface LiveDataLLMContext {
  sessionStats: SessionStats;
  stocks: Array<{
    symbol: string;
    price: number;
    change: number;
    changePct: number;
    high: number;
    low: number;
    volume: number;
    vwap: number;
    momentum1m: number;
    momentum5m: number;
    rangePercent: number;
    trendStreak: number;
    trendDir: 'UP' | 'DOWN' | 'FLAT';
    velocityBps: number;
  }>;
  timestamp: string;
}

// ─── Singleton ──────────────────────────────────────────────────────────

let globalHub: LiveDataHub | null = null;

export function getLiveDataHub(): LiveDataHub {
  if (!globalHub) globalHub = new LiveDataHub();
  return globalHub;
}

// ─── Utility ────────────────────────────────────────────────────────────

function round(value: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}
