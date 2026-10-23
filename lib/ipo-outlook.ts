import type { FrameworkBar, FrameworkHistory } from './framework-types';
import { indiaDay } from './market-quote';

export interface IpoOutlookRequest {
  ticker: string;
  listingDate: string;
  horizon: 5 | 10 | 20;
  targetPrice?: number;
  issuePrice?: number;
  entryPrice?: number;
}

export interface IpoOutlook {
  version: 'ipo-outlook-v1';
  input: IpoOutlookRequest;
  generatedAt: string;
  asOf: string | null;
  status: 'bullish_setup' | 'mixed' | 'weakening' | 'insufficient_data';
  summary: string;
  validation: 'unvalidated';
  probability: null;
  sessions: number;
  evidenceCoverage: 'limited' | 'developing';
  metrics: null | {
    close: number;
    issueReturnPct: number | null;
    listingOpenReturnPct: number;
    entryReturnPct: number | null;
    stockReturnPct: number;
    benchmarkReturnPct: number | null;
    relativeReturnPoints: number | null;
    comparisonStart: string;
    volumeRatio: number | null;
    closePositionPct: number;
    priorHigh: number;
    recentLow: number;
    observedHigh: number;
    averageTrueRange: number;
  };
  target: null | {
    price: number;
    requiredRisePct: number;
    position: 'at_or_below_close' | 'within_observed_range' | 'above_observed_high';
    rewardToReferenceRisk: number | null;
  };
  scenarios: Array<{ name: 'Bullish' | 'Neutral' | 'Bearish'; condition: string }>;
  reasons: string[];
  limitations: string[];
  sources: Array<{ name: string; url: string; asOf: string; retrievedAt: string }>;
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const pct = (value: number, base: number) => (value / base - 1) * 100;
const round = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const DAY = 86_400_000;

export function parseIpoOutlookRequest(value: unknown, now = Date.now()): IpoOutlookRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter the IPO details.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['ticker', 'listingDate', 'horizon', 'targetPrice', 'issuePrice', 'entryPrice'].includes(key))) {
    throw new Error('Only a symbol, listing date, review window and optional prices are accepted.');
  }
  const ticker = typeof input.ticker === 'string' ? input.ticker.trim().toUpperCase().replace(/\.NS$/, '') : '';
  if (!/^[A-Z0-9&_-]{1,30}$/.test(ticker)) throw new Error('Enter a valid NSE symbol, such as KANOHAR.');
  const date = typeof input.listingDate === 'string' ? input.listingDate : '';
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) {
    throw new Error('Enter a valid listing date.');
  }
  const age = (Date.parse(`${indiaDay(new Date(now))}T00:00:00Z`) - stamp) / DAY;
  if (age < 0 || age > 365) throw new Error('Use an IPO listed within the last 365 days.');
  if (![5, 10, 20].includes(input.horizon as number)) throw new Error('Choose a 5, 10 or 20 session review window.');
  const result: IpoOutlookRequest = { ticker, listingDate: date, horizon: input.horizon as 5 | 10 | 20 };
  for (const key of ['targetPrice', 'issuePrice', 'entryPrice'] as const) {
    if (input[key] !== undefined) {
      if (!positive(input[key]) || input[key] > 10_000_000) throw new Error('Optional prices must be positive numbers up to ₹1 crore.');
      result[key] = input[key];
    }
  }
  return result;
}

function usable(history: FrameworkHistory | null, symbol: string, now: number): history is FrameworkHistory {
  if (!history || history.symbol !== symbol || history.origin !== 'provider' || history.currency !== 'INR' || !history.bars.length) return false;
  const observed = Date.parse(history.observedAt), retrieved = Date.parse(history.retrievedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(retrieved) || observed > now || retrieved > now ||
      retrieved < observed || now - observed > 7 * DAY || now - retrieved > 7 * DAY ||
      history.cutoff !== history.bars.at(-1)!.day || history.cutoff > indiaDay(new Date(observed))) return false;
  return history.bars.every((bar, i) => /^\d{4}-\d{2}-\d{2}$/.test(bar.day) && Number.isFinite(Date.parse(`${bar.day}T00:00:00Z`)) &&
    new Date(`${bar.day}T00:00:00Z`).toISOString().slice(0, 10) === bar.day &&
    [bar.open, bar.high, bar.low, bar.close].every(positive) && Number.isFinite(bar.volume) && bar.volume >= 0 &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) &&
    (i === 0 || bar.day > history.bars[i - 1].day));
}

