import { NextRequest, NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { fetchFrameworkFinancials } from '../../../../lib/framework-financial-service';
import { normalizeCompanyProfile } from '../../../../lib/company-profile';
import { assessCompanyHold } from '../../../../lib/company-hold';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get('ticker') ?? '').replace(/\.NS$/, '');
  if (!/^[A-Z0-9&_-]{1,30}$/.test(ticker)) return NextResponse.json({ error: 'Invalid NSE ticker.' }, { status: 400 });
  try {
    const [financials, summary] = await Promise.all([
      fetchFrameworkFinancials(ticker),
      yahoo.quoteSummary(`${ticker}.NS`, { modules: ['price', 'assetProfile'] }, { fetchOptions: { signal: AbortSignal.timeout(6000) } }).catch(() => null),
    ]);
    const profile = normalizeCompanyProfile(summary?.price?.symbol === `${ticker}.NS` && summary.price.currency === 'INR' ? summary : null);
    return NextResponse.json({ profile, financials, assessment: assessCompanyHold(financials, !!profile.description) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Company evidence is unavailable. A longer hold cannot be assessed.' }, { status: 503 });
  }
}
