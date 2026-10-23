import type { FrameworkCheck } from './framework-types';

export const FINANCIAL_FIELDS = ['OperatingCashFlow', 'NetIncome', 'TotalRevenue', 'TotalDebt', 'StockholdersEquity',
  'EBIT', 'TaxProvision', 'PretaxIncome', 'InvestedCapital', 'CapitalExpenditure'] as const;
export type FinancialField = typeof FINANCIAL_FIELDS[number];
export interface AnnualStatement {
  periodEnd: string;
  periodType: '12M';
  currency: 'INR';
  values: Partial<Record<FinancialField, number>>;
}
export interface FinancialEvidence {
  ticker: string;
  retrievedAt: string;
  source: 'Yahoo Finance';
  url: string;
  verification: 'provider_statement';
  publicationDates: 'unavailable';
  accountingBasis: 'unverified';
  sector: string | null;
  statements: AnnualStatement[];
  checks: FrameworkCheck[];
  limitations: string[];
}

/** Retain the raw provider's identity, annual period, and monetary currency checks. */
export function normalizeAnnualStatements(ticker: string, payload: unknown, now = Date.now()): AnnualStatement[] {
  const result = (payload as any)?.timeseries?.result;
  if (!Array.isArray(result)) throw new Error('Annual financial statements unavailable.');
  const byPeriod = new Map<string, AnnualStatement>();
  for (const series of result) {
    if (!Array.isArray(series?.meta?.symbol) || series.meta.symbol.length !== 1 || series.meta.symbol[0] !== `${ticker}.NS`) continue;
    for (const field of FINANCIAL_FIELDS) {
      const key = `annual${field}`;
      if (!Array.isArray(series.meta.type) || !series.meta.type.includes(key) || !Array.isArray(series[key])) continue;
      for (const entry of series[key]) {
        const day = entry?.asOfDate;
        const parsed = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
        const value = entry?.reportedValue?.raw;
        if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day || parsed > now ||
            entry.periodType !== '12M' || entry.currencyCode !== 'INR' || typeof value !== 'number' || !Number.isFinite(value)) continue;
        const row: AnnualStatement = byPeriod.get(day) ?? { periodEnd: day, periodType: '12M', currency: 'INR', values: {} };
        if (row.values[field] !== undefined && row.values[field] !== value) throw new Error('Conflicting annual statement values.');
        row.values[field] = value;
        byPeriod.set(day, row);
      }
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-6);
}

function consecutive(rows: AnnualStatement[], n: number, fields: FinancialField[]): AnnualStatement[] | null {
  const selected = rows.slice(-n);
  if (selected.length !== n || selected.some(row => fields.some(key => typeof row.values[key] !== 'number' || !Number.isFinite(row.values[key])))) return null;
  for (let i = 1; i < selected.length; i++) {
    const gap = (Date.parse(selected[i].periodEnd) - Date.parse(selected[i - 1].periodEnd)) / 86400000;
    if (gap < 350 || gap > 380) return null;
  }
  return selected;
}