/** Conditional daily-bar research, not a fitted probability or future price estimate. */
export function buildIpoOutlook(input: IpoOutlookRequest, stock: FrameworkHistory | null,
  benchmark: FrameworkHistory | null, now = Date.now()): IpoOutlook {
  const report: IpoOutlook = {
    version: 'ipo-outlook-v1', input, generatedAt: new Date(now).toISOString(), asOf: null,
    status: 'insufficient_data', summary: 'Not enough completed trading evidence to assess this IPO.',
    validation: 'unvalidated', probability: null, sessions: 0, evidenceCoverage: 'limited', metrics: null, target: null,
    scenarios: [], reasons: [], sources: [], limitations: [
      'Rule-based scenarios have not been backtested or calibrated. No target-hit probability or accuracy claim is available.',
      `Review over the next ${input.horizon} trading sessions; this window is not a predicted time to reach a target. Refresh after each completed session.`,
      'Listing date, issue price, entry price and target are user inputs, not independently verified IPO terms.',
      'Company financials, news, delivery volume, anchor unlocks and sector benchmarks are not assessed.',
      'Reference highs and lows can fail. Prices can gap through them; returns exclude charges, taxes and slippage.',
    ],
  };
  if (!usable(stock, `${input.ticker}.NS`, now)) {
    report.reasons.push('Recent provider OHLCV history is unavailable or invalid. No sample prices are substituted.');
    return report;
  }
  report.asOf = stock.cutoff;
  report.sources.push({ name: stock.source, url: stock.url, asOf: stock.cutoff, retrievedAt: stock.retrievedAt });
  report.limitations.push(...stock.limitations.filter(line => !line.startsWith('The current calendar week')));
  const bars = stock.bars;
  // Refuse arbitrary windows in established stocks or histories truncated by corporate actions.
  if (bars[0].day !== input.listingDate) {
    report.reasons.push('The first available trading session does not match the supplied listing date. Check the date and symbol; truncated or split-adjusted histories cannot establish the listing baseline.');
    return report;
  }
  report.sessions = bars.length;
  if (bars.length < 5) {
    report.reasons.push(`Only ${bars.length} completed sessions are available; at least 5 are required.`);
    return report;
  }
  const last = bars.at(-1)!;
  if (last.volume === 0) {
    report.reasons.push('The latest session has no reported trading volume. A tradable setup cannot be assessed.');
    return report;
  }
  const prior = bars.slice(-21, -1);
  const priorHigh = Math.max(...prior.map(bar => bar.high));
  const recentLow = Math.min(...bars.slice(-6, -1).map(bar => bar.low));
  const observedHigh = Math.max(...bars.map(bar => bar.high));
  const meanVolume = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
  const volumeRatio = meanVolume > 0 ? last.volume / meanVolume : null;
  const closePosition = last.high === last.low ? 0.5 : (last.close - last.low) / (last.high - last.low);
  const baseline = bars[Math.max(0, bars.length - 6)];
  const stockReturn = pct(last.close, baseline.close);
  let benchmarkReturn: number | null = null;
  if (usable(benchmark, '^NSEI', now)) {
    const marketStart = benchmark.bars.find(bar => bar.day === baseline.day);
    const marketEnd = benchmark.bars.find(bar => bar.day === last.day);
    if (marketStart && marketEnd) {
      benchmarkReturn = pct(marketEnd.close, marketStart.close);
      report.sources.push({ name: `${benchmark.source} · Nifty 50`, url: benchmark.url, asOf: last.day, retrievedAt: benchmark.retrievedAt });
    }
  }
  if (benchmarkReturn === null) report.limitations.push('Nifty observations on both comparison dates are unavailable; relative strength and a bullish classification are withheld.');
  const relative = benchmarkReturn === null ? null : stockReturn - benchmarkReturn;
  const ranges = bars.slice(1).map((bar: FrameworkBar, i) => Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i].close), Math.abs(bar.low - bars[i].close))).slice(-14);
  const atr = ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
  const extended = atr > 0 && last.close - priorHigh > 2 * atr;
  const bullish = last.close > priorHigh && volumeRatio !== null && volumeRatio >= 1.5 && relative !== null && relative > 0 && closePosition >= 0.6 && !extended;
  const weak = last.close < recentLow || (stockReturn < 0 && relative !== null && relative < 0 && closePosition < 0.35);
  report.status = bullish ? 'bullish_setup' : weak ? 'weakening' : 'mixed';
  report.summary = bullish ? 'A close above the prior high is supported by volume and outperformance versus Nifty.'
    : weak ? 'Recent price action weakens the near-term upside case.' : 'The evidence does not yet confirm a supported breakout.';
  report.evidenceCoverage = bars.length >= 20 && benchmarkReturn !== null && volumeRatio !== null ? 'developing' : 'limited';
  report.metrics = {
    close: last.close, issueReturnPct: input.issuePrice ? round(pct(last.close, input.issuePrice)) : null,
    listingOpenReturnPct: round(pct(last.close, bars[0].open)), entryReturnPct: input.entryPrice ? round(pct(last.close, input.entryPrice)) : null,
    stockReturnPct: round(stockReturn), benchmarkReturnPct: benchmarkReturn === null ? null : round(benchmarkReturn),
    relativeReturnPoints: relative === null ? null : round(relative), comparisonStart: baseline.day,
    volumeRatio: volumeRatio === null ? null : round(volumeRatio), closePositionPct: round(closePosition * 100),
    priorHigh, recentLow, observedHigh, averageTrueRange: round(atr),
  };
  report.reasons.push(
    `${bars.length} completed sessions since the supplied listing date.`,
    `Latest close ${money(last.close)} is ${last.close > priorHigh ? 'above' : 'at or below'} the previous ${prior.length}-session high of ${money(priorHigh)}.`,
    volumeRatio === null ? 'A volume comparison is unavailable.' : `Latest volume is ${round(volumeRatio)}× the preceding ${prior.length}-session average.`,
    `Close is ${round(closePosition * 100)}% of the way from the session low to its high.`,
  );
  if (extended) report.reasons.push('The close is more than two average true ranges above the prior high; the move may be extended.');
  if (bars.length < 20) report.limitations.push('Fewer than 20 sessions: highs, lows and volume comparisons are provisional and sensitive to listing-day activity.');
  if (input.targetPrice) {
    report.target = {
      price: input.targetPrice, requiredRisePct: round(pct(input.targetPrice, last.close)),
      position: input.targetPrice <= last.close ? 'at_or_below_close' : input.targetPrice > observedHigh ? 'above_observed_high' : 'within_observed_range',
      rewardToReferenceRisk: input.targetPrice > last.close && recentLow < last.close ? round((input.targetPrice - last.close) / (last.close - recentLow)) : null,
    };
  }
  report.scenarios = [
    { name: 'Bullish', condition: `A close above ${money(priorHigh)} with at least 1.5× prior average volume, a close in the top 40% of the day's range and outperformance versus Nifty would support an upside setup. A move more than two average true ranges above that high is treated as extended. Reassess if it fails to hold.` },
    { name: 'Neutral', condition: `Holding above the prior ${Math.min(5, bars.length - 1)}-session low of ${money(recentLow)} without a supported breakout leaves the upside case unconfirmed.` },
    { name: 'Bearish', condition: `A close below ${money(recentLow)} would break the prior ${Math.min(5, bars.length - 1)}-session low and weaken the setup. It is a reference level, not a guaranteed stop execution price.` },
  ];
  return report;
}
