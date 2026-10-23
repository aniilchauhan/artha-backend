import { indiaDay } from './market-quote';
import type { FrameworkBar, FrameworkHistory } from './framework-types';

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const DAY = 86_400_000;

/** Normalize one provider response; never promote incomplete/duplicate/invalid bars. */
export function normalizeFrameworkChart(symbol: string, chart: any, now = Date.now()): FrameworkHistory {
  const meta = chart?.meta;
  const observed = meta?.regularMarketTime * 1000;
  const start = meta?.currentTradingPeriod?.regular?.start * 1000;
  const end = meta?.currentTradingPeriod?.regular?.end * 1000;
  if (!meta || meta.symbol !== symbol || meta.currency !== 'INR' || !positive(observed) || observed > now ||
      now - observed > 7 * DAY || !positive(start) || !positive(end) || end <= start ||
      !Array.isArray(chart.timestamp) || chart.timestamp.length > 800) {
    throw new Error('Provider identity, session metadata, currency, or freshness is unavailable.');
  }
  const observedDay = indiaDay(new Date(observed));
  const sessionDay = indiaDay(new Date(start));
  // Require the provider to have observed the latest advertised completed session.
  if (now >= end && sessionDay > observedDay) throw new Error('Latest provider session has no confirmed observation.');
  const series = chart.indicators?.quote?.[0];
  if (!series) throw new Error('OHLCV history is unavailable.');
  const seen = new Set<string>();
  let bars: FrameworkBar[] = [];
  let emptyRows = 0;
  for (let i = 0; i < chart.timestamp.length; i++) {
    const stamp = chart.timestamp[i] * 1000;
    if (!positive(stamp) || stamp > observed) throw new Error('History includes invalid or future observations.');
    const day = indiaDay(new Date(stamp));
    // Latest observed day requires a matching session and a post-close retrieval.
    if (day === observedDay && !(sessionDay === day && indiaDay(new Date(end)) === day && now >= end)) continue;
    if (day > observedDay) continue;
    if (seen.has(day)) throw new Error('Duplicate daily observations are not usable.');
    seen.add(day);
    const open = series.open?.[i], high = series.high?.[i], low = series.low?.[i], close = series.close?.[i], volume = series.volume?.[i];
    // Yahoo can emit all-null calendar placeholders for non-trading days.
    // They are not observations. Partial candles still invalidate the response.
    if ([open, high, low, close, volume].every(value => value === null)) { emptyRows++; continue; }
    if (![open, high, low, close].every(positive) || typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 ||
        high < Math.max(open, close) || low > Math.min(open, close)) throw new Error('History contains invalid OHLCV observations.');
    bars.push({ day, open, high, low, close, volume });
  }
  bars.sort((a, b) => a.day.localeCompare(b.day));
  const limitations = [
    'Provider OHLC price-return series; dividends are not reinvested. No exchange-certified execution prices.',
    'Session freshness uses provider trading-period metadata, not an independently verified exchange calendar.',
    'The current calendar week is excluded from weekly checks, even after Friday close.',
  ];
  if (emptyRows) limitations.push(`${emptyRows} all-null provider calendar placeholders were omitted; no prices or volumes were filled.`);
  // Avoid mixing bases across reported splits. We do not infer adjustment factors.
  const splits = Object.values(chart.events?.splits ?? {}) as Array<{ date?: number }>;
  if (splits.some(event => !positive(event.date))) throw new Error('Corporate-action timestamps are invalid.');
  const splitDays = splits.filter(event => event.date! * 1000 <= now).map(event => indiaDay(new Date(event.date! * 1000))).sort();
  const lastSplit = splitDays.at(-1);
  if (lastSplit) {
    bars = bars.filter(bar => bar.day > lastSplit);
    limitations.push(`Only observations after the reported split on ${lastSplit} are used; earlier adjustment factors are unverified.`);
  }
  if (!bars.length) throw new Error('No completed daily observations are available.');
  if (now >= end && sessionDay === observedDay && bars.at(-1)!.day !== observedDay) {
    throw new Error('The latest completed session bar is missing.');
  }
  return {
    symbol, currency: 'INR', source: 'Yahoo Finance',
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`,
    retrievedAt: new Date(now).toISOString(), observedAt: new Date(observed).toISOString(),
    cutoff: bars.at(-1)!.day, origin: 'provider', adjustment: 'provider-ohlc-post-split', bars, limitations,
  };
}

// Only public normalized histories enter this bounded cache. No account/scenario data.
const cache = new Map<string, { expires: number; data: FrameworkHistory }>();
const pending = new Map<string, Promise<FrameworkHistory>>();
export async function fetchFrameworkHistory(symbol: string, fetcher: typeof fetch = fetch): Promise<FrameworkHistory> {
  if (symbol !== '^NSEI' && !/^[A-Z0-9&_-]{1,30}\.NS$/.test(symbol)) throw new Error('Unsupported NSE symbol.');
  const cached = cache.get(symbol);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.data);
  const inflight = pending.get(symbol);
  if (inflight) return structuredClone(await inflight);
  if (pending.size >= 4) throw new Error('Market-data service is busy. Try again shortly.');
  const request = (async () => {
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const response = await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=splits`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) continue;
        const body = await response.json();
        const data = normalizeFrameworkChart(symbol, body?.chart?.result?.[0]);
        if (cache.size >= 50) cache.delete(cache.keys().next().value!);
        cache.set(symbol, { data, expires: Date.now() + 60_000 });
        return data;
      } catch { /* Try the alternate host; preserve no stale fallback. */ }
    }
    throw new Error('Verified completed OHLCV history is unavailable from the provider.');
  })();
  pending.set(symbol, request);
  try { return structuredClone(await request); } finally { pending.delete(symbol); }
}
