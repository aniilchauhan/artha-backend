import { getAxionProjectRoot } from './project-root';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YahooFinance from 'yahoo-finance2';
import { fetchStockQuotes, stockSymbol } from './stock-fetcher';
import { isProviderStock } from './market-quote';
import { historicalVolumeCoverage } from './small-cap-history';
export { historicalVolumeCoverage } from './small-cap-history';
import type { SmallCapExchange, SmallCapScanResponse, SmallCapStock } from './small-cap-types';
import { scoreSmallCapCandidate } from './small-cap-scoring';

// ─── Options PCR / Squeeze Signal Bridge ─────────────────────────────────
// Fetches live options data once per batch (cached 5 min) and overlays
// optionsPcr + isShortSqueezeSetup into every scoreSmallCapCandidate call.

const OPTIONS_CACHE_TTL_MS = 5 * 60_000;
const optionsPcrCache = new Map<string, { pcr: number | null; isSqueezeSetup: boolean; expires: number }>();

async function fetchOptionsOverlay(ticker: string): Promise<{ pcr: number | null; isSqueezeSetup: boolean }> {
  const cleanTicker = ticker.replace(/\.(NS|BO)$/i, '').toUpperCase();
  const cached = optionsPcrCache.get(cleanTicker);
  if (cached && cached.expires > Date.now()) return { pcr: cached.pcr, isSqueezeSetup: cached.isSqueezeSetup };
  const fallback = { pcr: null, isSqueezeSetup: false };
  try {
    // Try the local options snapshot file first (no HTTP needed)
    const snapshotFile = path.join(getAxionProjectRoot(), 'stock-ai', 'data', 'options', 'latest_options.json');
    if (fs.existsSync(snapshotFile)) {
      const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8')) as Record<string, any>;
      const data = snapshot[cleanTicker] || snapshot[`${cleanTicker}.NS`];
      if (data && typeof data.pcr === 'number') {
        const result = { pcr: data.pcr, isSqueezeSetup: Boolean(data.isSqueezeSetup) };
        optionsPcrCache.set(cleanTicker, { ...result, expires: Date.now() + OPTIONS_CACHE_TTL_MS });
        return result;
      }
    }
  } catch { /* snapshot absent — skip overlay silently */ }
  optionsPcrCache.set(cleanTicker, { ...fallback, expires: Date.now() + OPTIONS_CACHE_TTL_MS });
  return fallback;
}

export const SMALL_CAP_BATCH_LIMIT = 24;
// Screening convention: allow recent completed sessions across weekends/holidays, reject older observations.
export const SMALL_CAP_MAX_QUOTE_AGE_MS = 96 * 60 * 60_000;
const METADATA_CONCURRENCY = 4;
const METADATA_TIMEOUT_MS = 6000;
const METADATA_CACHE_MS = 5 * 60_000;
const MISSING_METADATA_CACHE_MS = 30_000;
const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'], versionCheck: false, queue: { concurrency: METADATA_CONCURRENCY } });

export interface SmallCapCatalogIdentity {
  providerSymbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  series?: string;
  isT2T?: boolean;
}

export interface ProviderMarketCap {
  marketCap: number;
  marketCapSource: 'yahoo-finance';
  marketCapAsOf: string;
}

export interface SmallCapScanOptions {
  exchange?: SmallCapExchange;
  offset?: number;
  limit?: number;
  catalogOnly?: boolean;
  signal?: AbortSignal;
}

export interface SmallCapScanDependencies {
  catalog?: readonly unknown[];
  fetchQuotes?: typeof fetchStockQuotes;
  fetchMarketCap?: (symbol: string, signal?: AbortSignal) => Promise<ProviderMarketCap | null>;
  now?: number;
}

let savedCatalog: SmallCapCatalogIdentity[] | undefined;
let savedCatalogSource: SmallCapScanResponse['catalogSource'];
let savedCatalogSignature: string | undefined;
const metadataCache = new Map<string, { value: ProviderMarketCap | null; expires: number }>();
const metadataPending = new Map<string, Promise<ProviderMarketCap | null>>();

