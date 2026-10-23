import { NextRequest, NextResponse } from 'next/server';
import { fetchStockQuote, stockSymbol } from '../../../../lib/stock-fetcher';
import { fetchProviderMarketCap } from '../../../../lib/small-cap-universe';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker');
  if (!ticker) return NextResponse.json({ success: false, error: 'Ticker is required' }, { status: 400 });
  const stock = await fetchStockQuote(ticker);
  if (!stock) return NextResponse.json({ success: false, source: 'unavailable', error: 'A timestamped provider quote is unavailable. No simulated price has been substituted.' }, { status: 503 });

  if (!stock.marketCap || stock.marketCap <= 0) {
    const symbol = stockSymbol(ticker);
    if (symbol) {
      try {
        const cap = await fetchProviderMarketCap(symbol);
        if (cap && cap.marketCap > 0) {
          stock.marketCap = cap.marketCap;
        }
      } catch {
        // Non-fatal if market cap metadata lookup fails
      }
    }
  }

  return NextResponse.json({ success: true, source: 'yahoo-finance', data: stock, stock, competitors: [] });
}
