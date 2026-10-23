import { evaluateFrameworks } from './framework-evaluators';
import { FRAMEWORK_IDS, FRAMEWORK_RULE_VERSION } from './framework-registry';
import type { FrameworkEvaluation, FrameworkHistory, FrameworkId } from './framework-types';

export const FRAMEWORK_EXECUTION_POLICY = { version: 'framework-execution-v1', validity: 3, horizon: 20,
  targetR: 3, maxGap: .03, slippage: .0005, entryCost: .001, exitCost: .001 } as const;
export type ReplayOutcome = 'target' | 'stop' | 'ambiguous_stop' | 'time' | 'pending' | 'no_entry' | 'skipped_gap' | 'excluded';
export interface ReplayTrade {
  signalDay: string; entryDay: string | null; exitDay: string | null; outcome: ReplayOutcome;
  entry: number | null; exit: number | null; stop: number; target: number | null;
  netReturn: number | null; holdingSessions: number; reason: string;
}
export interface ReplaySummary {
  signals: number; completedTrades: number; wins: number; winRate: number | null;
  meanNetReturn: number | null; compoundedNetReturn: number | null; closedTradeMaxDrawdown: number | null;
  exposureFraction: number | null; benchmarkReturn: number | null;
  unavailableSessions: number; evaluatedSessions: number; smallSample: boolean;
}
export interface ReplayWindow {
  from: string | null; through: string | null; trades: ReplayTrade[]; summary: ReplaySummary;
}
export interface FrameworkBacktest {
  version: 'framework-backtest-v1'; generatedAt: string; ticker: string;
  ruleVersion: string; execution: typeof FRAMEWORK_EXECUTION_POLICY;
  universe: 'single_selected_symbol'; historicalMembershipVerified: false;
  strategies: Array<{ id: FrameworkId; development: ReplayWindow; holdout: ReplayWindow }>;
  limitations: string[];
}

/** Execute frozen reference levels using subsequent benchmark sessions only. */
export function replayCandidate(signalDay: string, levels: NonNullable<FrameworkEvaluation['levels']>,
  stock: FrameworkHistory, benchmark: FrameworkHistory, through: string): ReplayTrade {
  const p = FRAMEWORK_EXECUTION_POLICY;
  const future = benchmark.bars.filter(b => b.day > signalDay && b.day <= through);
  const stocks = new Map(stock.bars.map(b => [b.day, b]));
  const base: ReplayTrade = { signalDay, entryDay: null, exitDay: null, outcome: 'pending', entry: null, exit: null,
    stop: levels.stop, target: null, netReturn: null, holdingSessions: 0, reason: 'Awaiting subsequent sessions.' };
  for (let i = 0; i < Math.min(p.validity, future.length); i++) {
    const bar = stocks.get(future[i].day);
    if (!bar) return { ...base, outcome: 'excluded', exitDay: future[i].day, reason: 'Missing stock session during trigger validity.' };
    if (bar.open > levels.trigger * (1 + p.maxGap)) return { ...base, outcome: 'skipped_gap', exitDay: bar.day, reason: 'Opening gap exceeds 3% of trigger.' };
    if (bar.high < levels.trigger) continue;
    const entry = Math.max(bar.open, levels.trigger) * (1 + p.slippage);
    if (levels.stop <= 0 || entry <= levels.stop) return { ...base, outcome: 'excluded', exitDay: bar.day, reason: 'Invalid stop geometry.' };
    const target = entry + p.targetR * (entry - levels.stop);
    const opened = { ...base, entryDay: bar.day, entry, target };
    for (let j = i; j < Math.min(i + p.horizon, future.length); j++) {
      const current = stocks.get(future[j].day);
      if (!current) return { ...opened, outcome: 'excluded', exitDay: future[j].day, holdingSessions: j - i, reason: 'Missing stock session while position was open.' };
      let outcome: ReplayOutcome | null = null, price: number | null = null;
      // Opening gaps are observable before intraday extremes on post-entry days.
      if (j > i && current.open <= levels.stop) { outcome = 'stop'; price = current.open; }
      else if (j > i && current.open >= target) { outcome = 'target'; price = current.open; }
      else if (current.low <= levels.stop) {
        outcome = current.high >= target || (j === i && bar.open < levels.trigger) ? 'ambiguous_stop' : 'stop';
        price = levels.stop;
      } else if (current.high >= target) { outcome = 'target'; price = target; }
      else if (j - i + 1 === p.horizon) { outcome = 'time'; price = current.close; }
      if (outcome && price !== null) {
        const exit = price * (1 - p.slippage);
        return { ...opened, outcome, exitDay: current.day, exit, holdingSessions: j - i + 1,
          netReturn: exit * (1 - p.exitCost) / (entry * (1 + p.entryCost)) - 1,
          reason: outcome === 'ambiguous_stop' ? 'Daily-bar ordering is ambiguous; conservatively assume stop first.' : `Exited by ${outcome} policy.` };
      }
    }
    return { ...opened, holdingSessions: future.length - i, reason: 'Position has not resolved within the available evaluation window.' };
  }
  return future.length >= p.validity ? { ...base, outcome: 'no_entry', exitDay: future[p.validity - 1].day, reason: 'Trigger expired after three benchmark sessions.' } : base;
}

