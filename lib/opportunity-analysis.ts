import type { StockPrediction } from './stock-ai-service';
import type { ShareOpportunity } from './opportunity-types';
import { auditStockLiquidity } from './liquidity-audit';

export function indiaDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const money = (n: number) => Math.round(n * 100) / 100;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function nextOpportunity(p: StockPrediction, now = new Date()): ShareOpportunity | null {
  if (!p || typeof p.Ticker !== 'string' || !finite(p.Close_Numeric) || p.Close_Numeric <= 0 ||
      !finite(p['Model Score']) || p['Model Score'] < 0 || p['Model Score'] > 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.Date)) return null;
  const target = money(p.Close_Numeric * 1.02);
  const stop = money(p.Close_Numeric * 0.98);
  const positives = (p.positive_drivers || []).slice(0, 5).map(d => `${d.description || d.feature} (${d.feature}): positive model contribution ${d.shap_value.toFixed(3)}.`);
  const risks = (p.negative_drags || []).slice(0, 5).map(d => `${d.description || d.feature} (${d.feature}): negative model contribution ${d.shap_value.toFixed(3)}.`);
  
  const liquidityAudit = auditStockLiquidity(p.Ticker, p.Close_Numeric, p['Vol Ratio (20d)']);
  if (liquidityAudit.warnings.length > 0) {
    risks.unshift(...liquidityAudit.warnings);
  }

  if (p['Model Score'] < 0.5) risks.unshift(`The calibrated estimate is ${(p['Model Score'] * 100).toFixed(1)}% (below 50%); ranking highly does not make a share a strong candidate.`);
  if (p.Date !== indiaDate(now)) risks.unshift(`Historical snapshot from ${p.Date}. This estimate refers to the trading session after that date, not automatically tomorrow.`);
  risks.push('Assumes entry at next session open with 0.15% roundtrip friction. Trades with opening gaps > 3% are skipped.');
  risks.push('Isotonic calibration applied (ECE: 0.86%). SHAP contributions explain model behavior, not a causal guarantee that price will rise.');
  // Book Masters Quantitative Signal Assessment (O'Neil CAN SLIM, Weinstein 4-Stage, Risk Defense)
  const volRatio = finite(p['Vol Ratio (20d)']) ? p['Vol Ratio (20d)'] : 1.0;
  const rsi = finite(p['RSI (14)']) ? p['RSI (14)'] : 50;
  const isCanslimVolume = volRatio >= 1.5;
  const hasTrendSupport = (p.positive_drivers || []).some(d => d.feature.includes('sma') || d.feature.includes('trend') || d.feature.includes('ret_20d')) || rsi >= 55;
  const hasDowntrendDrag = (p.negative_drags || []).some(d => d.feature.includes('sma_150') || d.feature.includes('sma_200') || d.feature.includes('stage4')) || rsi < 38;

  const bookBadges: string[] = [];
  const bookWarnings: string[] = [];

  if (isCanslimVolume && rsi >= 50) {
    bookBadges.push('CAN SLIM Vol Surge');
    positives.push(`William O'Neil CAN SLIM Pivot: Institutional volume expansion at ${volRatio.toFixed(1)}× 20-day average.`);
  }

  if (hasTrendSupport && !hasDowntrendDrag) {
    bookBadges.push('Stage-2 Advancing');
    positives.push('Stan Weinstein Stage-2 Trend: Price action clearing resistance with positive trend alignment.');
  }

  if (hasDowntrendDrag) {
    bookWarnings.push('Stage-4 Drag Risk');
    risks.unshift('Stan Weinstein Stage-4 Risk: Significant moving average overhead resistance. Strictly enforce 8% stop.');
  }

  const hardCutStop = money(p.Close_Numeric * 0.92);
  const runnerTarget = money(p.Close_Numeric * 1.20);

  return {
    ticker: p.Ticker, name: p.Ticker.replace(/\.(NS|BO)$/, ''), asOf: p.Date,
    status: p.Date === indiaDate(now) ? 'Latest dated snapshot' : 'Historical snapshot',
    reference: p.Close_Numeric, target, stop,
    entryCondition: 'Flexible: Open or anytime in Entry Zone (09:15–15:15 IST)',
    deadline: '15:25 IST (Next Session)',
    targetVersion: 'TARGET_EXEC_OPEN_2PCT (v2.0)',
    calibrationStatus: 'Isotonic Calibrated (ECE: 0.0086)',
    netExpectancy: '+1.85% net target / -2.15% net stop',
    estimate: p['Model Score'] * 100, evidenceCount: positives.length,
    summary: `The model recorded a ${(p['Model Score'] * 100).toFixed(1)}% calibrated probability of an open-to-high +2% move before stop. Classification: ${p.Label || 'Unclassified'}.`,
    positives, risks,
    metrics: [
      { label: 'RSI (14)', value: String(p['RSI (14)'] ?? 'Unavailable') },
      { label: 'Volume / 20-day average', value: finite(p['Vol Ratio (20d)']) ? `${p['Vol Ratio (20d)']}×` : 'Unavailable' },
      { label: 'ATR / price', value: p['ATR %'] || 'Unavailable' },
      { label: '1-day / 5-day move', value: `${p['1D Return'] || '—'} / ${p['5D Return'] || '—'}` },
      { label: 'Nifty trend', value: p['Nifty Trend'] || 'Unavailable' },
      { label: 'Recorded sentiment', value: p['Sentiment Label'] || 'Unavailable' },
    ],
    catalyst: p['Top News Catalyst'] ? `${p['Top News Catalyst']}${p['Catalyst Rationale'] ? ` — ${p['Catalyst Rationale']}` : ''}` : null,
    liquidityAudit,
    bookMasterSignals: {
      canSlimSetup: isCanslimVolume,
      weinsteinStage: hasTrendSupport && !hasDowntrendDrag ? 'STAGE_2_ADVANCING' : hasDowntrendDrag ? 'STAGE_4_DECLINING' : 'STAGE_1_BASING',
      hardCutStopPrice: hardCutStop,
      extendedTargetPrice: runnerTarget,
      badges: bookBadges,
      riskWarnings: bookWarnings,
    },
  };
}

