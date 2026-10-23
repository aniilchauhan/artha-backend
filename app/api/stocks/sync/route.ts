import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Stock from '../../../../models/Stock';
import { fetchStocksData } from '../../../../lib/stock-fetcher';
import { requireAdmin, acquireLock, releaseLock, verifyRequestOrigin } from '../../../../lib/auth-guard';
import { rateLimitResponse } from '../../../../lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Method Not Allowed: Database synchronization modifies server state and requires an authenticated POST request with administrator privileges.',
    },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export async function POST(req: NextRequest) {
  // 1. Verify CSRF origin
  if (!verifyRequestOrigin(req)) {
    return NextResponse.json({ success: false, error: 'Invalid request origin' }, { status: 403 });
  }

  // 2. Authorization check: Requires administrator permissions
  const authResult = await requireAdmin(req);
  if (!authResult.authorized) {
    return authResult.response;
  }

  // 3. Concurrency check: prevent overlapping expensive synchronization tasks
  const lockAcquired = await acquireLock('stocks-sync', 120000);
  if (!lockAcquired) {
    return rateLimitResponse({
      retryAfterSeconds: 120,
      message: 'A database synchronization job is already running. Please wait for it to finish.',
      code: 'CONCURRENT_JOB_RUNNING',
    });
  }

  try {
    if (!process.env.MONGODB_URI) {
      return NextResponse.json(
        { success: false, error: 'Database service unavailable (Missing MONGODB_URI)' },
        { status: 503 }
      );
    }

    // 4. Establish database connection
    await connectToDatabase();

    // 5. Fetch stock details
    const body = await req.json().catch(() => ({}));
    const useRealApi = body.mode !== 'mock';
    const tickersToSync = Array.isArray(body.tickers) ? body.tickers : [];

    const stocksData = await fetchStocksData(tickersToSync, useRealApi);

    if (!stocksData || stocksData.length === 0) {
      return NextResponse.json({ success: false, error: 'No stock data retrieved from provider' }, { status: 400 });
    }

    // 6. Prepare bulk operations for Mongo upsert
    const bulkOps = stocksData.map((stock) => ({
      updateOne: {
        filter: { ticker: stock.ticker },
        update: {
          $set: {
            name: stock.name,
            price: stock.currentPrice,
            change: stock.change,
            changePercent: stock.changePercent,
            high: stock.high,
            low: stock.low,
            volume: stock.volume,
            marketCap: stock.marketCap ?? null,
            sector: stock.sector || 'Other',
            isFallback: stock.isFallback ?? false,
            providerSymbol: stock.providerSymbol,
            currency: stock.currency,
            quoteAsOf: stock.quoteAsOf,
            fetchedAt: stock.fetchedAt,
            sessionStart: stock.sessionStart,
            sessionEnd: stock.sessionEnd,
            dataSource: stock.dataSource,
            quoteStatus: stock.quoteStatus,
            lastUpdated: new Date(),
          },
        },
        upsert: true,
      },
    }));

    // 7. Perform performant bulkWrite operation
    const result = await Stock.bulkWrite(bulkOps);

    return NextResponse.json({
      success: true,
      message: 'Stocks synchronized successfully with MongoDB',
      summary: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        totalProcessed: stocksData.length,
      },
      stocks: stocksData.map((s) => ({ ticker: s.ticker, name: s.name, price: s.currentPrice })),
    });
  } catch (error: any) {
    console.error('[Stocks Sync API] Error synchronizing stocks:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to sync stocks to MongoDB',
      },
      { status: 500 }
    );
  } finally {
    await releaseLock('stocks-sync');
  }
}
