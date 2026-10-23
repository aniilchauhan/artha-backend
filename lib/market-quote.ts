// Provider observations are not exchange-certified real-time quotes.
export interface QuoteProvenance {
  providerSymbol: string;
  currency: string;
  quoteAsOf: string;
  fetchedAt: string;
  sessionStart: string | null;
  sessionEnd: string | null;
  dataSource: 'provider' | 'simulated';
  quoteStatus: 'recent' | 'delayed' | 'historical' | 'simulated';
}

export function indiaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function isProviderStock(quote: any, now = Date.now()): boolean {
  if (!quote || typeof quote.ticker !== 'string' || typeof quote.providerSymbol !== 'string' || typeof quote.quoteAsOf !== 'string') return false;
  const ticker = quote.ticker.trim().toUpperCase();
  const expected = /\.(NS|BO)$/.test(ticker) ? ticker : `${ticker}.NS`;
  const observed = Date.parse(quote.quoteAsOf);
  return quote.providerSymbol.toUpperCase() === expected && quote.currency === 'INR' &&
    quote.dataSource === 'provider' && !quote.isFallback && positive(quote.currentPrice) &&
    Number.isFinite(quote.change) && Number.isFinite(quote.changePercent) &&
    Number.isFinite(observed) && observed <= now + 30_000;
}

export function quoteStatus(quote: Pick<QuoteProvenance, 'quoteAsOf' | 'sessionStart' | 'sessionEnd' | 'dataSource'>, now = Date.now()): QuoteProvenance['quoteStatus'] {
  if (quote.dataSource === 'simulated') return 'simulated';
  const observed = Date.parse(quote.quoteAsOf);
  const start = Date.parse(quote.sessionStart || '');
  const end = Date.parse(quote.sessionEnd || '');
  if (!Number.isFinite(observed) || observed > now + 30_000) return 'historical';
  if (now >= start && now <= end && observed >= start) {
    return now - observed <= 120_000 ? 'recent' : 'delayed';
  }
  return 'historical';
}

/** A status computed at fetch time goes stale; anything served from a cache must be re-labelled with the current time. */
export function withCurrentStatus<T>(quote: T, now = Date.now()): T {
  const q = quote as any;
  if (!q || typeof q !== 'object' || typeof q.quoteAsOf !== 'string') return quote;
  const dataSource = q.isFallback || q.dataSource !== 'provider' ? 'simulated' : 'provider';
  return { ...q, quoteStatus: quoteStatus({ quoteAsOf: q.quoteAsOf, sessionStart: q.sessionStart ?? null, sessionEnd: q.sessionEnd ?? null, dataSource }, now) };
}

export function quoteStatusLabel(status: unknown): string {
  switch (status) {
    case 'recent': return 'Recent quote';
    case 'delayed': return 'Delayed quote';
    case 'historical': return 'Last session quote';
    case 'simulated': return 'Simulated quote';
    default: return 'Quote status unknown';
  }
}

export function canUseQuoteForExecution(quote: Partial<QuoteProvenance> & { currentPrice?: number; isFallback?: boolean }, now = Date.now()): boolean {
  return !quote.isFallback && quote.dataSource === 'provider' && positive(quote.currentPrice) &&
    typeof quote.quoteAsOf === 'string' && quoteStatus({
      quoteAsOf: quote.quoteAsOf, sessionStart: quote.sessionStart ?? null,
      sessionEnd: quote.sessionEnd ?? null, dataSource: 'provider',
    }, now) === 'recent';
}

export function normalizeChart(symbol: string, chart: any, now = Date.now()) {
  const meta = chart?.meta;
  if (!meta || meta.symbol?.toUpperCase() !== symbol.toUpperCase() || meta.currency !== 'INR' ||
      !positive(meta.regularMarketPrice) || !positive(meta.regularMarketTime)) return null;
  const observed = meta.regularMarketTime * 1000;
  if (observed > now + 30_000) return null;
  const series = chart.indicators?.quote?.[0];
  if (!series || !Array.isArray(chart.timestamp)) return null;
  const history: Array<{ date: string; price: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  for (let i = 0; i < chart.timestamp.length; i++) {
    const timestamp = chart.timestamp[i];
    if (!positive(timestamp) || timestamp * 1000 > observed) continue;
    const open = series.open?.[i], high = series.high?.[i], low = series.low?.[i], close = series.close?.[i], volume = series.volume?.[i];
    if (![open, high, low, close].every(positive) || !nonnegative(volume) || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    history.push({ date: new Date(timestamp * 1000).toISOString(), price: close, open, high, low, close, volume });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  const observedDay = indiaDay(new Date(observed));
  const currentBar = history.findLast(bar => indiaDay(new Date(bar.date)) === observedDay);
  const previousBar = history.findLast(bar => indiaDay(new Date(bar.date)) < observedDay);
  // chartPreviousClose can refer to the beginning of a multi-month chart, not yesterday.
  const previousClose = positive(meta.previousClose) ? meta.previousClose : previousBar?.close;
  if (!positive(previousClose)) return null;
  const high = positive(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : currentBar?.high;
  const low = positive(meta.regularMarketDayLow) ? meta.regularMarketDayLow : currentBar?.low;
  const volume = nonnegative(meta.regularMarketVolume) ? meta.regularMarketVolume : currentBar?.volume;
  if (!positive(high) || !positive(low) || high < low || !nonnegative(volume)) return null;
  const provenance = {
    providerSymbol: symbol, currency: 'INR', quoteAsOf: new Date(observed).toISOString(), fetchedAt: new Date(now).toISOString(),
    sessionStart: positive(meta.currentTradingPeriod?.regular?.start) ? new Date(meta.currentTradingPeriod.regular.start * 1000).toISOString() : null,
    sessionEnd: positive(meta.currentTradingPeriod?.regular?.end) ? new Date(meta.currentTradingPeriod.regular.end * 1000).toISOString() : null,
    dataSource: 'provider' as const,
  };
  const currentPrice = meta.regularMarketPrice;
  return { ...provenance, quoteStatus: quoteStatus(provenance, now), currentPrice, previousClose,
    change: currentPrice - previousClose, changePercent: (currentPrice / previousClose - 1) * 100,
    high, low, volume, history, isFallback: false };
}

export async function fetchProviderChart(symbol: string, fetcher: typeof fetch = fetch) {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetcher(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(4000), cache: 'no-store',
      });
      if (!response.ok) continue;
      const payload = await response.json();
      const chart = payload?.chart?.result?.[0];
      if (normalizeChart(symbol, chart)) return chart;
    } catch { /* Try the alternate provider host; never manufacture a quote. */ }
  }
  return null;
}