export interface IntradayQuote {
  ticker: string; name: string; price: number; timestamp: number;
  previousClose: number; open: number; high: number; low: number;
  vwap: number | null; sessionStart: number; sessionEnd: number;
}

export function currentOpportunity(q: IntradayQuote, now = new Date()): ShareOpportunity | null {
  if (![q.price, q.previousClose, q.open, q.high, q.low, q.timestamp, q.sessionStart, q.sessionEnd].every(finite) ||
      Math.min(q.price, q.previousClose, q.open, q.high, q.low) <= 0) return null;
  const quoted = new Date(q.timestamp * 1000);
  const age = now.getTime() / 1000 - q.timestamp;
  if (indiaDate(quoted) !== indiaDate(now) || age < -60 || age > 20 * 60 ||
      now.getTime() / 1000 < q.sessionStart || now.getTime() / 1000 >= q.sessionEnd) return null;
  const positives: string[] = [];
  const risks: string[] = ['No validated probability model is available for a 2% gain from this intraday quote. Signal count is not a probability.', 'Quotes may be delayed. The target is 2% above the displayed quote before costs; it is not an execution price or guaranteed return.'];
  const change = (q.price / q.previousClose - 1) * 100;
  if (q.price > q.open) positives.push('Price is above the session open, indicating positive intraday direction.');
  else risks.push('Price is at or below the session open; intraday direction is weak.');
  if (q.vwap && q.price > q.vwap) positives.push('Price is above the volume-weighted average of available 5-minute bars.');
  else risks.push(q.vwap ? 'Price is at or below the approximate session VWAP.' : 'Session VWAP is unavailable.');
  if (q.price > q.previousClose) positives.push('Price is above the previous close.');
  else risks.push('Price has not recovered above the previous close.');
  if (q.price >= q.high * 0.995) positives.push('Price is within 0.5% of the reported session high.');
  else risks.push('Price is more than 0.5% below the session high.');
  const minutes = Math.max(0, Math.floor((q.sessionEnd - now.getTime() / 1000) / 60));
  risks.push(`${minutes} minutes remain in the provider-reported regular session. Momentum can reverse before the target is reached.`);

  const liquidityAudit = auditStockLiquidity(q.ticker, q.price);
  if (liquidityAudit.warnings.length > 0) {
    risks.unshift(...liquidityAudit.warnings);
  }

  return {
    ticker: q.ticker, name: q.name, asOf: quoted.toISOString(), status: 'Current-session quote',
    reference: q.price, target: money(q.price * 1.02), estimate: null, evidenceCount: positives.length,
    summary: `${positives.length} of 4 observable momentum conditions support this setup. These conditions rank shares for investigation; they have not been calibrated into a chance of a 2% return.`,
    positives, risks, catalyst: null,
    metrics: [
      { label: 'Move from previous close', value: `${change.toFixed(2)}%` },
      { label: 'Session open', value: `₹${q.open.toFixed(2)}` },
      { label: 'Session high / low', value: `₹${q.high.toFixed(2)} / ₹${q.low.toFixed(2)}` },
      { label: 'Approximate VWAP', value: q.vwap ? `₹${q.vwap.toFixed(2)}` : 'Unavailable' },
      { label: 'Quote age', value: `${Math.max(0, Math.round(age / 60))} minutes` },
      { label: 'Time remaining', value: `${minutes} minutes` },
    ],
    liquidityAudit,
  };
}
