import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth-guard';
import { parseResearchRequest, ResearchError } from '../../../../lib/company-research';
import { getResearchHistory, researchOwnerId } from '../../../../lib/research-history-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  try {
    const ownerId = researchOwnerId(auth.session.user);
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some(key => !['ticker', 'cursor'].includes(key))) throw new ResearchError('Send only a ticker and optional history cursor.', 400);
    const { ticker } = parseResearchRequest({ ticker: params.get('ticker') });
    const data = await getResearchHistory(ownerId, ticker, params.get('cursor') ?? undefined);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof ResearchError ? error.message : 'Research history is unavailable. Check the database connection and try again.' },
      { status: error instanceof ResearchError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