/** Only identity fields are consumed. Catalog prices and capitalization are intentionally ignored. */
export function normalizeSmallCapCatalog(rows: readonly unknown[]): SmallCapCatalogIdentity[] {
  const bySymbol = new Map<string, SmallCapCatalogIdentity>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const identity = row as { ticker?: unknown; symbol?: unknown; providerSymbol?: unknown; name?: unknown; exchange?: unknown; series?: unknown };
    const raw = typeof identity.ticker === 'string' && identity.ticker.trim()
      ? identity.ticker : typeof identity.providerSymbol === 'string' ? identity.providerSymbol : typeof identity.symbol === 'string' ? identity.symbol : '';
    if (!raw.trim()) continue;
    // A BSE-only identity without a suffix must remain on BSE rather than defaulting to NSE.
    const onExchange = identity.exchange === 'BSE' && !/\.(NS|BO)$/i.test(raw.trim()) ? `${raw.trim()}.BO` : raw;
    const symbol = stockSymbol(onExchange);
    if (!symbol) continue;
    const series = typeof identity.series === 'string' ? identity.series.trim().toUpperCase() : undefined;
    const isT2T = ['BE', 'BZ', 'ST', 'SZ'].includes(series || '');
    const existing = bySymbol.get(symbol);
    if (existing) {
      // Preserve the more restrictive trading series if an identity occurs more than once.
      if (isT2T) { existing.series = series; existing.isT2T = true; }
      continue;
    }
    bySymbol.set(symbol, {
      providerSymbol: symbol,
      name: typeof identity.name === 'string' && identity.name.trim() ? identity.name.trim() : symbol,
      exchange: symbol.endsWith('.BO') ? 'BSE' : 'NSE',
      ...(series ? { series, isT2T } : {}),
    });
  }
  return [...bySymbol.values()];
}

function catalogSignature(root: string): string {
  if (fs.existsSync(path.join(root, 'data/.nse-catalog-refresh.lock'))) {
    throw new Error('The company catalog is being refreshed. Retry after the refresh completes.');
  }
  return JSON.stringify([root, ...['data/nse-equities.csv', 'stock-ai/data/nse_equities_master.csv',
    'data/nse-sme-equities.csv', 'data/nse-catalog-source.json'].map(file => {
    try {
      const stat = fs.statSync(path.join(root, file));
      return [file, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino];
    } catch { return [file, null]; }
  })]);
}

