/**
 * Axion Operational Latency Budget and SLA Monitor
 * 
 * Tracks rolling API and engine latencies, computes percentiles (p50, p90, p95, p99),
 * and flags breaches against operational SLA budgets.
 */

export interface LatencySLA {
  p95MaxMs: number;
  p99MaxMs: number;
}

export const DEFAULT_LATENCY_SLAS: Record<string, LatencySLA> = {
  'market-quote': { p95MaxMs: 250, p99MaxMs: 500 },
  'predictions': { p95MaxMs: 800, p99MaxMs: 1500 },
  'screener': { p95MaxMs: 1200, p99MaxMs: 2500 },
  'database-query': { p95MaxMs: 50, p99MaxMs: 150 },
  'healthcheck': { p95MaxMs: 50, p99MaxMs: 100 },
};

export interface LatencyStats {
  operation: string;
  sampleCount: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  meanMs: number;
  maxMs: number;
  slaBreached: boolean;
  sla: LatencySLA;
}

class LatencyTracker {
  private samples: Map<string, number[]> = new Map();
  private maxSamplesPerOp: number;

  constructor(maxSamplesPerOp = 1000) {
    this.maxSamplesPerOp = maxSamplesPerOp;
  }

  public record(operation: string, durationMs: number): void {
    if (isNaN(durationMs) || durationMs < 0) return;
    
    let list = this.samples.get(operation);
    if (!list) {
      list = [];
      this.samples.set(operation, list);
    }

    list.push(durationMs);
    if (list.length > this.maxSamplesPerOp) {
      list.shift();
    }
  }

  public getStats(operation: string): LatencyStats | null {
    const list = this.samples.get(operation);
    if (!list || list.length === 0) return null;

    const sorted = [...list].sort((a, b) => a - b);
    const count = sorted.length;

    const percentile = (p: number): number => {
      const idx = Math.min(count - 1, Math.max(0, Math.floor(count * p)));
      return parseFloat(sorted[idx].toFixed(2));
    };

    const sum = sorted.reduce((acc, val) => acc + val, 0);
    const meanMs = parseFloat((sum / count).toFixed(2));
    const maxMs = parseFloat(sorted[count - 1].toFixed(2));
    const p50Ms = percentile(0.50);
    const p90Ms = percentile(0.90);
    const p95Ms = percentile(0.95);
    const p99Ms = percentile(0.99);

    const sla = DEFAULT_LATENCY_SLAS[operation] || { p95MaxMs: 1000, p99MaxMs: 2000 };
    const slaBreached = p95Ms > sla.p95MaxMs || p99Ms > sla.p99MaxMs;

    return {
      operation,
      sampleCount: count,
      p50Ms,
      p90Ms,
      p95Ms,
      p99Ms,
      meanMs,
      maxMs,
      slaBreached,
      sla,
    };
  }

  public getAllStats(): Record<string, LatencyStats> {
    const res: Record<string, LatencyStats> = {};
    for (const op of this.samples.keys()) {
      const stats = this.getStats(op);
      if (stats) res[op] = stats;
    }
    return res;
  }

  public reset(operation?: string): void {
    if (operation) {
      this.samples.delete(operation);
    } else {
      this.samples.clear();
    }
  }
}

export const globalLatencyTracker = new LatencyTracker();

/**
 * Wraps an asynchronous operation with latency tracking.
 */
export async function trackLatency<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    globalLatencyTracker.record(operation, duration);
  }
}