function windowReplay(stock: FrameworkHistory, benchmark: FrameworkHistory, id: FrameworkId, first: number, last: number): ReplayWindow {
  const sessions = benchmark.bars.slice(first, last + 1);
  const through = sessions.at(-1)?.day ?? null;
  const trades: ReplayTrade[] = [];
  let unavailableSessions = 0, evaluatedSessions = 0, busyThrough: string | null = null;
  for (const session of sessions) {
    if (busyThrough && session.day <= busyThrough) continue;
    evaluatedSessions++;
    const [evaluation] = evaluateFrameworks({ ...stock, cutoff: session.day }, { ...benchmark, cutoff: session.day }, [id]);
    if (evaluation.status === 'unavailable') unavailableSessions++;
    if (evaluation.status !== 'candidate' || !evaluation.levels || !through) continue;
    const trade = replayCandidate(session.day, evaluation.levels, stock, benchmark, through);
    trades.push(trade);
    busyThrough = trade.exitDay ?? through;
  }
  const complete = trades.filter(t => t.netReturn !== null);
  let equity = 1, peak = 1, drawdown = 0;
  for (const trade of complete) { equity *= 1 + trade.netReturn!; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, 1 - equity / peak); }
  return { from: sessions[0]?.day ?? null, through, trades,
    summary: { signals: trades.length, completedTrades: complete.length, wins: complete.filter(t => t.netReturn! > 0).length,
      winRate: complete.length ? complete.filter(t => t.netReturn! > 0).length / complete.length : null,
      meanNetReturn: complete.length ? complete.reduce((n, t) => n + t.netReturn!, 0) / complete.length : null,
      compoundedNetReturn: complete.length ? equity - 1 : null, closedTradeMaxDrawdown: complete.length ? drawdown : null,
      exposureFraction: sessions.length ? trades.reduce((n, t) => n + t.holdingSessions, 0) / sessions.length : null,
      benchmarkReturn: sessions.length > 1 ? sessions.at(-1)!.close / sessions[0].close - 1 : null,
      unavailableSessions, evaluatedSessions, smallSample: complete.length < 30 } };
}

export function backtestFrameworks(ticker: string, stock: FrameworkHistory | null, benchmark: FrameworkHistory | null,
  ids: FrameworkId[] = FRAMEWORK_IDS, now = Date.now()): FrameworkBacktest {
  const valid = stock?.symbol === `${ticker}.NS` && benchmark?.symbol === '^NSEI' && stock.currency === 'INR' && benchmark.currency === 'INR';
  const usableStock = valid ? { ...stock, bars: stock.bars.filter(b => b.day <= stock.cutoff) } : null;
  const usableBenchmark = valid ? { ...benchmark, bars: benchmark.bars.filter(b => b.day <= benchmark.cutoff && b.day <= stock.cutoff) } : null;
  const split = Math.floor((usableBenchmark?.bars.length ?? 0) * .7);
  const empty = (): ReplayWindow => ({ from: null, through: null, trades: [], summary: { signals: 0, completedTrades: 0, wins: 0,
    winRate: null, meanNetReturn: null, compoundedNetReturn: null, closedTradeMaxDrawdown: null, exposureFraction: null,
    benchmarkReturn: null, unavailableSessions: 0, evaluatedSessions: 0, smallSample: true } });
  return { version: 'framework-backtest-v1', generatedAt: new Date(now).toISOString(), ticker, ruleVersion: FRAMEWORK_RULE_VERSION,
    execution: FRAMEWORK_EXECUTION_POLICY, universe: 'single_selected_symbol', historicalMembershipVerified: false,
    strategies: ids.map(id => ({ id,
      development: usableStock && usableBenchmark ? windowReplay(usableStock, usableBenchmark, id, 0, split - 1) : empty(),
      holdout: usableStock && usableBenchmark ? windowReplay(usableStock, usableBenchmark, id, split, usableBenchmark.bars.length - 1) : empty(),
    })), limitations: [
      'Historical simulation of one user-selected stock, not a survivorship-free market-universe study or a calibrated success probability.',
      'First 70% of benchmark sessions and last 30% are evaluated separately. Rules are fixed, not optimized. Outcomes never cross the window boundary.',
      'Daily bars cannot establish intraday event order. Ambiguous entry/stop/target bars assume stop first.',
      'Costs and slippage are fixed illustrative estimates, not verified statutory charges or executable fills.',
      'Compounding assumes a full sequential strategy sleeve; drawdown is measured at trade closes, not daily mark-to-market. Open/excluded trades have no invented return.',
      'Price histories were retrieved today and may contain revisions. Financial statements are excluded because historical publication dates are unknown.',
      'Fewer than 30 completed trades is flagged as a small sample; this threshold is not a statistical confidence guarantee.',
    ] };
}
