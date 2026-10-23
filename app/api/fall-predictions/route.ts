import { NextRequest, NextResponse } from 'next/server';
import { getLatestBreakdowns } from '../../../lib/stock-ai-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const minConviction = parseFloat(searchParams.get('minConviction') || '0');
    const search = (searchParams.get('search') || '').trim().toUpperCase();

    let breakdowns = getLatestBreakdowns();

    if (search) {
      breakdowns = breakdowns.filter(b => b.ticker.toUpperCase().includes(search));
    }

    if (minConviction > 0) {
      breakdowns = breakdowns.filter(b => b.conviction >= minConviction);
    }

    // Calculate aggregated fall metrics
    const count = breakdowns.length;
    const avgTargetDropPct = count > 0
      ? breakdowns.reduce((acc, b) => {
          const drop = ((b.entry_price - b.target_price) / b.entry_price) * 100;
          return acc + drop;
        }, 0) / count
      : 3.2;

    const avgRewardRisk = count > 0
      ? breakdowns.reduce((acc, b) => acc + (b.reward_risk_ratio || 1.0), 0) / count
      : 1.2;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count,
      stats: {
        avgTargetDropPct: Number(avgTargetDropPct.toFixed(2)),
        avgRewardRisk: Number(avgRewardRisk.toFixed(2)),
        highConvictionCount: breakdowns.filter(b => b.conviction >= 0.85).length,
      },
      data: breakdowns,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load 2-5% fall predictions' },
      { status: 500 }
    );
  }
}
