import type { FrameworkBar } from './framework-types';

export function sma(values: number[], period: number, offset = 0): number | null {
  if (!Number.isInteger(period) || period < 1 || !Number.isInteger(offset) || offset < 0 || values.length < period + offset) return null;
  const slice = values.slice(values.length - offset - period, values.length - offset);
  return slice.every(Number.isFinite) ? slice.reduce((a, b) => a + b, 0) / period : null;
}

export function wilderRsi(values: number[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || values.length <= period || !values.every(n => Number.isFinite(n) && n > 0)) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(0, change) / period;
    loss += Math.max(0, -change) / period;
  }
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
  }
  // Explicit Axion convention for an entirely flat series.
  return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function wilderAtr(bars: FrameworkBar[], period = 14): number | null {
  if (!Number.isInteger(period) || period < 1 || bars.length < period) return null;
  const ranges = bars.map((b, i) => Math.max(b.high - b.low,
    i ? Math.abs(b.high - bars[i - 1].close) : 0, i ? Math.abs(b.low - bars[i - 1].close) : 0));
  if (!ranges.every(n => Number.isFinite(n) && n >= 0)) return null;
  let atr = ranges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < ranges.length; i++) atr = (atr * (period - 1) + ranges[i]) / period;
  return atr;
}

export function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

/** Conservative: use only weeks preceding the cutoff week, including on Fridays.
 * This avoids treating holiday-shortened or special weekend sessions as complete too early.
 * Discard the first week because the requested history can start midway through it.
 */
export function completedWeeklyBars(bars: FrameworkBar[], cutoff: string): FrameworkBar[] {
  const groups = new Map<string, FrameworkBar>();
  for (const b of bars) {
    const key = weekStart(b.day);
    if (key >= weekStart(cutoff)) continue;
    const previous = groups.get(key);
    groups.set(key, previous ? { ...previous, day: b.day, high: Math.max(previous.high, b.high),
      low: Math.min(previous.low, b.low), close: b.close, volume: previous.volume + b.volume } : { ...b });
  }
  return [...groups.values()].slice(1);
}

export function relativeStrength(stock: FrameworkBar[], benchmark: FrameworkBar[], offset = 0): number | null {
  const end = stock.length - 1 - offset;
  if (end < 55) return null;
  const index = new Map(benchmark.map(b => [b.day, b.close]));
  const window = stock.slice(end - 55, end + 1);
  if (window.some(b => !index.has(b.day))) return null;
  const first = window[0], last = window[55];
  return 100 * ((last.close / first.close) / (index.get(last.day)! / index.get(first.day)!) - 1);
}
