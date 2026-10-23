import fs from 'fs';
import path from 'path';
import { getAxionProjectRoot } from './project-root';
import { INITIAL_STOCKS } from './stock-data';

export function catalogStock(stock: any) {
  return {
    ticker: stock.ticker,
    symbol: stock.symbol || stock.ticker?.replace(/\.(NS|BO)$/, ''),
    name: stock.name || stock.symbol,
    sector: stock.sector || 'Diversified',
    exchange: stock.exchange || (stock.ticker?.endsWith('.BO') ? 'BSE' : 'NSE'),
    indices: stock.indices || [],
    sparkline: stock.sparkline || [],
    price: null,
    currentPrice: null,
    closePrice: null,
    previousClose: null,
    change: null,
    changePercent: null,
    high: null,
    low: null,
    volume: null,
    marketCap: null,
    quoteAsOf: null,
    fetchedAt: null,
    dataSource: 'unavailable',
    quoteStatus: 'unavailable',
    isFallback: true,
  };
}

export interface CachedCatalogState {
  filePath: string;
  mtimeMs: number;
  stocks: any[];
  sectorFacets: Record<string, number>;
  indexFacets: Record<string, number>;
}

let memoryCatalogCache: CachedCatalogState | null = null;

export function _resetCatalogCacheForTesting() {
  memoryCatalogCache = null;
}

export function getCachedCatalog(customFs?: any): CachedCatalogState {
  const fileSystem = customFs || fs;
  const root = getAxionProjectRoot();
  const file5055 = path.join(root, 'data', 'all_indian_stocks_5055.json');
  const fileNse = path.join(root, 'data', 'all_nse_stocks.json');

  let targetFile = file5055;
  try {
    if (typeof fileSystem.existsSync === 'function') {
      targetFile = fileSystem.existsSync(file5055) ? file5055 : fileSystem.existsSync(fileNse) ? fileNse : file5055;
    }
  } catch {
    targetFile = file5055;
  }

  try {
    let stats: fs.Stats | null = null;
    try {
      if (typeof fileSystem.statSync === 'function') {
        stats = fileSystem.statSync(targetFile);
      }
    } catch {
      stats = null;
    }

    if (stats && memoryCatalogCache && memoryCatalogCache.filePath === targetFile && memoryCatalogCache.mtimeMs === stats.mtimeMs) {
      return memoryCatalogCache;
    }

    let fileContent = '';
    try {
      fileContent = fileSystem.readFileSync(targetFile, 'utf8');
    } catch {
      fileContent = fileSystem.readFileSync(fileNse, 'utf8');
    }
    const parsed = JSON.parse(fileContent);
    const stocks = parsed.map(catalogStock);

    const sectorFacets: Record<string, number> = {};
    const indexFacets: Record<string, number> = {};
    for (const s of stocks) {
      if (s.sector) sectorFacets[s.sector] = (sectorFacets[s.sector] || 0) + 1;
      if (Array.isArray(s.indices)) {
        for (const idx of s.indices) {
          indexFacets[idx] = (indexFacets[idx] || 0) + 1;
        }
      }
    }

    memoryCatalogCache = {
      filePath: targetFile,
      mtimeMs: stats?.mtimeMs || 1,
      stocks,
      sectorFacets,
      indexFacets,
    };
    return memoryCatalogCache;
  } catch {
    const stocks = INITIAL_STOCKS.map(catalogStock);
    return { filePath: '', mtimeMs: 0, stocks, sectorFacets: {}, indexFacets: {} };
  }
}
