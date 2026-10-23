import { NextResponse } from 'next/server';
import { getDataHealthSummary } from '../../../lib/observation-pipeline';

export const dynamic = 'force-dynamic';

export async function GET() {
  const summary = getDataHealthSummary();
  if (!summary) {
    return NextResponse.json(
      { success: false, error: 'Data health telemetry is unavailable: no provider-backed scan has been recorded in this process.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ success: true, data: summary }, { headers: { 'Cache-Control': 'no-store' } });
}
