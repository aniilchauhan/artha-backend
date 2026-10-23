import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth-guard';
import { readSavedOllamaReview } from '../../../../lib/backend-ollama-evidence';
import { PredictionAiError } from '../../../../lib/prediction-ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.authenticated) return auth.response;
  try {
    const data = await readSavedOllamaReview(request.nextUrl.searchParams.get('ticker'));
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid review ticker.' }, { status: error instanceof PredictionAiError ? error.status : 400 });
  }
}
