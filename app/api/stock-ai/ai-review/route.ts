import { NextRequest, NextResponse } from 'next/server';
import { guardAiRequest } from '../../../../lib/ai-request-guard';
import { PredictionAiError } from '../../../../lib/prediction-ai';
import { getPredictionAiAssessment } from '../../../../lib/prediction-ai-service';
import { recordPredictionAssessment } from '../../../../lib/prediction-journal-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 150;

export async function POST(request: NextRequest) {
  const denied = await guardAiRequest(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ success: false, error: 'Request is too large.' }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return NextResponse.json({ success: false, error: 'A JSON ticker request is required.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'ticker')) {
      return NextResponse.json({ success: false, error: 'Send only a ticker. Market evidence is fetched by the server.' }, { status: 400 });
    }
    const data = await getPredictionAiAssessment((body as { ticker?: unknown }).ticker);
    const journal = await recordPredictionAssessment(data);
    return NextResponse.json({ success: true, data: { ...data, journal }, journal }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false,
      error: error instanceof PredictionAiError ? error.message : 'Prediction analysis failed. Please try again.' },
    { status: error instanceof PredictionAiError ? error.status : 500 });
  }
}
