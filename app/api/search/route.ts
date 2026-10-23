import { getAxionProjectRoot } from '../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

interface LocalStock {
  ticker?: string;
  symbol?: string;
  name?: string;
  exchange?: string;
}

let cachedUniverse: LocalStock[] | null = null;

function getUniverse(): LocalStock[] {
  if (cachedUniverse) return cachedUniverse;

  try {
    const jsonPath = path.join(getAxionProjectRoot(), 'data', 'all_indian_stocks_5055.json');
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        cachedUniverse = data;
        return cachedUniverse;
      }
    }
  } catch (err) {
    console.error('[Search API] Failed reading all_indian_stocks_5055.json:', err);
  }

  try {
    const nsePath = path.join(getAxionProjectRoot(), 'data', 'all_nse_stocks.json');
    if (fs.existsSync(nsePath)) {
      const data = JSON.parse(fs.readFileSync(nsePath, 'utf8'));
      if (Array.isArray(data)) {
        cachedUniverse = data;
        return cachedUniverse;
      }
    }
  } catch (err) {
    console.error('[Search API] Failed reading all_nse_stocks.json:', err);
  }

  return [];
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q');
  
  if (!query || query.trim().length < 1) {
    return NextResponse.json({ quotes: [] });
  }

  const cleanQuery = query.trim().toLowerCase();
  const seenSymbols = new Set<string>();
  const results: Array<{
    symbol: string;
    shortname: string;
    exchDisp: string;
    typeDisp: string;
  }> = [];

  // 1. Fast local catalog search across our 5,055 Indian stock universe
  try {
    const universe = getUniverse();
    const exactMatches: typeof results = [];
    const prefixMatches: typeof results = [];
    const namePrefixMatches: typeof results = [];
    const containsMatches: typeof results = [];

    for (const stock of universe) {
      const sym = (stock.symbol || '').toLowerCase();
      const name = (stock.name || '').toLowerCase();
      const rawTicker = stock.ticker || (stock.symbol ? `${stock.symbol}.NS` : '');
      const cleanSym = (stock.symbol || rawTicker.replace(/\.(NS|BO)$/i, '')).toUpperCase();
      const tickerKey = rawTicker.toUpperCase();

      if (!rawTicker || !cleanSym) continue;

      const item = {
        symbol: rawTicker,
        shortname: stock.name || cleanSym,
        exchDisp: stock.exchange || 'NSE',
        typeDisp: 'Equity'
      };

      if (sym === cleanQuery || cleanSym.toLowerCase() === cleanQuery) {
        exactMatches.push(item);
      } else if (sym.startsWith(cleanQuery)) {
        prefixMatches.push(item);
      } else if (name.startsWith(cleanQuery)) {
        namePrefixMatches.push(item);
      } else if (name.includes(cleanQuery) || sym.includes(cleanQuery)) {
        containsMatches.push(item);
      }
    }

    const sortedLocal = [...exactMatches, ...prefixMatches, ...namePrefixMatches, ...containsMatches];
    for (const item of sortedLocal) {
      const baseKey = item.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
      if (!seenSymbols.has(baseKey)) {
        seenSymbols.add(baseKey);
        results.push(item);
      }
      if (results.length >= 10) break;
    }
  } catch (err) {
    console.error('[Search API Local Search Error]', err);
  }

  // 2. Concurrently query Yahoo Finance with a 2.5s timeout to supplement with global / live quotes
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const yahooRes = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json'
        }
      }
    ).catch(() => null);

    clearTimeout(timeoutId);

    if (yahooRes && yahooRes.ok) {
      const data = await yahooRes.json();
      const yahooQuotes = (data.quotes || [])
        .filter((q: any) => ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(q.quoteType))
        .map((q: any) => ({
          symbol: q.symbol,
          shortname: q.shortname || q.longname || q.symbol,
          exchDisp: q.exchDisp || q.exchange,
          typeDisp: q.typeDisp || q.quoteType
        }));

      for (const yq of yahooQuotes) {
        const baseKey = (yq.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
        if (!seenSymbols.has(baseKey)) {
          seenSymbols.add(baseKey);
          results.push(yq);
        }
        if (results.length >= 12) break;
      }
    }
  } catch (error) {
    // Yahoo timeout or network error is non-fatal; we already have local results
  }

  return NextResponse.json({ quotes: results });
}