export function evaluateFinancialStatements(rows: AnnualStatement[], sector: string | null, now = Date.now()): FrameworkCheck[] {
  const recent = rows.at(-1);
  const fresh = !!recent && now - Date.parse(recent.periodEnd) <= 550 * 86400000 && Date.parse(recent.periodEnd) <= now;
  const financialSector = !!sector && /financial|bank|insurance/i.test(sector);
  const applicable = sector !== null && !financialSector;
  const checks: FrameworkCheck[] = [];
  const add = (id: string, label: string, value: number | null, pass: boolean, rule: string, periods: AnnualStatement[]) => {
    const status = financialSector ? 'not_applicable' : !applicable || !fresh || value === null || !Number.isFinite(value) ? 'unavailable' : pass ? 'pass' : 'fail';
    checks.push({ id, label, status, required: false, observed: value !== null && Number.isFinite(value) ? value : null, unit: 'ratio', rule,
      explanation: financialSector ? 'This corporate rule is not applied to financial-sector companies.' : !applicable ? 'Sector classification is unavailable; applicability cannot be confirmed.'
        : !fresh ? 'Recent annual reporting periods are unavailable.' : value === null ? 'Compatible annual periods or a valid positive denominator are missing.'
          : 'Provider statement observation; filing publication dates and accounting basis have not been verified.',
      evidenceIds: periods.map(row => `financials.${row.periodEnd}`) });
  };
  const five = consecutive(rows, 5, ['OperatingCashFlow', 'NetIncome']);
  const pat = five?.reduce((sum, r) => sum + r.values.NetIncome!, 0) ?? 0;
  const conversion = five && pat > 0 ? five.reduce((sum, r) => sum + r.values.OperatingCashFlow!, 0) / pat : null;
  add('cash-conversion', 'Five-year CFO / net income', conversion, conversion !== null && conversion >= .85, 'Axion review threshold: cumulative CFO / cumulative net income ≥ 0.85; positive denominator required.', five ?? []);
  const four = consecutive(rows, 4, ['TotalRevenue']);
  const growth = four && four[0].values.TotalRevenue! > 0 && four[3].values.TotalRevenue! > 0
    ? (four[3].values.TotalRevenue! / four[0].values.TotalRevenue!) ** (1 / 3) - 1 : null;
  add('revenue-growth', 'Three-year revenue CAGR', growth, growth !== null && growth >= .12, 'Axion review threshold: revenue CAGR ≥ 0.12 (12%).', four ?? []);
  const debt = recent?.values.TotalDebt, equity = recent?.values.StockholdersEquity;
  const leverage = debt !== undefined && debt >= 0 && equity !== undefined && equity > 0 ? debt / equity : null;
  add('leverage', 'Debt / equity', leverage, leverage !== null && leverage < .5, 'Axion corporate review threshold: debt/equity < 0.5; financial companies excluded.', recent ? [recent] : []);
  const cfo = recent?.values.OperatingCashFlow, capex = recent?.values.CapitalExpenditure;
  const fcf = cfo !== undefined && capex !== undefined && capex <= 0 ? cfo + capex : null;
  add('free-cash-flow', 'Latest annual free cash flow', fcf, fcf !== null && fcf > 0, 'Operating cash flow plus signed capital expenditure > 0. Positive/ambiguous CapEx signs are not inferred.', recent ? [recent] : []);
  checks.at(-1)!.unit = 'INR';
  const capital = consecutive(rows, 4, ['EBIT', 'TaxProvision', 'PretaxIncome', 'InvestedCapital']);
  const nopat = (row: AnnualStatement) => {
    const pretax = row.values.PretaxIncome!, tax = row.values.TaxProvision!;
    return pretax > 0 && tax >= 0 && tax <= pretax ? row.values.EBIT! * (1 - tax / pretax) : null;
  };
  const start = capital ? nopat(capital[0]) : null, end = capital ? nopat(capital[3]) : null;
  const delta = capital ? capital[3].values.InvestedCapital! - capital[0].values.InvestedCapital! : 0;
  const roiic = start !== null && end !== null && delta > 0 ? (end - start) / delta : null;
  add('roiic', 'Three-year incremental capital return', roiic, roiic !== null && roiic >= .20, 'Axion review threshold: change in NOPAT / positive change in invested capital ≥ 0.20.', capital ?? []);
  for (const [id, label] of [['pledge', 'Promoter pledge'], ['rpt', 'Related-party transactions'], ['cwip', 'CWIP aging'],
    ['contingencies', 'Contingent liabilities'], ['auditor', 'Auditor findings']]) {
    checks.push({ id, label, status: 'unavailable', required: false, observed: null, unit: null,
      rule: 'Requires source-verified exchange filings or annual-report disclosures.', explanation: 'No verified disclosure adapter is configured. Absence of evidence is not a clean audit.', evidenceIds: [] });
  }
  return checks;
}

export function financialEvidence(ticker: string, statements: AnnualStatement[], sector: string | null, now = Date.now()): FinancialEvidence {
  return { ticker, statements, sector, retrievedAt: new Date(now).toISOString(), source: 'Yahoo Finance',
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(`${ticker}.NS`)}/financials/`,
    verification: 'provider_statement', publicationDates: 'unavailable', accountingBasis: 'unverified',
    checks: evaluateFinancialStatements(statements, sector, now), limitations: [
      'Reporting periods come from the provider. Original filings, consolidation basis, restatements, and publication dates have not been verified.',
      'These observations are excluded from historical strategy selection because point-in-time availability is unknown.',
      'Thresholds are Axion review hypotheses; failed checks are not allegations of fraud or proof of investment quality.',
    ] };
}
