import { FRAMEWORK_IDS, FRAMEWORK_REGISTRY } from './framework-registry';
import { completedWeeklyBars, relativeStrength, sma, wilderAtr, wilderRsi } from './framework-indicators';
import type { FrameworkCheck, FrameworkEvaluation, FrameworkHistory, FrameworkId } from './framework-types';

function check(id: string, label: string, observed: string | number | null, pass: boolean, rule: string,
  evidenceIds: string[], unit: string | null = null, required = true): FrameworkCheck {
  return { id, label, observed, status: observed === null ? 'unavailable' : pass ? 'pass' : 'fail', required, unit, rule,
    evidenceIds: observed === null ? [] : evidenceIds,
    explanation: observed === null ? 'Required source observations are missing, incomplete, or insufficient.' : rule };
}
const roundedUp = (value: number) => Math.ceil(value * 100 - 1e-8) / 100;
const roundedDown = (value: number) => Math.floor(value * 100 + 1e-8) / 100;

export function evaluateFrameworks(stock: FrameworkHistory | null, benchmark: FrameworkHistory | null,
  ids: FrameworkId[] = FRAMEWORK_IDS): FrameworkEvaluation[] {
  // Provider benchmark sessions define continuity; never fill suspended/missing stock sessions.
  const aligned = !!stock && !!benchmark && stock.cutoff === benchmark.cutoff;
  const stockBars = stock?.bars.filter(bar => bar.day <= stock.cutoff) ?? [];
  const benchmarkBars = benchmark?.bars.filter(bar => bar.day <= benchmark.cutoff) ?? [];
  const dates = new Set(stockBars.map(bar => bar.day));
  const benchmarkDates = new Set(benchmarkBars.map(bar => bar.day));
  const continuous = aligned && stockBars.length > 0 && stockBars.at(-1)?.day === stock!.cutoff &&
    benchmarkBars.at(-1)?.day === benchmark!.cutoff && stockBars.every(bar => benchmarkDates.has(bar.day)) &&
    benchmarkBars.filter(b => b.day >= stockBars[0]?.day).every(b => dates.has(b.day));
  const usable = aligned && continuous;
  // Preserve independently computable stock observations in partial reports.
  // The mandatory session check still prevents declaring a candidate.
  const bars = stockBars;
  const closes = bars.map(b => b.close);
  const latest = bars.at(-1);
  const weeks = latest ? completedWeeklyBars(bars, latest.day).map(b => b.close) : [];
  const rsi = wilderRsi(closes), atr = wilderAtr(bars);
  const daily44 = sma(closes, 44), prior44 = sma(closes, 44, 5), weekly44 = sma(weeks, 44), priorWeekly44 = sma(weeks, 44, 2);
  const rs = usable ? relativeStrength(bars, benchmarkBars) : null;
  const priorRs = usable ? relativeStrength(bars, benchmarkBars, 5) : null;
  const averages = [20, 50, 200].map(period => sma(closes, period));
  return ids.map(id => {
    const checks = [check('sessions', 'Session coverage', usable ? stock!.cutoff : null, usable,
      'Stock must match the latest completed benchmark session with no missing sessions in its retained history.', ['stock.history', 'benchmark.history'])];
    if (!usable && stock && benchmark) {
      const stockOnly = stockBars.filter(bar => !benchmarkDates.has(bar.day)).map(bar => bar.day);
      const indexOnly = benchmarkBars.filter(bar => bar.day >= stockBars[0]?.day && !dates.has(bar.day)).map(bar => bar.day);
      checks[0].explanation = !aligned ? `Cutoffs differ: stock ${stock.cutoff}, Nifty ${benchmark.cutoff}.`
        : `Session coverage differs: ${stockOnly.length} stock-only dates (${stockOnly.slice(-6).join(', ') || 'none'}); ${indexOnly.length} benchmark-only dates (${indexOnly.slice(-6).join(', ') || 'none'}). No sessions were invented or filled.`;
    }
    let trigger: number | null = null, stop: number | null = null;
    if (id === 'momentum-rs55') {
      checks.push(
        check('rs55', 'Relative strength (55 sessions)', rs, rs !== null && rs > 0, 'RS55 must be strictly positive.', ['stock.history', 'benchmark.history'], '%'),
        check('rs55-slope', 'Relative strength change (5 sessions)', rs !== null && priorRs !== null ? rs - priorRs : null,
          rs !== null && priorRs !== null && rs > priorRs, 'RS55 must exceed its value five sessions earlier.', ['stock.history', 'benchmark.history'], 'percentage points'),
        check('trend', 'Moving-average alignment', averages.every(n => n !== null) && latest ?
          `Close ${latest.close.toFixed(2)}; SMA20 ${averages[0]!.toFixed(2)}; SMA50 ${averages[1]!.toFixed(2)}; SMA200 ${averages[2]!.toFixed(2)}` : null,
          !!latest && averages.every(n => n !== null) && latest.close > averages[0]! && averages[0]! > averages[1]! && averages[1]! > averages[2]!,
          'Close > SMA20 > SMA50 > SMA200.', ['stock.history'], 'INR'),
        check('rsi14', 'Wilder RSI (14)', rsi, rsi !== null && rsi > 55 && rsi < 75, 'RSI must be strictly between 55 and 75.', ['stock.history']),
        check('delivery', 'Delivery confirmation (optional)', null, false, 'Delivery data is not supplied; this variant does not require it.', [], null, false),
      );
      if (bars.length >= 20 && atr !== null && atr > 0) {
        trigger = roundedUp(Math.max(...bars.slice(-20).map(b => b.high)) * 1.002);
        stop = roundedDown(trigger - 2 * atr);
      }
    } else {
      checks.push(
        check('daily-slope', 'Daily 44 SMA change', daily44 !== null && prior44 !== null ? daily44 - prior44 : null,
          daily44 !== null && prior44 !== null && daily44 > prior44, 'Daily SMA44 must exceed its value five sessions earlier.', ['stock.history'], 'INR'),
        check('weekly-slope', 'Weekly 44 SMA change', weekly44 !== null && priorWeekly44 !== null ? weekly44 - priorWeekly44 : null,
          weekly44 !== null && priorWeekly44 !== null && weekly44 > priorWeekly44, 'Completed-week SMA44 must exceed its value two weeks earlier (46 weeks required).', ['stock.history'], 'INR'),
        check('rejection', 'Bullish rejection at daily SMA44', latest && daily44 !== null ?
          `O ${latest.open.toFixed(2)} / H ${latest.high.toFixed(2)} / L ${latest.low.toFixed(2)} / C ${latest.close.toFixed(2)}; SMA44 ${daily44.toFixed(2)}` : null,
          !!latest && daily44 !== null && latest.low <= daily44 && latest.high >= daily44 && latest.close > daily44 && latest.close > latest.open,
          'Candle spans SMA44, closes above SMA44, and closes above its open.', ['stock.history'], 'INR'),
      );
      if (latest) { trigger = roundedUp(latest.high * 1.002); stop = roundedDown(latest.low * 0.998); }
    }
    const validLevels = trigger !== null && stop !== null && stop > 0 && trigger > stop;
    checks.push(check('levels', 'Reference level geometry', validLevels ? `${trigger!.toFixed(2)} / ${stop!.toFixed(2)}` : null,
      validLevels, 'Positive reference stop below a future trigger; 0.2% trigger buffer, rounded to paise. Exchange tick size is unverified.', ['stock.history'], 'INR'));
    const required = checks.filter(c => c.required);
    const status = required.some(c => c.status === 'unavailable') ? 'unavailable' : required.some(c => c.status === 'fail') ? 'no_match' : 'candidate';
    return { id, name: FRAMEWORK_REGISTRY[id].name, version: FRAMEWORK_REGISTRY[id].version, status, checks,
      levels: status === 'candidate' ? { trigger: trigger!, stop: stop!, expiresAfterSessions: 3,
        rounding: 'Reference prices rounded to INR 0.01; verify exchange tick size before any order.' } : null };
  });
}
