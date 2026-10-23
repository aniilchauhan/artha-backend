import type { CachedStock } from './stock-fetcher';
import type { PredictionAiContext, PredictionEvidence } from './prediction-ai-types';
import { buildResearchSnapshot } from './research-evidence';
import { indiaDay, type normalizeChart } from './market-quote';

const DAY = 86_400_000;

/** Enrich a validated price context with provider evidence; missing sources stay missing. */
export function enrichPredictionContext(context: PredictionAiContext, quote: CachedStock,
  summary: any, news: unknown, benchmark: ReturnType<typeof normalizeChart>, now = Date.now()): PredictionAiContext {
  const snapshot = buildResearchSnapshot(context.ticker, quote, summary, news, now);
  const sources: PredictionEvidence[] = snapshot.evidence.filter(item => item.category !== 'price');
  const retrievedAt = new Date(now).toISOString();
  const stockUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(`${context.ticker}.NS`)}/`;
  const add = (category: PredictionEvidence['category'], id: string, label: string, value: string | number,
    unit: string | null, asOf: string | null, url = stockUrl, fetchedAt = retrievedAt) => {
    sources.push({ category, id, label, value, unit, asOf, url, retrievedAt: fetchedAt, source: 'Yahoo Finance' });
  };
  const referenceDay = indiaDay(new Date(context.historyAsOf));
  // Use exactly the completed stock sessions already accepted by the price context.
  const volumes = context.recentCloses.map(close => {
    const matches = quote.history.filter(bar => bar.date === close.date && bar.price === close.close);
    return matches.length === 1 ? matches[0].volume : undefined;
  });
  if (volumes.length === 20 && volumes.every((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
    const average = volumes.slice(0, -1).reduce((sum, v) => sum + v, 0) / 19;
    add('volume', 'volume.completedSession', 'Completed-session volume', volumes[19], 'shares', context.historyAsOf, stockUrl, quote.fetchedAt || retrievedAt);
    if (average > 0) add('volume', 'volume.ratio19', 'Volume / preceding 19-session average',
      Number((volumes[19] / average).toFixed(4)), '×', context.historyAsOf, stockUrl, quote.fetchedAt || retrievedAt);
  }

  if (benchmark && benchmark.providerSymbol === '^NSEI' && benchmark.currency === 'INR' &&
    benchmark.dataSource === 'provider' && !benchmark.isFallback &&
    Date.parse(benchmark.quoteAsOf) <= now && Date.parse(benchmark.fetchedAt) <= now &&
    now - Date.parse(benchmark.quoteAsOf) <= 4 * DAY) {
    const observedDay = indiaDay(new Date(benchmark.quoteAsOf));
    const end = Date.parse(benchmark.sessionEnd || '');
    const complete = Number.isFinite(end) && end <= now && indiaDay(new Date(end)) === observedDay &&
      Date.parse(benchmark.fetchedAt) >= end;
    const bars = benchmark.history.filter(bar => {
      const day = indiaDay(new Date(bar.date));
      return day <= referenceDay && (day < observedDay || complete);
    });
    const days = bars.map(bar => indiaDay(new Date(bar.date)));
    if (bars.length >= 21 && new Set(days).size === days.length && days.at(-1) === referenceDay) {
      const url = 'https://finance.yahoo.com/quote/%5ENSEI/';
      for (const sessions of [1, 5, 20]) {
        const value = (bars.at(-1)!.close / bars[bars.length - 1 - sessions].close - 1) * 100;
        add('market', `market.niftyReturn${sessions}dPct`, `Nifty ${sessions}-session return`, Number(value.toFixed(4)), '%', bars.at(-1)!.date, url, benchmark.fetchedAt);
      }
      const start = context.recentCloses.at(-6)!;
      const benchmarkStart = bars[bars.length - 6];
      if (indiaDay(new Date(start.date)) === indiaDay(new Date(benchmarkStart.date))) {
        const relative = context.metrics.return5dPct - (bars.at(-1)!.close / benchmarkStart.close - 1) * 100;
        add('market', 'market.relativeReturn5dPct', '5-session return minus Nifty', Number(relative.toFixed(4)), 'percentage points', context.historyAsOf, url, benchmark.fetchedAt);
      }
    }
  }

  if (summary?.price?.symbol === `${context.ticker}.NS` && summary.price.currency === 'INR') {
    const dates: unknown = summary.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(dates)) {
      const valid = dates.map(date => date instanceof Date ? date.getTime() : typeof date === 'string' ? Date.parse(date) : NaN)
        .filter(date => Number.isFinite(date) && date >= now - DAY && date <= now + 180 * DAY)
        .sort((a, b) => a - b);
      if (valid.length) add('events', 'events.earningsWindow', 'Provider-reported earnings date/window',
        [...new Set(valid.map(date => indiaDay(new Date(date))))].join(' to '), null, null);
    }
  }

  const categories = ['price', 'volume', 'market', 'fundamentals', 'news', 'events'] as const;
  const coverage = categories.map(category => ({ category,
    status: category === 'price' || sources.some(item => item.category === category) ? 'available' as const : 'unavailable' as const }));
  const limitations = [
    ...context.limitations.filter(value => !value.startsWith('Price-history assessment only:')),
    ...snapshot.limitations.filter(value => !value.startsWith('Price metrics use')),
    'Evidence is collected at request time; news and company observations can be newer than the reference close. This is not a historical replay.',
    'Earnings dates, when available, are provider-reported estimates or windows, not verified exchange announcements. Broader corporate actions and order flow are not supplied.',
  ];
  if (!sources.some(item => item.category === 'events')) limitations.push('No usable upcoming earnings date was returned; event risk remains unknown.');
  if (!sources.some(item => item.category === 'market')) limitations.push('Aligned completed Nifty history is unavailable; market confirmation is missing.');
  if (!sources.some(item => item.category === 'volume')) limitations.push('Completed-session volume history is unavailable; volume confirmation is missing.');
  return { ...context, sources, coverage, limitations: [...new Set(limitations)] };
}
