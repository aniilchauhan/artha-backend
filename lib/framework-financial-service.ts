import YahooFinance from 'yahoo-finance2';
import { financialEvidence, FINANCIAL_FIELDS, normalizeAnnualStatements, type FinancialEvidence } from './framework-financials';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const cache = new Map<string, { expires: number; evidence: FinancialEvidence }>();
const pending = new Map<string, Promise<FinancialEvidence>>();

export async function fetchFrameworkFinancials(ticker: string): Promise<FinancialEvidence> {
  if (!/^[A-Z0-9&_-]{1,30}$/.test(ticker)) throw new Error('Invalid NSE ticker.');
  const saved = cache.get(ticker);
  if (saved && saved.expires > Date.now()) return structuredClone(saved.evidence);
  if (pending.has(ticker)) return structuredClone(await pending.get(ticker)!);
  if (pending.size >= 2) return financialEvidence(ticker, [], null);
  const request = (async () => {
    const now = Date.now();
    const sectorRequest = yahoo.quoteSummary(`${ticker}.NS`, { modules: ['price', 'assetProfile'] },
      { fetchOptions: { signal: AbortSignal.timeout(6000) } }).then(summary => summary.price?.symbol === `${ticker}.NS` && summary.price.currency === 'INR'
        ? summary.assetProfile?.sector ?? null : null).catch(() => null);
    let statements: ReturnType<typeof normalizeAnnualStatements> = [];
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const params = new URLSearchParams({ symbol: `${ticker}.NS`, type: FINANCIAL_FIELDS.map(key => `annual${key}`).join(','),
          period1: String(Math.floor((now - 7 * 366 * 86400000) / 1000)), period2: String(Math.floor(now / 1000)) });
        const response = await fetch(`https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(`${ticker}.NS`)}?${params}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(6000), cache: 'no-store',
        });
        if (!response.ok) continue;
        statements = normalizeAnnualStatements(ticker, await response.json(), now);
        if (statements.length) break;
      } catch { /* No guessed or generated statements on provider failure. */ }
    }
    const evidence = financialEvidence(ticker, statements, await sectorRequest, now);
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(ticker, { evidence, expires: now + (statements.length ? 300000 : 15000) });
    return evidence;
  })();
  pending.set(ticker, request);
  try { return structuredClone(await request); } finally { pending.delete(ticker); }
}
