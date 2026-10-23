import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { getAxionProjectRoot } from './project-root';

export interface LocalCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeSeriesMeta {
  ticker: string;
  lastUpdated: string;
  candleCount: number;
  oldestDate: string;
  newestDate: string;
  source: 'local_disk_store';
}

const timeSeriesDir = () => path.join(getAxionProjectRoot(), 'data', 'time-series');
const candleFile = (ticker: string) => path.join(timeSeriesDir(), `${ticker.toUpperCase().replace(/\.(NS|BO)$/i, '')}.json`);

/**
 * Ensures the local time-series directory exists.
 */
async function ensureStoreDirectory() {
  await fs.mkdir(timeSeriesDir(), { recursive: true });
}

/**
 * Saves a time-series candle set to local disk storage.
 */
export async function saveLocalCandles(ticker: string, candles: LocalCandle[]): Promise<TimeSeriesMeta> {
  await ensureStoreDirectory();
  const cleanTicker = ticker.toUpperCase().replace(/\.(NS|BO)$/i, '');
  const filePath = candleFile(cleanTicker);

  // Deduplicate and sort by date ascending
  const candleMap = new Map<string, LocalCandle>();
  for (const c of candles) {
    if (c && c.date && Number.isFinite(c.close)) {
      candleMap.set(c.date, {
        date: c.date,
        open: Number(c.open ?? c.close),
        high: Number(c.high ?? c.close),
        low: Number(c.low ?? c.close),
        close: Number(c.close),
        volume: Number(c.volume ?? 0),
      });
    }
  }

  const sorted = [...candleMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const meta: TimeSeriesMeta = {
    ticker: cleanTicker,
    lastUpdated: new Date().toISOString(),
    candleCount: sorted.length,
    oldestDate: sorted[0]?.date || '',
    newestDate: sorted[sorted.length - 1]?.date || '',
    source: 'local_disk_store',
  };

  const payload = {
    meta,
    candles: sorted,
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return meta;
}

/**
 * Loads time-series candles from local storage.
 * Reads in < 15ms directly from SSD disk cache.
 */
export async function loadLocalCandles(ticker: string, limit?: number): Promise<{
  meta: TimeSeriesMeta | null;
  candles: LocalCandle[];
  hit: boolean;
}> {
  const cleanTicker = ticker.toUpperCase().replace(/\.(NS|BO)$/i, '');
  const filePath = candleFile(cleanTicker);

  if (!fsSync.existsSync(filePath)) {
    return { meta: null, candles: [], hit: false };
  }

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    let candles: LocalCandle[] = Array.isArray(parsed?.candles) ? parsed.candles : [];
    if (limit && limit > 0 && candles.length > limit) {
      candles = candles.slice(-limit);
    }
    return {
      meta: parsed?.meta || null,
      candles,
      hit: true,
    };
  } catch {
    return { meta: null, candles: [], hit: false };
  }
}

/**
 * Checks if local candles exist on disk.
 */
export function hasLocalCandles(ticker: string): boolean {
  const cleanTicker = ticker.toUpperCase().replace(/\.(NS|BO)$/i, '');
  return fsSync.existsSync(candleFile(cleanTicker));
}

/**
 * Seeds initial local historical cache from existing stock snapshots if available.
 */
export async function seedLocalStoreFromCatalog(): Promise<number> {
  await ensureStoreDirectory();
  const root = getAxionProjectRoot();
  const dataPath = path.join(root, 'data', 'all_indian_stocks_5055.json');

  if (!fsSync.existsSync(dataPath)) return 0;

  let seeded = 0;
  try {
    const stocks = JSON.parse(fsSync.readFileSync(dataPath, 'utf8'));
    if (Array.isArray(stocks)) {
      for (const s of stocks.slice(0, 100)) {
        if (s.ticker && Array.isArray(s.history) && s.history.length >= 10) {
          await saveLocalCandles(s.ticker, s.history);
          seeded++;
        }
      }
    }
  } catch {}

  return seeded;
}
