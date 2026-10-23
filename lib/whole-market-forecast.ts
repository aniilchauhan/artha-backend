import { indiaDay, quoteStatus, type QuoteProvenance } from './market-quote';

export interface IndexObservation extends QuoteProvenance {
  currentPrice: number;
  history: { date: string; close: number }[];
  isFallback?: boolean;
}

export interface MarketScenario {
  sessions: number;
  samples: number;
  lowerPct: number | null;
  medianPct: number | null;
  upperPct: number | null;
  lowerLevel: number | null;
  upperLevel: number | null;
  historicalCrashWindows: number;
}

export interface IndexForecast {
  symbol: string;
  name: string;
  available: boolean;
  unavailableReason: string | null;
  quoteAsOf: string | null;
  quoteStatus: string;
  historyThrough: string | null;
  historyCount: number;
  level: number | null;
  bias: 'UPWARD' | 'DOWNWARD' | 'MIXED' | 'UNAVAILABLE';
  evidence: string[];
  sma20: number | null;
  sma50: number | null;
  drawdownPct: number | null;
  fiveSessionPct: number | null;
  scenarios: MarketScenario[];
  stress: 'ELEVATED' | 'WATCH' | 'NO_FLAGS' | 'UNAVAILABLE';
  stressFlags: string[];
  crashProbability: null;
  crashDate: null;
}

export interface WholeMarketForecast {
  version: 'MARKET-OBSERVATION-v1';
  generatedAt: string;
  indices: IndexForecast[];
  vix: { value: number; quoteAsOf: string; status: string } | null;
  scope: string;
  limitations: string[];
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Number(value.toFixed(2));
const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
function quantile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}

export function validIndexObservation(symbol: string, quote: IndexObservation | null, now = Date.now()): quote is IndexObservation {
  return !!quote && quote.providerSymbol === symbol && quote.currency === 'INR' && quote.dataSource === 'provider' && !quote.isFallback &&
    Number.isFinite(quote.currentPrice) && quote.currentPrice > 0 && Number.isFinite(Date.parse(quote.quoteAsOf)) &&
    Date.parse(quote.quoteAsOf) <= now + 30000 && now - Date.parse(quote.quoteAsOf) <= 96 * 3600000;
}

