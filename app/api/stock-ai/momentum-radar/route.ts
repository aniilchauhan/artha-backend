import { NextRequest, NextResponse } from 'next/server';
import {
  evaluateMomentumRadar,
  getLatestMomentumRadarSnapshot,
} from '../../../../lib/momentum-radar-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const snapshot = await getLatestMomentumRadarSnapshot();
    return NextResponse.json({
      success: true,
      data: snapshot,
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Failed to retrieve momentum radar snapshot.',
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const snapshot = await evaluateMomentumRadar();

    return NextResponse.json({
      success: true,
      data: snapshot,
      triggeredAction: body?.action || 'cycle_evaluation',
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err?.message || 'Failed to execute momentum radar evaluation.',
    }, { status: 500 });
  }
}
