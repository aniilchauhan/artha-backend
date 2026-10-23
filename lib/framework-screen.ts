import { parseFrameworkRequest } from './framework-report';
import { getFrameworkReport } from './framework-report-service';
import type { FrameworkId, FrameworkEvaluation } from './framework-types';

export interface FrameworkScreen {
  generatedAt: string;
  universe: 'user_selected';
  rows: Array<{ ticker: string; cutoff: string | null; status: 'available' | 'unavailable';
    strategies: Array<Pick<FrameworkEvaluation, 'id' | 'name' | 'status'>>; error: string | null }>;
  limitations: string[];
}
export function parseFrameworkScreen(body: unknown): { tickers: string[]; strategies: FrameworkId[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A JSON request is required.');
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['tickers', 'strategies'].includes(key)) || !Array.isArray(raw.tickers) || raw.tickers.length < 1 || raw.tickers.length > 10) {
    throw new Error('Supply between 1 and 10 NSE tickers.');
  }
  const requests = raw.tickers.map(ticker => parseFrameworkRequest({ ticker, ...(raw.strategies !== undefined ? { strategies: raw.strategies } : {}) }));
  if (new Set(requests.map(r => r.ticker)).size !== requests.length) throw new Error('Duplicate tickers are not allowed.');
  return { tickers: requests.map(r => r.ticker), strategies: requests[0].strategies };
}
export async function screenFrameworks(input: ReturnType<typeof parseFrameworkScreen>, loader = getFrameworkReport): Promise<FrameworkScreen> {
  const rows: FrameworkScreen['rows'] = new Array(input.tickers.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(2, input.tickers.length) }, async () => {
    while (cursor < input.tickers.length) {
      const index = cursor++, ticker = input.tickers[index];
      try {
        const report = await loader({ ticker, strategies: input.strategies, scenario: null });
        rows[index] = { ticker, cutoff: report.cutoff, status: report.strategies.some(s => s.status !== 'unavailable') ? 'available' : 'unavailable',
          strategies: report.strategies.map(({ id, name, status }) => ({ id, name, status })), error: null };
      } catch { rows[index] = { ticker, cutoff: null, status: 'unavailable', strategies: [], error: 'Provider analysis unavailable.' }; }
    }
  }));
  return { generatedAt: new Date().toISOString(), universe: 'user_selected', rows, limitations: [
    'This scan covers only the supplied tickers, not the whole exchange or a historically verified universe.',
    'Each strategy retains its own conditions. Matched checks are not success probabilities.',
    'Unavailable rows are retained. Open a stock and run its report to inspect evidence and save a snapshot.',
  ] };
}
