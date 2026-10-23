import type { ShareOpportunity } from './opportunity-types';
import { currentOpportunity, indiaDate } from './opportunity-analysis';
import { fetchStockQuote } from './stock-fetcher';
import { auditStockLiquidity } from './liquidity-audit';

export async function currentShare(ticker: string): Promise<ShareOpportunity | null> {
  if (!/^[A-Z0-9&.-]{1,30}\.(NS|BO)$/.test(ticker)) return null;
  try {
    const quote = await fetchStockQuote(ticker);
    if (!quote) return null;
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(6000), cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const chart = payload.chart?.result?.[0];
    const meta = chart?.meta;
    const series = chart?.indicators?.quote?.[0];
    if (!meta || !series || meta.symbol !== quote.providerSymbol || meta.currency !== 'INR') return null;
    let weighted = 0, volume = 0;
    (chart.timestamp || []).forEach((timestamp: number, i: number) => {
      const close = series.close?.[i], v = series.volume?.[i];
      if (Number.isFinite(close) && Number.isFinite(v) && v > 0 &&
          timestamp >= meta.currentTradingPeriod?.regular?.start && timestamp <= meta.regularMarketTime &&
          indiaDate(new Date(timestamp * 1000)) === indiaDate(new Date())) {
        weighted += close * v; volume += v;
      }
    });
    const firstOpen = (series.open || []).find((v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const opp = currentOpportunity({
      ticker, name: meta.longName || meta.shortName || ticker,
      price: quote.currentPrice, timestamp: Date.parse(quote.quoteAsOf!) / 1000,
      previousClose: quote.currentPrice - quote.change,
      open: firstOpen, high: quote.high, low: quote.low,
      vwap: volume > 0 ? weighted / volume : null,
      sessionStart: meta.currentTradingPeriod?.regular?.start,
      sessionEnd: meta.currentTradingPeriod?.regular?.end,
    });
    if (!opp) return null;
    opp.direction = 'LONG';
    if (!opp.liquidityAudit) {
      opp.liquidityAudit = auditStockLiquidity(opp.ticker, opp.reference);
    }
    return opp;
  } catch { return null; }
}