export function loadSmallCapCatalog(root = getAxionProjectRoot()): SmallCapCatalogIdentity[] {
  const signature = catalogSignature(root);
  if (savedCatalog && signature === savedCatalogSignature) return savedCatalog;
  // Generated JSON catalogs contain artificial BSE identities. Use the official NSE equity-list snapshots instead.
  let mainIdentities: SmallCapCatalogIdentity[] = [];
  let mainPath = '';
  for (const file of ['data/nse-equities.csv', 'stock-ai/data/nse_equities_master.csv']) {
    try {
      const identities = parseNseEquityCatalog(fs.readFileSync(path.join(root, file), 'utf8'));
      if (identities.length === 0) continue;
      mainIdentities = identities;
      mainPath = file;
      break;
    } catch { /* Try the other official NSE snapshot; never fall back to generated identities or prices. */ }
  }
  if (!mainIdentities.length) throw new Error('The bundled company catalog is unavailable.');
  let smeIdentities: SmallCapCatalogIdentity[] = [];
  try { smeIdentities = parseNseEquityCatalog(fs.readFileSync(path.join(root, 'data/nse-sme-equities.csv'), 'utf8')); }
  catch { /* The available main-board snapshot remains usable when the SME snapshot is absent. */ }
  let snapshotDate: string | undefined;
  if (mainPath === 'data/nse-equities.csv') {
    try {
      const note = JSON.parse(fs.readFileSync(path.join(root, 'data/nse-catalog-source.json'), 'utf8'));
      if (typeof note.snapshotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(note.snapshotDate)) snapshotDate = note.snapshotDate;
    } catch { /* A missing source date is unavailable rather than guessed from file timestamps. */ }
  }
  const sources = [{ path: mainPath, url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv' }];
  if (smeIdentities.length) sources.push({ path: 'data/nse-sme-equities.csv', url: 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv' });
  if (catalogSignature(root) !== signature) throw new Error('The company catalog changed while loading. Retry the request.');
  savedCatalog = normalizeSmallCapCatalog([...mainIdentities, ...smeIdentities]);
  savedCatalogSignature = signature;
  savedCatalogSource = { name: smeIdentities.length ? 'NSE equity and SME snapshots' : 'NSE equity-list snapshot',
    ...sources[0], snapshotDate, sources };
  return savedCatalog;
}

export function parseNseEquityCatalog(csv: string): SmallCapCatalogIdentity[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((character === '\r' || character === '\n') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index++;
      row.push(field.trim());
      if (row.some(value => value.length)) rows.push(row);
      row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new Error('The NSE identity CSV has an unterminated quoted field.');
  row.push(field.trim());
  if (row.some(value => value.length)) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim().toUpperCase().replace(/_/g, ' ')) || [];
  const symbolIndex = headers.indexOf('SYMBOL');
  const nameIndex = headers.indexOf('NAME OF COMPANY');
  const seriesIndex = headers.indexOf('SERIES');
  if (symbolIndex < 0 || nameIndex < 0 || seriesIndex < 0) throw new Error('The NSE identity CSV is missing required headers.');
  return normalizeSmallCapCatalog(rows.map(values => ({
    ticker: values[symbolIndex] ? `${values[symbolIndex]}.NS` : '', name: values[nameIndex], series: values[seriesIndex], exchange: 'NSE',
  })));
}

/** Yahoo's validated quote/price modules expose marketCap as a number in their stated currency. */
export function marketCapFromProvider(symbol: string, payload: unknown, now = Date.now()): ProviderMarketCap | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as { symbol?: unknown; currency?: unknown; marketCap?: unknown };
  if (typeof row.symbol !== 'string' || row.symbol.toUpperCase() !== symbol || row.currency !== 'INR' ||
      typeof row.marketCap !== 'number' || !Number.isFinite(row.marketCap) || row.marketCap <= 0) return null;
  return { marketCap: row.marketCap / 10_000_000, marketCapSource: 'yahoo-finance', marketCapAsOf: new Date(now).toISOString() };
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The scan was cancelled.', 'AbortError');
}

function awaitForCaller<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  ensureNotAborted(signal);
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('The scan was cancelled.', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

export async function fetchProviderMarketCap(symbol: string, signal?: AbortSignal): Promise<ProviderMarketCap | null> {
  // Only normalized exchange symbols can reach the fixed Yahoo provider.
  if (stockSymbol(symbol) !== symbol) return null;
  ensureNotAborted(signal);
  const cached = metadataCache.get(symbol);
  if (cached && cached.expires > Date.now()) return cached.value ? { ...cached.value } : null;
  const pending = metadataPending.get(symbol);
  if (pending) return awaitForCaller(pending, signal);

  const request = (async () => {
    // The shared lookup is independent of a caller's cancellation. Its hard deadline also covers
    // library queue/crumb work even if an internal request fails to honor the fetch signal.
    const controller = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>(resolve => {
      deadlineTimer = setTimeout(() => { controller.abort(); resolve(null); }, METADATA_TIMEOUT_MS);
    });
    const lookup = (async () => {
      let value: ProviderMarketCap | null = null;
      try {
        const quote = await yahoo.quote(symbol, {}, { fetchOptions: { signal: controller.signal } });
        value = marketCapFromProvider(symbol, quote);
      } catch { /* Summary metadata may be available when the quote endpoint is unavailable. */ }
      if (!value && !controller.signal.aborted) {
        try {
          const summary = await yahoo.quoteSummary(symbol, { modules: ['price'] }, { fetchOptions: { signal: controller.signal } });
          value = marketCapFromProvider(symbol, summary.price);
        } catch { /* Unknown capitalization remains unknown. */ }
      }
      return value;
    })();
    let value: ProviderMarketCap | null;
    try { value = await Promise.race([lookup, deadline]); }
    finally {
      clearTimeout(deadlineTimer);
      controller.abort();
    }
    if (metadataCache.size >= 6000) metadataCache.delete(metadataCache.keys().next().value!);
    metadataCache.set(symbol, { value, expires: Date.now() + (value ? METADATA_CACHE_MS : MISSING_METADATA_CACHE_MS) });
    return value;
  })().finally(() => metadataPending.delete(symbol));
  metadataPending.set(symbol, request);
  return awaitForCaller(request, signal);
}

async function metadataForBatch(
  identities: SmallCapCatalogIdentity[], fetchMarketCap: NonNullable<SmallCapScanDependencies['fetchMarketCap']>, signal?: AbortSignal,
): Promise<Array<ProviderMarketCap | null>> {
  const result: Array<ProviderMarketCap | null> = new Array(identities.length).fill(null);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, identities.length) }, async () => {
    while (cursor < identities.length) {
      ensureNotAborted(signal);
      const index = cursor++;
      try { result[index] = await fetchMarketCap(identities[index].providerSymbol, signal); }
      catch { ensureNotAborted(signal); /* A single failed provider row does not discard the rest of the batch. */ }
    }
  }));
  return result;
}

