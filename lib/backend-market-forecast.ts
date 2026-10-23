import { fetchProviderChart, normalizeChart, quoteStatus } from './market-quote';
import { buildIndexForecast, validIndexObservation, type WholeMarketForecast } from './whole-market-forecast';
const definitions = [
  ['^NSEI', 'Nifty 50'], ['^NSEBANK', 'Nifty Bank'], ['^BSESN', 'Sensex'],
] as const;



export async function calculateWholeMarket(): Promise<WholeMarketForecast> {
  const now = Date.now();
  const symbols = [...definitions.map(([symbol]) => symbol), '^INDIAVIX'];
  const results = await Promise.allSettled(symbols.map(async symbol => normalizeChart(symbol, await fetchProviderChart(symbol))));
  const quotes = results.map(result => result.status === 'fulfilled' ? result.value : null);
  const vixQuote = quotes[3];
  const vix = validIndexObservation('^INDIAVIX', vixQuote, now) ? { value: vixQuote.currentPrice, quoteAsOf: vixQuote.quoteAsOf, status: quoteStatus(vixQuote, now) } : null;
  return { version: 'MARKET-OBSERVATION-v1', generatedAt: new Date(now).toISOString(), vix,
    indices: definitions.map(([symbol, name], index) => buildIndexForecast(symbol, name, quotes[index], vix, now)),
    scope: 'Indian benchmark coverage: Nifty 50, Nifty Bank and Sensex. These indices overlap and do not represent every listed stock; broad-market breadth is not measured.',
    limitations: [
      'Direction is a trend rule, not a calibrated probability. Scenario bands are historical 10th–90th percentiles, not guaranteed future bounds.',
      'History is approximately three months. Rolling windows overlap and are not independent; no regime conditioning or out-of-sample validation has been established.',
      'Horizons count available completed provider bars. An exchange holiday calendar and missing-session audit are not available; gaps may distort estimates. Intraday and future bars are excluded.',
      'Crash means a closing-level fall of at least 10% from a window’s starting close within the selected horizon. Historical counts are not future crash probabilities.',
      'No reliable crash date is available. Monitor the next 1–20 trading sessions as a review window, not a predicted event date. Trading sessions exclude closed days; no calendar dates are estimated.',
      'Stress thresholds are disclosed monitoring rules, not a trained crash model. Missing VIX, breadth, flows, news and unexpected events limit the assessment. Zero flags does not rule out a crash.',
    ] };
}
