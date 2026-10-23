import isinData from '../data/isin_symbol_map.json';

export interface ResolvedStock {
  symbol: string;
  name: string;
  matchSource: 'isin' | 'symbol' | 'name' | 'alias';
  isin?: string;
}

interface MasterData {
  isinMap: Record<string, { symbol: string; name: string }>;
  nameMap: Record<string, string>;
  symbolMap: Record<string, { symbol: string; name: string }>;
}

const data = isinData as MasterData;

export function cleanCompanyName(str: string): string {
  if (!str) return '';
  return str.toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(LIMITED|LTD|PRIVATE|PVT|CORP|CORPORATION|INDIA|HOLDINGS)$/g, '');
}

export function cleanSymbol(str: string): string {
  if (!str) return '';
  return str.toUpperCase()
    .replace(/\.NS$/, '')
    .replace(/\.BO$/, '')
    .replace(/[^A-Z0-9_-]/g, '')
    .trim();
}

/**
 * Resolves any combination of ISIN, ticker symbol, or company name to the official NSE symbol.
 * Prevents creation of temporary mangled tickers like RELIANCE_INDUSTRIES_LTD.
 */
export function resolveStockIdentity(query: {
  isin?: string;
  symbol?: string;
  name?: string;
}): ResolvedStock | null {
  // 1. ISIN match (highest accuracy)
  if (query.isin) {
    const cleanIsin = query.isin.trim().toUpperCase();
    if (data.isinMap[cleanIsin]) {
      return {
        symbol: data.isinMap[cleanIsin].symbol,
        name: data.isinMap[cleanIsin].name,
        matchSource: 'isin',
        isin: cleanIsin,
      };
    }
  }

  // 2. Exact Symbol match
  if (query.symbol) {
    const sym = cleanSymbol(query.symbol);
    if (data.symbolMap[sym]) {
      return {
        symbol: sym,
        name: data.symbolMap[sym].name,
        matchSource: 'symbol',
      };
    }
  }

  // 3. Name match via cleaned name map
  const rawName = query.name || query.symbol || '';
  if (rawName) {
    const cleaned = cleanCompanyName(rawName);
    if (cleaned && data.nameMap[cleaned]) {
      const sym = data.nameMap[cleaned];
      return {
        symbol: sym,
        name: data.symbolMap[sym]?.name || rawName.trim(),
        matchSource: 'name',
      };
    }
  }

  // 4. Fallback: if it's already a clean uppercase symbol (1-15 chars without spaces)
  if (query.symbol) {
    const sym = cleanSymbol(query.symbol);
    if (sym && /^[A-Z0-9]{2,15}$/.test(sym)) {
      return {
        symbol: sym,
        name: query.name?.trim() || sym,
        matchSource: 'alias',
      };
    }
  }

  return null;
}