export async function scanSmallCapUniverse(options: SmallCapScanOptions = {}, dependencies: SmallCapScanDependencies = {}): Promise<SmallCapScanResponse> {
  ensureNotAborted(options.signal);
  const exchange = options.exchange || 'all';
  const catalog = dependencies.catalog ? normalizeSmallCapCatalog(dependencies.catalog) : loadSmallCapCatalog();
  const catalogRevision = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  const now = dependencies.now ?? Date.now();
  const selected = exchange === 'all' ? catalog : catalog.filter(row => row.exchange === exchange);
  const requestedOffset = Number.isSafeInteger(options.offset) && options.offset! >= 0 ? options.offset! : 0;
  const offset = Math.min(requestedOffset, selected.length);
  const requestedLimit = Number.isSafeInteger(options.limit) && options.limit! > 0 ? options.limit! : SMALL_CAP_BATCH_LIMIT;
  const limit = Math.min(requestedLimit, SMALL_CAP_BATCH_LIMIT);
  const response: SmallCapScanResponse = {
    exchange, stocks: [],
    counts: { totalCatalog: catalog.length, totalForExchange: selected.length, scanned: 0, quotesUnavailable: 0, staleQuotes: 0,
      unknownMarketCaps: 0, notSmallCap: 0, smallCaps: 0, insufficientHistory: 0 },
    offset, limit, nextOffset: selected.length ? 0 : null, complete: selected.length === 0,
    catalogOnly: Boolean(options.catalogOnly), fetchedAt: new Date(now).toISOString(),
    catalogRevision,
    ...(!dependencies.catalog ? { catalogSource: savedCatalogSource } : {}),
  };
  if (!dependencies.catalog && exchange === 'BSE') response.errors = ['An official BSE identity source is unavailable. This scanner currently covers the official NSE equity-list snapshot.'];
  if (options.catalogOnly) return response;
  const batch = selected.slice(offset, offset + limit);
  response.counts.scanned = batch.length;
  response.nextOffset = offset + batch.length < selected.length ? offset + batch.length : null;
  response.complete = response.nextOffset === null;
  if (batch.length === 0) return response;

  // Existing chart requests have a bounded eight-worker pool. Metadata uses four workers and a shared six-second request deadline.
  const [quotes, metadata] = await Promise.all([
    (dependencies.fetchQuotes || fetchStockQuotes)(batch.map(row => row.providerSymbol)).catch(() => {
      response.errors = ['Quote provider unavailable for this batch.'];
      return batch.map(() => null);
    }),
    metadataForBatch(batch, dependencies.fetchMarketCap || fetchProviderMarketCap, options.signal),
  ]);
  ensureNotAborted(options.signal);
  for (let index = 0; index < batch.length; index++) {
    const identity = batch[index];
    const quote = quotes[index];
    if (!quote || !isProviderStock(quote, now) || quote.providerSymbol !== identity.providerSymbol) {
      response.counts.quotesUnavailable++;
      continue;
    }
    if (now - Date.parse(quote.quoteAsOf!) > SMALL_CAP_MAX_QUOTE_AGE_MS) {
      response.counts.staleQuotes++;
      continue;
    }
    const cap = metadata[index];
    if (!cap || !Number.isFinite(cap.marketCap) || cap.marketCap <= 0) {
      response.counts.unknownMarketCaps++;
      continue;
    }
    if (cap.marketCap >= 20_000) {
      response.counts.notSmallCap++;
      continue;
    }
    const coverage = historicalVolumeCoverage(quote);
    if (!coverage.historyCoverage.sufficient) response.counts.insufficientHistory++;
    const currentPrice = quote.currentPrice ?? (quote as { price?: number }).price ?? 0;
    const optionsOverlay = await fetchOptionsOverlay(identity.providerSymbol);
    const scored = scoreSmallCapCandidate({
      ticker: identity.providerSymbol,
      name: quote.name || identity.name,
      marketCap: cap.marketCap,
      changePercent: quote.changePercent,
      volume: quote.volume,
      averageVolume: coverage.averageVolume,
      currentPrice,
      previousClose: typeof quote.change === 'number' ? currentPrice - quote.change : currentPrice,
      turnover: (quote.volume || 0) * currentPrice,
      circuitLimit: 20,
      isT2T: identity.isT2T,
      optionsPcr: optionsOverlay.pcr ?? undefined,
      isShortSqueezeSetup: optionsOverlay.isSqueezeSetup,
    });

    const targetPrice = currentPrice > 0 ? Number((currentPrice * 1.035).toFixed(2)) : undefined;
    const stopLossPrice = currentPrice > 0 ? Number((currentPrice * 0.98).toFixed(2)) : undefined;

    response.stocks.push({
      ...quote, ...cap, ...coverage,
      price: currentPrice,
      providerSymbol: identity.providerSymbol, currency: 'INR', quoteAsOf: quote.quoteAsOf!, fetchedAt: quote.fetchedAt!,
      dataSource: 'provider', exchange: identity.exchange, name: quote.name || identity.name,
      ...(identity.series ? { series: identity.series, isT2T: identity.isT2T } : {}),
      score: scored.score,
      convictionScore: scored.score,
      isEligibleFor2Pct: scored.isEligibleFor2Pct,
      isHighConviction: scored.isHighConviction,
      confidence: scored.confidence,
      riskLevel: scored.riskLevel,
      turnoverLakhs: scored.turnoverLakhs,
      circuitHeadroomPercent: scored.circuitHeadroomPercent,
      circuitHeadroomPct: scored.circuitHeadroomPercent,
      isCircuitLocked: scored.isCircuitLocked,
      lowerCircuitHeadroomPercent: scored.lowerCircuitHeadroomPercent,
      isLowerCircuitLocked: scored.isLowerCircuitLocked,
      asmGsmStage: identity.series && ['BE', 'BZ'].includes(identity.series) ? 'T2T/Surveillance' : null,
      rewardRiskRatio: 1.75,
      targetPrice,
      stopLossPrice,
      signals: scored.signals,
      optionsPcr: scored.optionsPcr,
      isShortSqueezeSetup: scored.isShortSqueezeSetup,
      optionsSignal: scored.optionsSignal,
      pillarScores: scored.scorePillars ? {
        trend: scored.scorePillars.trend,
        volume: scored.scorePillars.volume,
        relativeStrength: scored.scorePillars.relativeStrength,
        riskPenalty: scored.scorePillars.riskPenalty,
      } : undefined,
      hasEarningsRisk: scored.hasEarningsRisk,
      daysToEarnings: scored.daysToEarnings,
      earningsSurprise: scored.earningsSurprise,
      newsSentiment: scored.newsSentiment,
    });
    response.counts.smallCaps++;
  }
  response.fetchedAt = new Date(dependencies.now ?? Date.now()).toISOString();
  return response;
}
