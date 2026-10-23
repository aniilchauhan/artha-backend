import type { SmallCapExchange, SmallCapScanCounts, SmallCapStock } from './small-cap-types';

export const scanStorageKey = (exchange: SmallCapExchange) => `axion:small-cap-scan:v1:${exchange}`;
const MAX_AGE_MS = 96 * 60 * 60_000;

export interface SavedSmallCapScan {
  version: 1;
  savedAt: number;
  catalogRevision: string;
  stocks: SmallCapStock[];
  counts: SmallCapScanCounts;
  nextOffset: number | null;
  fetchedAt: string;
}

const memory = new Map<SmallCapExchange, SavedSmallCapScan>();
const failedWrites = new Set<SmallCapExchange>();
const validTime = (value: unknown, now: number) => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 30_000 && now - Date.parse(value) <= MAX_AGE_MS;

function validSnapshot(value: unknown, now: number): value is SavedSmallCapScan {
  if (!value || typeof value !== 'object') return false;
  const saved = value as SavedSmallCapScan;
  if (saved.version !== 1 || typeof saved.savedAt !== 'number' || !Number.isFinite(saved.savedAt) ||
      saved.savedAt > now + 30_000 || now - saved.savedAt > MAX_AGE_MS ||
      typeof saved.catalogRevision !== 'string' || !saved.catalogRevision || !validTime(saved.fetchedAt, now) ||
      !saved.counts || !Array.isArray(saved.stocks)) return false;
  const fields = ['totalCatalog', 'totalForExchange', 'scanned', 'quotesUnavailable', 'staleQuotes',
    'unknownMarketCaps', 'notSmallCap', 'smallCaps', 'insufficientHistory'] as const;
  if (fields.some(field => !Number.isSafeInteger(saved.counts[field]) || saved.counts[field] < 0)) return false;
  if (saved.counts.scanned <= 0 || saved.counts.scanned > saved.counts.totalForExchange ||
      saved.stocks.length > saved.counts.scanned || saved.counts.smallCaps > saved.counts.scanned ||
      (saved.nextOffset === null ? saved.counts.scanned !== saved.counts.totalForExchange
        : !Number.isSafeInteger(saved.nextOffset) || saved.nextOffset !== saved.counts.scanned || saved.nextOffset >= saved.counts.totalForExchange)) return false;
  return saved.stocks.every(stock => stock && typeof stock.ticker === 'string' && typeof stock.name === 'string' &&
    typeof stock.providerSymbol === 'string' && stock.currency === 'INR' && stock.dataSource === 'provider' &&
    ['NSE', 'BSE'].includes(stock.exchange) && validTime(stock.quoteAsOf, now) && validTime(stock.fetchedAt, now) &&
    validTime(stock.marketCapAsOf, now) && stock.marketCapSource === 'yahoo-finance' &&
    Number.isFinite(stock.marketCap) && stock.marketCap > 0 && stock.marketCap < 20_000 &&
    ['currentPrice', 'change', 'changePercent', 'high', 'low', 'volume'].every(field =>
      typeof stock[field as keyof SmallCapStock] === 'number' && Number.isFinite(stock[field as keyof SmallCapStock])) &&
    stock.currentPrice > 0 && stock.volume >= 0 && Array.isArray(stock.history) &&
    stock.historyCoverage && stock.historyCoverage.requiredSessions === 20 &&
    Number.isSafeInteger(stock.historyCoverage.completedSessions) && stock.historyCoverage.completedSessions >= 0 &&
    typeof stock.historyCoverage.sufficient === 'boolean' &&
    (stock.averageVolume === undefined || Number.isFinite(stock.averageVolume) && stock.averageVolume >= 0));
}

export function readSavedScan(exchange: SmallCapExchange, now = Date.now()): SavedSmallCapScan | null {
  let saved: unknown = memory.get(exchange);
  try {
    let raw = sessionStorage.getItem(scanStorageKey(exchange));
    if (!raw && typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(scanStorageKey(exchange));
    }
    // Storage is authoritative when available (including an explicitly cleared key).
    saved = failedWrites.has(exchange) ? saved : raw ? JSON.parse(raw) : null;
  } catch { /* Keep the in-memory fallback if browser storage is unavailable. */ }
  if (!validSnapshot(saved, now)) return null;
  return saved;
}

export function saveScan(exchange: SmallCapExchange, saved: SavedSmallCapScan): boolean {
  // History is fetched again by the detail endpoint. Avoid exhausting browser quota with thousands of charts.
  const compact = { ...saved, stocks: saved.stocks.map(stock => ({ ...stock, history: [] })) };
  memory.set(exchange, compact);
  try {
    sessionStorage.setItem(scanStorageKey(exchange), JSON.stringify(compact));
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(scanStorageKey(exchange), JSON.stringify(compact)); } catch { /* quota */ }
    }
    failedWrites.delete(exchange);
    return true;
  } catch { failedWrites.add(exchange); return false; }
}

export function clearSavedScan(exchange: SmallCapExchange): void {
  memory.delete(exchange);
  failedWrites.delete(exchange);
  try { sessionStorage.removeItem(scanStorageKey(exchange)); } catch { /* Storage may be disabled. */ }
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(scanStorageKey(exchange)); } catch { /* Storage may be disabled. */ }
}
