import { NextRequest, NextResponse } from 'next/server';
import { fetchStockQuote, stockSymbol } from '../../../../lib/stock-fetcher';
import { normalizeCompanyProfile } from '../../../../lib/company-profile';

const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker');
  if (!ticker || !stockSymbol(ticker)) return NextResponse.json({ success: false, error: 'A valid ticker is required.' }, { status: 400 });
  try {
    const quote = await fetchStockQuote(ticker);
    if (!quote) return NextResponse.json({ success: false, source: 'unavailable', error: 'Provider company data is unavailable. No generated profile has been substituted.' }, { status: 503 });
    let summary = null;
    try {
      summary = await yf.quoteSummary(quote.providerSymbol, { modules: ['assetProfile'] });
    } catch { /* A quote does not establish company fundamentals. */ }
    return NextResponse.json({ success: true, source: 'yahoo-finance', profile: {
      ticker: quote.ticker, name: quote.name, providerSymbol: quote.providerSymbol,
      fetchedAt: new Date().toISOString(), profileAsOf: null,
      ...normalizeCompanyProfile(summary),
      limitation: 'Company information is a provider observation; its reporting date is unavailable. Shareholding, valuation and other unsupported fields are not supplied.',
    } });
  } catch {
    return NextResponse.json({ success: false, source: 'unavailable', error: 'Company data could not be retrieved.' }, { status: 503 });
  }
}