export function buildIndexForecast(symbol: string, name: string, quote: IndexObservation | null, vix: WholeMarketForecast['vix'], now = Date.now()): IndexForecast {
  const empty: IndexForecast = { symbol, name, available: false, unavailableReason: 'No valid provider observation within 96 hours.',
    quoteAsOf: quote?.quoteAsOf ?? null, quoteStatus: 'unavailable', historyThrough: null, historyCount: 0,
    level: null, bias: 'UNAVAILABLE', evidence: [], sma20: null, sma50: null, drawdownPct: null,
    fiveSessionPct: null, scenarios: [], stress: 'UNAVAILABLE', stressFlags: [], crashProbability: null, crashDate: null };
  if (!validIndexObservation(symbol, quote, now)) return empty;
  // Use completed historical sessions only; an intraday bar is not a daily close.
  const cutoff = Math.min(now, Date.parse(quote.quoteAsOf));
  const sessions = new Map<string, number>();
  for (const bar of [...quote.history].sort((a, b) => a.date.localeCompare(b.date))) {
    const timestamp = Date.parse(bar.date);
    if (!Number.isFinite(timestamp) || timestamp > cutoff || !Number.isFinite(bar.close) || bar.close <= 0) continue;
    const day = indiaDay(new Date(timestamp));
    if (day >= indiaDay(new Date(cutoff))) continue;
    sessions.set(day, bar.close);
  }
  const entries = [...sessions.entries()].sort(([a], [b]) => a.localeCompare(b));
  const closes = entries.map(([, close]) => close);
  if (closes.length < 51) return { ...empty, quoteAsOf: quote.quoteAsOf, historyCount: closes.length,
    unavailableReason: `Only ${closes.length} completed daily closes; at least 51 are required.` };
  const lastDate = entries.at(-1)![0];
  if (cutoff - Date.parse(lastDate + 'T00:00:00+05:30') > 7 * 86400000) return { ...empty, unavailableReason: 'Historical closes are more than seven calendar days behind the quote.' };
  const latestClose = closes.at(-1)!;
  const sma20 = mean(closes.slice(-20)), sma50 = mean(closes.slice(-50));
  const five = (latestClose / closes.at(-6)! - 1) * 100;
  const daily = (latestClose / closes.at(-2)! - 1) * 100;
  const drawdown = (quote.currentPrice / Math.max(quote.currentPrice, ...closes.slice(-60)) - 1) * 100;
  const bias = quote.currentPrice > sma20 && sma20 > sma50 && five > 0 ? 'UPWARD'
    : quote.currentPrice < sma20 && sma20 < sma50 && five < 0 ? 'DOWNWARD' : 'MIXED';
  const stressFlags: string[] = [];
  if (drawdown <= -8) stressFlags.push(`Index is ${pct(drawdown)} below its observed 60-session closing peak.`);
  if (five <= -4) stressFlags.push(`Five completed sessions fell ${pct(five)} (watch threshold: −4%).`);
  if (daily <= -2) stressFlags.push(`Latest completed session fell ${pct(daily)} (watch threshold: −2%).`);
  if (bias === 'DOWNWARD') stressFlags.push('Price < 20-session average < 50-session average, with negative five-session momentum.');
  if (vix && vix.value >= 25) stressFlags.push(`India VIX is ${vix.value.toFixed(2)} (watch threshold: 25).`);
  const severe = drawdown <= -15 || (vix?.value ?? 0) >= 35 || stressFlags.length >= 3;
  const scenarios = [1, 5, 20].map(sessionsCount => {
    const returns: number[] = [];
    let crashWindows = 0;
    for (let start = 0; start + sessionsCount < closes.length; start++) {
      returns.push((closes[start + sessionsCount] / closes[start] - 1) * 100);
      if (Math.min(...closes.slice(start + 1, start + sessionsCount + 1)) / closes[start] - 1 <= -.1) crashWindows++;
    }
    const enough = returns.length >= 30;
    const lower = enough ? quantile(returns, .1) : null;
    const upper = enough ? quantile(returns, .9) : null;
    return { sessions: sessionsCount, samples: returns.length, lowerPct: lower === null ? null : round(lower),
      medianPct: enough ? round(quantile(returns, .5)) : null, upperPct: upper === null ? null : round(upper),
      lowerLevel: lower === null ? null : round(quote.currentPrice * (1 + lower / 100)),
      upperLevel: upper === null ? null : round(quote.currentPrice * (1 + upper / 100)), historicalCrashWindows: crashWindows };
  });
  return { ...empty, available: true, unavailableReason: null, quoteAsOf: quote.quoteAsOf,
    quoteStatus: quoteStatus(quote, now), historyThrough: lastDate, historyCount: closes.length,
    level: round(quote.currentPrice), bias, sma20: round(sma20), sma50: round(sma50),
    drawdownPct: round(drawdown), fiveSessionPct: round(five), scenarios,
    stress: severe ? 'ELEVATED' : stressFlags.length ? 'WATCH' : 'NO_FLAGS', stressFlags,
    evidence: [
      `Observed level ${quote.currentPrice.toFixed(2)} vs 20-session average ${sma20.toFixed(2)} and 50-session average ${sma50.toFixed(2)}.`,
      `Five-session close-to-close move ${pct(five)}; latest completed session ${pct(daily)}.`,
      `Distance from observed 60-session closing peak: ${pct(drawdown)}.`,
      vix ? `India VIX ${vix.value.toFixed(2)}, observed ${vix.quoteAsOf}; volatility measures magnitude, not direction.` : 'India VIX unavailable; volatility stress checks are incomplete.',
    ] };
}
