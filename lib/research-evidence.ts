import type { CachedStock } from './stock-fetcher';
import { buildPredictionAiContext } from './prediction-ai';
import type { ResearchEvidence, ResearchSnapshot } from './research-types';

const DAY = 86_400_000;
const text = (value: unknown, limit = 500) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function normalizeResearchNews(ticker: string, raw: unknown, now: number): ResearchEvidence[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: ResearchEvidence[] = [];
  for (const item of raw) {
    if (!item || !Array.isArray(item.relatedTickers) || !item.relatedTickers.includes(`${ticker}.NS`)) continue;
    const title = text(item.title, 300), publisher = text(item.publisher, 100);
    const timestamp = item.providerPublishTime instanceof Date ? item.providerPublishTime.getTime()
      : typeof item.providerPublishTime === 'number' ? item.providerPublishTime * 1000
      : typeof item.providerPublishTime === 'string' ? Date.parse(item.providerPublishTime) : NaN;
    if (!title || !publisher || !Number.isFinite(timestamp) || timestamp > now || now - timestamp > 30 * DAY) continue;
    let url: URL;
    try { url = new URL(item.link); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({ id: `news.${result.length + 1}`, category: 'news', label: 'Company-linked headline', value: title,
      unit: null, source: `${publisher} via Yahoo Finance`, url: url.href, asOf: new Date(timestamp).toISOString(), retrievedAt: new Date(now).toISOString() });
    if (result.length === 6) break;
  }
  return result;
}

export function buildResearchSnapshot(ticker: string, quote: CachedStock | null, summary: any, news: unknown, now = Date.now()): ResearchSnapshot {
  const collectedAt = new Date(now).toISOString();
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(`${ticker}.NS`)}/`;
  const evidence: ResearchEvidence[] = [];
  const limitations: string[] = [];
  const add = (category: ResearchEvidence['category'], key: string, label: string, value: string | number, unit: string | null, asOf: string | null) => {
    evidence.push({ id: `${category}.${key}`, category, label, value, unit, asOf, retrievedAt: collectedAt, source: 'Yahoo Finance', url });
  };
  try {
    const context = buildPredictionAiContext(ticker, quote, null, false, now);
    const labels: Record<string, [string, string | null]> = {
      close: ['Last completed daily close', 'INR'], sma20: ['20-session average close', 'INR'], sma50: ['50-session average close', 'INR'],
      return1dPct: ['1-session close return', '%'], return5dPct: ['5-session close return', '%'], return20dPct: ['20-session close return', '%'],
      volatility20dPct: ['20-session daily return volatility', '%'], rsi14: ['Wilder RSI (14)', null],
      high20dClose: ['Highest close in 20 sessions', 'INR'], low20dClose: ['Lowest close in 20 sessions', 'INR'],
    };
    for (const [key, [label, unit]] of Object.entries(labels)) {
      if (!finite(context.metrics[key])) continue;
      add('price', key, label, context.metrics[key], unit, context.historyAsOf);
      // Keep the original retrieval time if the quote came from the shared quote cache.
      if (quote?.fetchedAt && Number.isFinite(Date.parse(quote.fetchedAt))) evidence[evidence.length - 1].retrievedAt = quote.fetchedAt;
    }
    limitations.push(`Price metrics use completed daily bars through ${context.historyAsOf}; latest provider quote ${context.quoteAsOf} (${context.quoteStatus}). Intraday and unconfirmed bars are excluded.`);
  } catch {
    limitations.push('Price research unavailable: a fresh, timestamped NSE quote and at least 50 completed daily observations are required.');
  }

  // Verify identity and currency using the price module fetched in the same provider request.
  if (summary?.price?.symbol === `${ticker}.NS` && summary.price.currency === 'INR') {
    const asset = summary.assetProfile;
    for (const [key, label] of [['longBusinessSummary', 'Business description'], ['sector', 'Sector'], ['industry', 'Industry']]) {
      const value = text(asset?.[key], key === 'longBusinessSummary' ? 1400 : 100);
      if (value) add('fundamentals', key, label, value, null, null);
    }
    const detail = summary.summaryDetail;
    if (finite(detail?.trailingPE) && detail.trailingPE > 0) add('fundamentals', 'trailingPE', 'Trailing price/earnings', detail.trailingPE, '×', null);
    const financial = summary.financialData;
    for (const [key, label] of [['returnOnEquity', 'Return on equity'], ['profitMargins', 'Profit margin'], ['revenueGrowth', 'Revenue growth']]) {
      const value = financial?.[key];
      if (finite(value) && Number.isFinite(value * 100)) add('fundamentals', key, label, Number((value * 100).toFixed(4)), '%', null);
    }
    if (finite(financial?.debtToEquity) && financial.debtToEquity >= 0) add('fundamentals', 'debtToEquity', 'Debt/equity (provider percentage)', financial.debtToEquity, '%', null);
    if (financial?.financialCurrency === 'INR') {
      for (const [key, label] of [['totalRevenue', 'Total revenue'], ['totalDebt', 'Total debt'], ['freeCashflow', 'Free cash flow']]) {
        if (finite(financial[key])) add('fundamentals', key, label, financial[key], 'INR', null);
      }
    }
  }
  if (evidence.some(item => item.category === 'fundamentals')) {
    limitations.push('Fundamental metrics are provider observations with unverified reporting periods. Retrieval time is not the filing date; annual reports and exchange filings have not been checked.');
  } else limitations.push('Company fundamentals are unavailable from the provider; no generated substitutes are used.');

  const headlines = normalizeResearchNews(ticker, news, now);
  evidence.push(...headlines);
  limitations.push(headlines.length ? 'News coverage contains company-linked headlines from the last 30 days, not full articles or verified exchange announcements.'
    : 'No usable company-linked headlines from the last 30 days were returned. This does not establish that no news exists.');
  return { ticker, collectedAt, evidence, limitations };
}
