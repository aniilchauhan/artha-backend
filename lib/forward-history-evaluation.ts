import { indiaDay } from './market-quote';
import { FORWARD_NEXT_POLICY, FORWARD_TODAY_POLICY } from './forward-history-types';
import type {
  ForwardHistoryBar, ForwardHistoryChart, ForwardHistoryCounts, ForwardHistoryDaySummary,
  ForwardHistoryEntry, ForwardHistoryOutcome, ForwardHistorySummary,
} from './forward-history-types';

const FIVE_MINUTES = 300_000;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const parseTime = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
const day = (timestamp: number) => indiaDay(new Date(timestamp));
const session = (date: string) => ({
  start: Date.parse(`${date}T09:15:00+05:30`),
  end: Date.parse(`${date}T15:30:00+05:30`),
});
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function usableChart(chart: ForwardHistoryChart | null, symbol: string, barSeconds: number, now: number): chart is ForwardHistoryChart {
  if (!chart || chart.symbol?.toUpperCase() !== symbol.toUpperCase() || chart.currency !== 'INR' ||
      chart.barSeconds !== barSeconds || !Array.isArray(chart.bars)) return false;
  const observed = parseTime(chart.observedAt), fetched = parseTime(chart.fetchedAt);
  return Number.isFinite(observed) && Number.isFinite(fetched) && observed <= fetched && fetched <= now;
}

function validBar(bar: ForwardHistoryBar): boolean {
  return positive(bar.timestamp) && Number.isInteger(bar.timestamp) && [bar.open, bar.high, bar.low, bar.close].every(positive) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) && bar.high >= bar.low;
}

/** A fetch after close must also contain an observation from near that close, not cached noon data. */
function refreshedThroughClose(chart: ForwardHistoryChart, close: number): boolean {
  return parseTime(chart.fetchedAt) >= close && parseTime(chart.observedAt) >= close - FIVE_MINUTES;
}

function sessionEndForDay(chart: ForwardHistoryChart, date: string): number {
  if (positive(chart.sessionStart) && positive(chart.sessionEnd) && chart.sessionEnd > chart.sessionStart &&
      day(chart.sessionStart * 1000) === date && day(chart.sessionEnd * 1000) === date) return chart.sessionEnd * 1000;
  return session(date).end;
}

function chartSymbol(ticker: string): string {
  return /\.(NS|BO)$/i.test(ticker) ? ticker.toUpperCase() : `${ticker.toUpperCase()}.NS`;
}

