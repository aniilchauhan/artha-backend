import { getArtifactProvenance } from '../../../../lib/artifact-provenance';
import { NextRequest, NextResponse } from 'next/server';
import { getBacktestSummary } from '../../../../lib/stock-ai-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const provenance = getArtifactProvenance('backtest_summary.json');
    if (provenance.status !== 'verified') {
      return NextResponse.json(
        { success: false, error: 'Backtest artifact is not verified for serving', provenance },
        { status: 503 }
      );
    }
    const summary = getBacktestSummary();
    if (!summary) {
      return NextResponse.json(
        { success: false, error: 'Backtest summary not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      provenance,
      data: summary,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch backtest data' },
      { status: 500 }
    );
  }
}
