import { fetchFrameworkHistory } from './framework-market-data';
import { buildFrameworkReport, type parseFrameworkRequest } from './framework-report';
import { backtestFrameworks } from './framework-backtest';

export async function getFrameworkReport(request: ReturnType<typeof parseFrameworkRequest>,
  loader = fetchFrameworkHistory, now = () => Date.now()) {
  const financialRequest = request.financials ? import('./framework-financial-service').then(module => module.fetchFrameworkFinancials(request.ticker)).catch(() => null) : null;
  const results = await Promise.allSettled([loader(`${request.ticker}.NS`), loader('^NSEI')]);
  const report = buildFrameworkReport(request.ticker,
    results[0].status === 'fulfilled' ? results[0].value : null,
    results[1].status === 'fulfilled' ? results[1].value : null,
    request.strategies, request.scenario, now());
  if (financialRequest) {
    const financials = await financialRequest;
    if (financials) report.financials = financials;
    else report.limitations.push('Annual financial-statement collection failed.');
    report.status = 'partial';
    report.limitations = report.limitations.filter(line => !line.startsWith('Financial statement, governance'));
    report.limitations.push('Annual statements are provider observations; governance disclosures and filing publication dates remain unverified. Delivery checks remain unavailable.');
  }
  if (request.backtest) {
    report.backtest = backtestFrameworks(request.ticker, report.inputs.stock, report.inputs.benchmark, request.strategies, now());
    report.limitations = report.limitations.filter(line => !line.startsWith('Reference levels expire'));
    report.limitations.push('Historical outcomes use the frozen simulation policy. Live fills and forward paper outcomes are not tracked.');
  }
  return report;
}

const quotas = new Map<string, { count: number; until: number }>();
export function consumeFrameworkQuota(owner: string, now = Date.now()): boolean {
  for (const [key, value] of quotas) if (value.until <= now) quotas.delete(key);
  if (!quotas.has(owner) && quotas.size >= 5000) return false;
  const quota = quotas.get(owner) ?? { count: 0, until: now + 60_000 };
  if (quota.count >= 6) return false;
  quota.count++;
  quotas.set(owner, quota);
  return true;
}
