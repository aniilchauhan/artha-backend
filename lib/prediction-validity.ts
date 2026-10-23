import type { StockPrediction } from './stock-ai-service';

// Conservative calendar-day limit allows weekends; long exchange holidays
// require a new snapshot rather than silently extending a trading signal.
export function validatePredictionSnapshot(rows: StockPrediction[], now = new Date()) {
  const today = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00Z').getTime();
  const tickers = new Set<string>();
  for (const row of rows) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.Date) ? Date.parse(row.Date + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== row.Date
        || date > today || today - date > 4 * 86400000
        || (date === today && now.getTime() < today + 10 * 3600000)) {
      return { valid: false, reason: 'Predictions are stale, future-dated, or missing a valid input date. Refresh market data and regenerate predictions.' };
    }
    if (!row.Ticker || tickers.has(row.Ticker) || !Number.isFinite(row['Model Score'])
        || row['Model Score'] < 0 || row['Model Score'] > 1
        || !Number.isFinite(row.Close_Numeric) || row.Close_Numeric <= 0) {
      return { valid: false, reason: 'Prediction snapshot contains invalid prices, probabilities, or duplicate tickers.' };
    }
    tickers.add(row.Ticker);
  }
  return rows.length ? { valid: true, reason: null } : { valid: false, reason: 'No predictions available.' };
}
