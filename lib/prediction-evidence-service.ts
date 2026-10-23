import YahooFinance from 'yahoo-finance2';
import { fetchStockQuote } from './stock-fetcher';
import { fetchProviderChart, normalizeChart } from './market-quote';
import { fetchPredictionDiscovery } from './prediction-discovery-service';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

export async function fetchPredictionInputs(ticker: string) {
  const symbol = `${ticker}.NS`;
  const [quote, summary, news, benchmark, discovery] = await Promise.allSettled([
    fetchStockQuote(ticker),
    yahoo.quoteSummary(symbol, { modules: ['price', 'assetProfile', 'summaryDetail', 'financialData', 'calendarEvents'] },
      { fetchOptions: { signal: AbortSignal.timeout(12_000) } }),
    yahoo.search(symbol, { quotesCount: 1, newsCount: 12 },
      { fetchOptions: { signal: AbortSignal.timeout(12_000) } }),
    fetchProviderChart('^NSEI').then(chart => normalizeChart('^NSEI', chart)),
    fetchPredictionDiscovery(ticker),
  ]);
  return {
    quote: quote.status === 'fulfilled' ? quote.value : null,
    summary: summary.status === 'fulfilled' ? summary.value : null,
    news: news.status === 'fulfilled' ? news.value.news : [],
    benchmark: benchmark.status === 'fulfilled' ? benchmark.value : null,
    discovery: discovery.status === 'fulfilled' ? discovery.value : {
      sources: [], coverage: (['web', 'x', 'instagram'] as const).map(category => ({ category,
        status: 'unavailable' as const, detail: 'Source collection failed. Coverage is unknown.' })),
      limitations: ['Web and social collection failed; their coverage is unknown.'],
    },
  };
}