/** Pure, prospective resolution. Existing final outcomes are never reconstructed or overwritten. */
export function evaluateForwardHistory(
  entry: ForwardHistoryEntry,
  stock: ForwardHistoryChart | null,
  benchmark: ForwardHistoryChart | null = null,
  now = Date.now(),
): ForwardHistoryOutcome {
  if (entry.outcome && entry.outcome.status !== 'pending') return entry.outcome;
  const evaluatedAt = new Date(now).toISOString();
  const result = (status: ForwardHistoryOutcome['status'], reason: string, details: Partial<ForwardHistoryOutcome> = {}): ForwardHistoryOutcome =>
    ({ status, reason, evaluatedAt, ...details });
  const recorded = parseTime(entry.recordedAt), quoted = parseTime(entry.quoteAsOf);
  if (![recorded, quoted].every(Number.isFinite) || quoted > recorded || recorded > now ||
      !positive(entry.reference) || !positive(entry.target) || entry.target <= entry.reference ||
      typeof entry.ticker !== 'string' || !entry.ticker.trim() || !entry.modelVersion ||
      !['today', 'next'].includes(entry.horizon)) return result('unscorable', 'invalid_snapshot');

  if (entry.horizon === 'today') {
    if (entry.policyVersion !== FORWARD_TODAY_POLICY) return result('unscorable', 'unsupported_policy');
    const predictionDay = day(recorded), bounds = session(predictionDay);
    const details = { deadline: new Date(bounds.end).toISOString(), targetSessionDate: predictionDay,
      entryPrice: entry.reference, targetPrice: entry.target };
    if (recorded < bounds.start || recorded >= bounds.end || day(quoted) !== predictionDay ||
        recorded - quoted > FIVE_MINUTES || Math.abs(entry.target - entry.reference * 1.02) > 0.011) {
      return result('unscorable', 'invalid_intraday_snapshot', details);
    }
    if (now < bounds.end) return result('pending', 'awaiting_session_close', details);
    if (!usableChart(stock, chartSymbol(entry.ticker), 300, now)) return result('pending', 'stock_data_unavailable', details);
    if (!refreshedThroughClose(stock, bounds.end)) return result('pending', 'awaiting_refreshed_close', details);
    const observed = parseTime(stock.observedAt);
    const firstStart = bounds.start + Math.floor((recorded - bounds.start) / FIVE_MINUTES) * FIVE_MINUTES;
    const relevant = stock.bars.filter(bar => Number.isFinite(bar.timestamp) && bar.timestamp * 1000 >= firstStart &&
      bar.timestamp * 1000 < bounds.end);
    const counts = new Map<number, ForwardHistoryBar[]>();
    for (const bar of relevant) {
      const at = bar.timestamp * 1000;
      const group = counts.get(at) ?? [];
      group.push(bar); counts.set(at, group);
    }
    const usable = relevant.filter(bar => validBar(bar) && counts.get(bar.timestamp * 1000)?.length === 1 &&
      (bar.timestamp * 1000 - bounds.start) % FIVE_MINUTES === 0 && bar.timestamp * 1000 <= observed &&
      bar.timestamp * 1000 + FIVE_MINUTES <= parseTime(stock.fetchedAt));
    const last = usable.find(bar => bar.timestamp * 1000 === bounds.end - FIVE_MINUTES);
    const priceDetails = { ...details, dataAsOf: stock.observedAt,
      ...(last ? { closeReturnPercent: (last.close / entry.reference - 1) * 100 } : {}) };
    // A fully subsequent hit establishes the event even if earlier observations are incomplete.
    if (usable.some(bar => bar.timestamp * 1000 >= recorded && bar.high >= entry.target)) {
      return result('right', 'target_reached_after_recording', priceDetails);
    }
    const partial = usable.find(bar => bar.timestamp * 1000 < recorded && bar.timestamp * 1000 + FIVE_MINUTES > recorded);
    if (partial && partial.high >= entry.target) return result('unscorable', 'first_candle_timing_ambiguous', priceDetails);
    for (let at = firstStart; at < bounds.end; at += FIVE_MINUTES) {
      if (!usable.some(bar => bar.timestamp * 1000 === at)) return result('unscorable', 'incomplete_intraday_coverage', priceDetails);
    }
    return result('wrong', 'target_not_reached_after_recording', priceDetails);
  }

  if (entry.policyVersion !== FORWARD_NEXT_POLICY) return result('unscorable', 'unsupported_policy');
  if (!validDate(entry.inputDate) || entry.inputDate > day(recorded)) return result('unscorable', 'invalid_input_session');
  if (!usableChart(benchmark, '^NSEI', 86400, now)) return result('pending', 'benchmark_data_unavailable');
  const observedBenchmark = parseTime(benchmark.observedAt);
  const benchmarkBars = benchmark.bars.filter(bar => positive(bar.timestamp) && bar.timestamp * 1000 <= observedBenchmark)
    .sort((a, b) => a.timestamp - b.timestamp);
  const referenceBars = benchmarkBars.filter(bar => day(bar.timestamp * 1000) === entry.inputDate);
  if (referenceBars.length !== 1 || !validBar(referenceBars[0])) return result('pending', 'benchmark_reference_unavailable');
  const targetBar = benchmarkBars.find(bar => day(bar.timestamp * 1000) > entry.inputDate!);
  if (!targetBar) return result('pending', 'awaiting_next_session');
  const targetDay = day(targetBar.timestamp * 1000), targetOpen = targetBar.timestamp * 1000;
  const targetClose = sessionEndForDay(benchmark, targetDay);
  const details = { deadline: new Date(targetClose).toISOString(), targetSessionDate: targetDay };
  if (benchmarkBars.filter(bar => day(bar.timestamp * 1000) === targetDay).length !== 1 || !validBar(targetBar)) {
    return result('pending', 'ambiguous_benchmark_session', details);
  }
  if (recorded >= targetOpen) return result('unscorable', 'recorded_after_target_open', details);
  if (now < targetClose || !refreshedThroughClose(benchmark, targetClose)) return result('pending', 'awaiting_next_session_close', details);
  if (!usableChart(stock, chartSymbol(entry.ticker), 86400, now)) return result('pending', 'stock_data_unavailable', details);
  if (!refreshedThroughClose(stock, targetClose)) return result('pending', 'awaiting_refreshed_close', details);
  const targetBars = stock.bars.filter(bar => positive(bar.timestamp) && day(bar.timestamp * 1000) === targetDay &&
    bar.timestamp * 1000 <= parseTime(stock.observedAt));
  if (targetBars.length !== 1 || !validBar(targetBars[0])) return result('pending', 'target_session_data_unavailable', details);
  const candle = targetBars[0], target = candle.open * 1.02, stop = candle.open * 0.98;
  const priceDetails = { ...details, dataAsOf: stock.observedAt, entryPrice: candle.open,
    targetPrice: target, stopPrice: stop, closeReturnPercent: (candle.close / candle.open - 1) * 100 };
  const targetHit = candle.high >= target, stopHit = candle.low <= stop;
  if (stopHit) return result('wrong', targetHit ? 'both_touched_stop_first' : 'stop_reached', priceDetails);
  return result(targetHit ? 'right' : 'wrong', targetHit ? 'target_reached_before_stop' : 'target_not_reached', priceDetails);
}

function count(entries: ForwardHistoryEntry[]): ForwardHistoryCounts {
  const right = entries.filter(entry => entry.outcome?.status === 'right').length;
  const wrong = entries.filter(entry => entry.outcome?.status === 'wrong').length;
  const pending = entries.filter(entry => !entry.outcome || entry.outcome.status === 'pending').length;
  const unscorable = entries.filter(entry => entry.outcome?.status === 'unscorable').length;
  const scored = right + wrong;
  return { saved: entries.length, right, wrong, pending, unscorable, scored, rightRate: scored ? right / scored : null };
}

/** Descriptive history by IST prediction day and unchanged horizon/model/policy cohort. */
export function summarizeForwardHistory(entries: ForwardHistoryEntry[]): ForwardHistorySummary {
  const groups = new Map<string, ForwardHistoryEntry[]>();
  for (const entry of entries) {
    const recorded = parseTime(entry.recordedAt);
    const date = Number.isFinite(recorded) ? day(recorded) : 'Unknown date';
    const key = JSON.stringify([date, entry.horizon, entry.modelVersion, entry.policyVersion]);
    const group = groups.get(key) ?? [];
    group.push(entry); groups.set(key, group);
  }
  const days: ForwardHistoryDaySummary[] = [...groups].map(([key, group]) => {
    const [date, horizon, modelVersion, policyVersion] = JSON.parse(key);
    return { date, horizon, modelVersion, policyVersion, ...count(group) };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.horizon.localeCompare(b.horizon) ||
    a.modelVersion.localeCompare(b.modelVersion) || a.policyVersion.localeCompare(b.policyVersion));
  return { ...count(entries), days };
}
