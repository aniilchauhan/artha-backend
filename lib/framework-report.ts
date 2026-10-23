import { FRAMEWORK_IDS } from './framework-registry';
import { evaluateFrameworks } from './framework-evaluators';
import { sizePosition, type PositionScenario } from './position-sizing';
import type { FrameworkHistory, FrameworkId, FrameworkReport, ResearchHorizon } from './framework-types';
import type { CompanyResearchReport } from './research-types';

export function parseFrameworkRequest(body: unknown): { ticker: string; strategies: FrameworkId[]; scenario: PositionScenario | null; financials?: boolean; backtest?: boolean; horizon?: ResearchHorizon } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A JSON request is required.');
  const raw = body as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['ticker', 'strategies', 'scenario', 'financials', 'backtest', 'horizon'].includes(key))) throw new Error('Unexpected request field.');
  for (const field of ['financials', 'backtest']) if (raw[field] !== undefined && typeof raw[field] !== 'boolean') throw new Error('Analysis options must be boolean.');
  const ticker = typeof raw.ticker === 'string' ? raw.ticker.trim().toUpperCase().replace(/\.NS$/, '') : '';
  if (!/^[A-Z0-9&_-]{1,30}$/.test(ticker)) throw new Error('A valid NSE ticker is required.');
  const horizon = raw.horizon ?? 'week';
  if (!['week', 'month', 'year', 'multibagger'].includes(String(horizon))) throw new Error('Select a supported research horizon.');
  const strategies = raw.strategies ?? FRAMEWORK_IDS;
  if (!Array.isArray(strategies) || !strategies.length || strategies.length > FRAMEWORK_IDS.length ||
      new Set(strategies).size !== strategies.length || strategies.some(id => !FRAMEWORK_IDS.includes(id))) throw new Error('Select supported strategies without duplicates.');
  let scenario: PositionScenario | null = null;
  if (raw.scenario !== undefined && raw.scenario !== null) {
    if (typeof raw.scenario !== 'object' || Array.isArray(raw.scenario) || Object.keys(raw.scenario).some(key => ![
      'portfolioEquity', 'availableCash', 'entry', 'stop', 'riskFraction', 'maxAllocationFraction', 'entryCostFraction',
      'exitCostFraction', 'stopSlippageFraction', 'lotSize', 'sectorRoom', 'themeRoom', 'aggregateRiskRoom',
    ].includes(key))) throw new Error('Invalid scenario fields.');
    scenario = raw.scenario as PositionScenario;
    sizePosition(scenario);
  }
  return { ticker, strategies, scenario, ...(raw.horizon !== undefined ? { horizon: horizon as ResearchHorizon } : {}),
    ...(raw.financials === true || horizon === 'year' || horizon === 'multibagger' || horizon === 'month' ? { financials: true } : {}),
    ...(raw.backtest === true ? { backtest: true } : {}) };
}

export function buildFrameworkReport(ticker: string, stock: FrameworkHistory | null, benchmark: FrameworkHistory | null,
  ids: FrameworkId[] = FRAMEWORK_IDS, scenario: PositionScenario | null = null, now = Date.now()): FrameworkReport {
  // Do not accept arbitrary provider identities or forward-dated evidence, even from internal callers.
  const usable = (history: FrameworkHistory | null, symbol: string) => history?.symbol === symbol && history.origin === 'provider' &&
    history.currency === 'INR' && Date.parse(history.retrievedAt) <= now && Date.parse(history.observedAt) <= Date.parse(history.retrievedAt) ? history : null;
  stock = usable(stock, `${ticker}.NS`);
  benchmark = usable(benchmark, '^NSEI');
  const strategies = evaluateFrameworks(stock, benchmark, ids);
  const count = strategies.filter(s => s.status === 'candidate').length;
  const evidence = [stock, benchmark].flatMap((history, i) => history ? [{
    id: i === 0 ? 'stock.history' : 'benchmark.history', label: i === 0 ? 'Completed stock OHLCV' : 'Completed Nifty sessions',
    source: history.source, url: history.url, asOf: history.cutoff, retrievedAt: history.retrievedAt,
    origin: history.origin, symbol: history.symbol, unit: 'INR prices; share volume', observations: history.bars.length,
  }] : []);
  return {
    version: 'framework-report-v1', ticker, generatedAt: new Date(now).toISOString(), cutoff: stock?.cutoff ?? null,
    status: strategies.some(s => s.checks.some(c => c.status === 'unavailable')) ? 'partial' : 'complete',
    summary: `${count} of ${strategies.length} strategy checklists match. Effectiveness has not been tested.`,
    validation: 'untested', strategies, evidence, inputs: { stock, benchmark },
    limitations: [...new Set([
      ...(!stock ? ['Completed stock history is unavailable.'] : stock.limitations),
      ...(!benchmark ? ['Completed benchmark history is unavailable.'] : benchmark.limitations),
      'Axion adaptations: instructor-specific attribution has not been verified. A checklist match is not a probability or confirmed trade.',
      'Financial statement, governance, and delivery checks are unavailable in this technical report.',
      'Reference levels expire after three subsequent benchmark sessions. No entry, fill, exit, or performance is tracked by this version.',
      'Sizing inputs are manual scenarios. Planned loss can be exceeded by gaps and execution costs.',
    ])],
    scenario: scenario ? { origin: 'manual', input: { ...scenario }, result: sizePosition(scenario) } : null,
  };
}

/** Reuse owner-scoped immutable research storage without invoking or impersonating an AI analyst. */
export function frameworkResearchEnvelope(report: FrameworkReport): CompanyResearchReport {
  return {
    kind: 'framework', framework: report, ticker: report.ticker, generatedAt: report.generatedAt,
    promptVersion: report.version, status: report.status,
    snapshot: { ticker: report.ticker, collectedAt: report.generatedAt, evidence: [], limitations: report.limitations },
    roles: [], synthesis: { role: 'summary', status: 'unavailable', review: null, provider: null, model: null, error: 'AI commentary was not requested.' },
    validation: 'Deterministic rule checks; strategy effectiveness is untested.',
  };
}
