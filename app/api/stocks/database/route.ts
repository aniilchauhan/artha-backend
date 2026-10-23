import { getAxionProjectRoot } from '../../../../lib/project-root';
import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Stock from '../../../../models/Stock';
import { isProviderStock } from '../../../../lib/market-quote';
import { INITIAL_STOCKS } from '../../../../lib/stock-data';
import { fetchStockQuote } from '../../../../lib/stock-fetcher';
import { catalogStock, getCachedCatalog } from '../../../../lib/catalog-cache';
import fs from 'fs';

export const dynamic = 'force-dynamic';


async function refreshCatalogStock(stock: any) {
  const catalog = catalogStock(stock);
  try {
    const quote = await fetchStockQuote(stock.ticker);
    if (quote && isProviderStock(quote)) {
      return {
        ...catalog,
        ...quote,
        ticker: quote.ticker,
        price: quote.currentPrice,
        closePrice: (quote as any).previousClose || quote.currentPrice,
        previousClose: (quote as any).previousClose || quote.currentPrice,
      };
    }
  } catch {
    /* Keep the company visible with its price unavailable. */
  }
  return catalog;
}

/** Bounded batch quote refresher to prevent socket contention and provider 429s (M4-07). */
async function batchRefreshStocks(stocks: any[], maxConcurrent = 6): Promise<any[]> {
  const results: any[] = new Array(stocks.length);
  for (let i = 0; i < stocks.length; i += maxConcurrent) {
    const slice = stocks.slice(i, i + maxConcurrent);
    const resolved = await Promise.all(slice.map(refreshCatalogStock));
    for (let j = 0; j < resolved.length; j++) {
      results[i + j] = resolved[j];
    }
  }
  return results;
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get('search') || '';
  const sector = req.nextUrl.searchParams.get('sector') || 'all';
  const indexFilter = req.nextUrl.searchParams.get('index') || 'all';
  const marketCapFilter = req.nextUrl.searchParams.get('marketCap') || 'all';
  const exchangeFilter = req.nextUrl.searchParams.get('exchange') || 'all';
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)));
  const sortBy = req.nextUrl.searchParams.get('sortBy') || 'marketCap';
  const sortOrder = req.nextUrl.searchParams.get('sortOrder') || 'desc';
  const shouldRefresh = req.nextUrl.searchParams.get('refresh') !== 'false' && req.nextUrl.searchParams.get('catalogOnly') !== 'true';

  try {
    try {
      await connectToDatabase();
    } catch (dbErr: any) {
      // Offline / File-based catalog mode with in-memory caching (M4-05)
      const cached = getCachedCatalog(fs);
      let fallbackStocks = [...cached.stocks];

      // Filter search
      if (search.trim()) {
        const q = search.toLowerCase();
        fallbackStocks = fallbackStocks.filter(s =>
          (s.ticker && s.ticker.toLowerCase().includes(q)) ||
          (s.symbol && s.symbol.toLowerCase().includes(q)) ||
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.sector && s.sector.toLowerCase().includes(q))
        );
      }

      if (sector !== 'all') {
        fallbackStocks = fallbackStocks.filter(s => s.sector === sector);
      }

      if (indexFilter !== 'all') {
        fallbackStocks = fallbackStocks.filter(s => Array.isArray(s.indices) && s.indices.includes(indexFilter));
      }

      if (exchangeFilter !== 'all') {
        fallbackStocks = fallbackStocks.filter(s => {
          if (exchangeFilter === 'NSE') return s.exchange === 'NSE' || s.exchange === 'NSE/BSE';
          if (exchangeFilter === 'BSE') return s.exchange === 'BSE' || s.exchange === 'NSE/BSE';
          return true;
        });
      }

      fallbackStocks.sort((a, b) => {
        let valA: any = a[sortBy as keyof typeof a];
        let valB: any = b[sortBy as keyof typeof b];

        if (sortBy === 'price') {
          valA = a.price;
          valB = b.price;
        } else if (sortBy === 'change') {
          valA = a.changePercent;
          valB = b.changePercent;
        }

        if (valA == null && valB == null) return 0;
        if (valA == null) return 1;
        if (valB == null) return -1;

        if (valA < valB) return sortOrder === 'desc' ? 1 : -1;
        if (valA > valB) return sortOrder === 'desc' ? -1 : 1;
        return 0;
      });

      const total = fallbackStocks.length;
      const paginatedStocks = fallbackStocks.slice((page - 1) * limit, page * limit);
      const liveQuotes = shouldRefresh ? await batchRefreshStocks(paginatedStocks, 6) : paginatedStocks;

      return NextResponse.json({
        success: true,
        total,
        totalUniverse: cached.stocks.length,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stocks: liveQuotes,
        facets: {
          sectors: cached.sectorFacets,
          indices: cached.indexFacets,
        }
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Database mode with projection & lean queries (M4-06)
    const query: any = {};
    if (search.trim()) {
      query.$or = [
        { ticker: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }
    if (sector !== 'all') {
      query.sector = sector;
    }

    const skip = (page - 1) * limit;

    const sortQuery: any = {};
    let dbSortField = sortBy;
    if (sortBy === 'price') dbSortField = 'price';
    if (sortBy === 'change') dbSortField = 'changePercent';

    sortQuery[dbSortField] = sortOrder === 'desc' ? -1 : 1;

    const total = await Stock.countDocuments(query);
    let stockQuery: any = Stock.find(query);
    if (typeof stockQuery?.select === 'function') {
      stockQuery = stockQuery.select('ticker symbol name sector exchange indices price currentPrice change changePercent high low volume marketCap quoteAsOf fetchedAt');
    }
    stockQuery = stockQuery.sort(sortQuery).skip(skip).limit(limit);
    let rawStocks: any[];
    if (typeof stockQuery?.lean === 'function') {
      rawStocks = await stockQuery.lean();
    } else {
      rawStocks = await stockQuery;
    }
    const stocks = (rawStocks || []).map((doc: any) => (typeof doc?.toObject === 'function' ? doc.toObject() : doc));

    return NextResponse.json({
      success: true,
      total,
      totalUniverse: total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      stocks: shouldRefresh ? await batchRefreshStocks(stocks, 6) : stocks
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[Stocks Database API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'Failed to fetch stocks from database'
    }, { status: 500 });
  }
}

