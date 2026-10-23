import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRequestOrigin } from '../../../../../lib/auth-guard';
import { guardAiRequest } from '../../../../../lib/ai-request-guard';
import { researchOwnerId } from '../../../../../lib/research-history-service';
import { getHorizonHistory } from '../../../../../lib/horizon-history';
import { indiaDate } from '../../../../../lib/opportunity-analysis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

async function respond(request: NextRequest, reconcile: boolean) {
  if (reconcile && !verifyRequestOrigin(request)) return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 });
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const today = indiaDate(new Date());
  const defaults = { from: indiaDate(new Date(Date.now() - 29 * 86400000)), to: today };
  const from = request.nextUrl.searchParams.get('from') || defaults.from;
  const to = request.nextUrl.searchParams.get('to') || defaults.to;
  const pageText = request.nextUrl.searchParams.get('page') || '1';
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!validDay(from) || !validDay(to) || from > to || to > today || !/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 10000) {
    return NextResponse.json({ success: false, error: 'Use a valid date range through today and a positive page number.' }, { status: 400 });
  }
  try {
    const owner = researchOwnerId(auth.session.user);
    return NextResponse.json({ success: true, data: await getHorizonHistory(owner, from, to, Number(pageText), reconcile) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ success: false, error: 'Horizon outcome history is unavailable. Check the database connection.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) { return respond(request, false); }
export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  return respond(request, true);
}
