import { indiaDay } from './market-quote';
import type { PriceBand } from './rapid-move-types';

/** Reject undated/different-session bands and distinguish flexible operating ranges. */
export function normalizeNseBand(symbol: string, payload: any, quoteAsOf: string, now = Date.now()): PriceBand | null {
  if (payload?.info?.symbol !== symbol.replace(/\.NS$/, '') || typeof payload?.metadata?.lastUpdateTime !== 'string') return null;
  const match = payload.metadata.lastUpdateTime.match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (!match || !months.includes(match[2])) return null;
  const asOf = `${match[3]}-${String(months.indexOf(match[2]) + 1).padStart(2,'0')}-${match[1]}T${match[4]}+05:30`;
  if (!Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(quoteAsOf)) || indiaDay(new Date(asOf)) !== indiaDay(new Date(quoteAsOf))) return null;
  const upper = Number(payload.priceInfo?.upperCP), lower = Number(payload.priceInfo?.lowerCP);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || lower <= 0 || upper <= lower || Date.parse(asOf) > now + 30_000) return null;
  // A fixed numeric band is required; an F&O operating range is not a fixed circuit.
  const fixed = /^(2|5|10|20)(\.0+)?$/.test(String(payload.priceInfo?.pPriceBand ?? '').replace('%','').trim());
  return { upper, lower, asOf, dynamic: payload.info?.isFNOSec === true || !fixed, source: 'NSE' };
}

export async function fetchNseBand(symbol: string, quoteAsOf: string): Promise<PriceBand | null> {
  if (!/^[A-Z0-9&.-]+\.NS$/.test(symbol)) return null;
  try {
    const response = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol.slice(0,-3))}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://www.nseindia.com/' },
      signal: AbortSignal.timeout(2500), cache: 'no-store',
    });
    return response.ok ? normalizeNseBand(symbol, await response.json(), quoteAsOf) : null;
  } catch { return null; }
}
