import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth-guard';
import { guardAiRequest } from '../../../../lib/ai-request-guard';
import { defaultHistoryRange, getForwardHistory, reconcileForwardHistory } from '../../../../lib/forward-history-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

function range(request: NextRequest) {
  const defaults = defaultHistoryRange();
  const from = request.nextUrl.searchParams.get('from') || defaults.from;
  const to = request.nextUrl.searchParams.get('to') || defaults.to;
  const rawPage = request.nextUrl.searchParams.get('page') || '1';
  const valid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
  if (!valid(from) || !valid(to) || from > to || !/^\d+$/.test(rawPage) || Number(rawPage) < 1 || Number(rawPage) > 10000) return null;
  return { from, to, page: Number(rawPage) };
}

async function respond(request: NextRequest, reconcile: boolean) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  const dates = range(request);
  if (!dates) return NextResponse.json({ error: 'Use valid from/to dates and a positive page number.' }, { status: 400 });
  try {
    const owner = auth.session.user.email.toLowerCase();
    const reconciliation = reconcile ? await reconcileForwardHistory(owner) : undefined;
    return NextResponse.json({ success: true, data: await getForwardHistory(owner, dates.from, dates.to, dates.page), reconciliation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Prediction history is unavailable. Check the database connection.' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) { return respond(request, false); }
export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  return respond(request, true);
}
