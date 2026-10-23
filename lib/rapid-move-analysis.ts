import { indiaDay, isProviderStock } from './market-quote';
import type { CachedStock } from './stock-fetcher';
import type { MoveHorizon, RapidMoveCandidate } from './rapid-move-types';

export const MOVE_MAX_AGE_MS = 96 * 60 * 60_000;
type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
const round = (n: number) => Number(n.toFixed(2));
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** No catalog prices, fabricated forecasts or unfinished candles enter the baseline. */
export function analyzeRapidMove(quote: CachedStock, name: string, series?: string, now = Date.now()): RapidMoveCandidate | null {
  if (!isProviderStock(quote, now) || now - Date.parse(quote.quoteAsOf!) > MOVE_MAX_AGE_MS) return null;
  const observedDay = indiaDay(new Date(quote.quoteAsOf!));
  const unique = new Map<string, Bar>();
  for (const raw of quote.history) {
    const bar = raw as unknown as Bar;
    const stamp = Date.parse(bar.date);
    if (!Number.isFinite(stamp) || stamp > Date.parse(quote.quoteAsOf!)) continue;
    const day = indiaDay(new Date(stamp));
    if (day >= observedDay || ![bar.open, bar.high, bar.low, bar.close].every(n => Number.isFinite(n) && n > 0) ||
        !Number.isFinite(bar.volume) || bar.volume <= 0 || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) continue;
    unique.set(day, bar);
  }
  const bars = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bar]) => bar);
  if (bars.length < 25 || quote.currentPrice < 10) return null;
  if (Date.parse(quote.quoteAsOf!) - Date.parse(bars.at(-1)!.date) > 7 * 86400000 ||
      bars.slice(-25).some((bar, i, recent) => i > 0 && Math.abs(bar.close / recent[i - 1].close - 1) > .40)) return null;
  const last20 = bars.slice(-20);
  const averageVolume = mean(last20.map(b => b.volume));
  const turnoverCr = mean(last20.map(b => b.close * b.volume)) / 10_000_000;
  if (turnoverCr < 1) return null;
  const last = bars.at(-1)!;
  const momentum5Pct = (last.close / bars.at(-6)!.close - 1) * 100;
  const sma20 = mean(last20.map(b => b.close));
  if (quote.currentPrice < sma20 || momentum5Pct <= 0) return null;
  const ranges = bars.slice(-14).map((b, i) => {
    const prior = bars[bars.length - 15 + i].close;
    return Math.max(b.high - b.low, Math.abs(b.high - prior), Math.abs(b.low - prior));
  });
  const atr = mean(ranges);
  const atrPct = atr / quote.currentPrice * 100;
  const volumeRatio = quote.volume / averageVolume;
  const resistance = Math.max(...last20.map(b => b.high));
  const entry = round(Math.max(quote.currentPrice, resistance * 1.0025));
  const invalidation = round(Math.max(entry * 0.90, Math.min(entry * 0.97, entry - 1.5 * atr)));
  const setup = quote.currentPrice >= resistance && volumeRatio >= 1.2 ? 'breakout' : 'building';
  const circuitMomentum = quote.changePercent >= 3 && volumeRatio >= 1.5 && quote.currentPrice >= quote.high * .98;
  const score = Math.round(Math.min(100, Math.max(0, (setup === 'breakout' ? 25 : 10) + Math.min(25, volumeRatio * 10) +
    Math.min(20, momentum5Pct * 2) + Math.min(20, atrPct * 5) + (circuitMomentum ? 10 : 0))));
  const horizons = ([1, 2, 3, 4, 5] as MoveHorizon[]).map(days => {
    let hits = 0, samples = 0;
    // Non-overlapping historical windows. Touch frequency is descriptive, not a forecast.
    for (let i = 0; i + days <= bars.length; i += days) {
      const future = bars.slice(i, i + days);
      if (future.some((b, j) => j > 0 && Date.parse(b.date) - Date.parse(future[j - 1].date) > 7 * 86400000)) continue;
      samples++;
      if (Math.max(...future.map(b => b.high)) >= future[0].open * 1.10) hits++;
    }
    const rangePct = round(atrPct * Math.sqrt(days));
    return { days, rangePct, stretch: rangePct < 10, historicalHits: hits, historicalSamples: samples };
  });
  const risks = ['A +10% target is a gross price objective, not a return forecast.', 'Circuit band unverified; locked orders may not fill.'];
  if (['BE', 'BZ', 'ST', 'SZ', 'SM'].includes(series || '')) risks.push('Restricted/SME series: confirm lot size, settlement and exit liquidity.');
  if (volumeRatio < 1.2) risks.push('Volume confirmation has not formed.');
  if (quote.quoteStatus !== 'recent') risks.push('Provider observation may be delayed or from the last session.');
  return { ticker: quote.providerSymbol!, name, asOf: quote.quoteAsOf!, quoteStatus: quote.quoteStatus ?? 'historical', price: round(quote.currentPrice), changePct: round(quote.changePercent),
    entry, target: round(entry * 1.10), invalidation, score, atrPct: round(atrPct), volumeRatio: round(volumeRatio), turnoverCr: round(turnoverCr),
    momentum5Pct: round(momentum5Pct), resistance20d: round(resistance), setup, circuitMomentum, band: null, horizons,
    reasons: [
      `Price ₹${round(quote.currentPrice)} is ${round((quote.currentPrice / sma20 - 1) * 100)}% above the 20-session average of ₹${round(sma20)}: the recent trend is positive.`,
      `Completed-session close rose from ₹${round(bars.at(-6)!.close)} to ₹${round(last.close)} in five sessions (+${round(momentum5Pct)}%): recent buying momentum.`,
      `Observed volume ${Math.round(quote.volume).toLocaleString('en-IN')} versus a 20-session daily average of ${Math.round(averageVolume).toLocaleString('en-IN')} (${round(volumeRatio)}×): ${volumeRatio >= 1.2 ? 'meets the volume confirmation threshold' : 'volume confirmation is still missing'}. Intraday volume is partial.`,
      `The completed 20-session high is ₹${round(resistance)}. ${setup === 'breakout' ? 'Price has reached that resistance with at least 1.2× average volume.' : `A building setup; the planned trigger is ₹${entry}, with a 0.25% buffer above resistance unless the current price is higher.`}`,
      `Average daily traded value is ₹${round(turnoverCr)} Cr over 20 completed sessions, above the ₹1 Cr liquidity screen.`,
    ], risks };
}
