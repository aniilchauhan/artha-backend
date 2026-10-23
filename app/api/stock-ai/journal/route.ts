import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth-guard';
import { guardAiRequest } from '../../../../lib/ai-request-guard';
import { getPredictionJournal, reconcilePredictionJournal } from '../../../../lib/prediction-journal-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

const failure = () => NextResponse.json({ success: false,
  error: 'Prediction journal is unavailable. Check the database connection and try again.' }, { status: 503 });

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  try {
    return NextResponse.json({ success: true, data: await getPredictionJournal() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return failure(); }
}

export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  try {
    const reconciliation = await reconcilePredictionJournal();
    return NextResponse.json({ success: true, reconciliation, data: await getPredictionJournal() },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch { return failure(); }
}
