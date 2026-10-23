import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot, snapshotMetadata } from '../../../lib/backend-snapshots';
import type { SwingSnapshotData } from '../../../lib/backend-swing';
import type { SwingOpportunitiesResponse } from '../../../lib/swing-opportunity-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const horizonParam = request.nextUrl.searchParams.get('horizon') || '20';
    const horizon = parseInt(horizonParam, 10);
    const statusFilter = request.nextUrl.searchParams.get('status') || 'all';
    const tradabilityFilter = request.nextUrl.searchParams.get('tradability') || 'all';
    const expectancyFilter = request.nextUrl.searchParams.get('expectancy') || 'all';
    const minProb = parseFloat(request.nextUrl.searchParams.get('minProb') || '0');

    let snapshotData: SwingSnapshotData;
    let generatedAt = new Date().toISOString();
    let metaSnapshot: any = null;

    try {
      const snapshot = await readSnapshot<SwingSnapshotData>('swing-opportunities');
      snapshotData = snapshot.data;
      generatedAt = snapshot.generatedAt;
      metaSnapshot = await snapshotMetadata(snapshot);
    } catch {
      // Dynamic fallback if snapshot worker hasn't published yet
      const { calculateSwingOpportunities } = await import('../../../lib/backend-swing');
      const calculated = await calculateSwingOpportunities();
      snapshotData = calculated.data;
    }

    const { opportunities, portfolioMetrics, scanCoverage } = snapshotData;

    let filtered = opportunities;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(opp => opp.status === statusFilter);
    }
    if (tradabilityFilter === 'liquid_only') {
      filtered = filtered.filter(opp => opp.liquidityAudit?.isLiquid);
    } else if (tradabilityFilter === 'warnings_only') {
      filtered = filtered.filter(opp => (opp.liquidityAudit?.warnings?.length ?? 0) > 0);
    }
    if (minProb > 0) {
      filtered = filtered.filter(opp => (opp.targetProbability ?? 0) >= minProb);
    }
    if (expectancyFilter === 'positive') {
      filtered = filtered.filter(opp => (opp.expectedNetReturnPct ?? 0) > 0);
    }

    // Rank highest mathematical expected return and liquid setups first
    filtered.sort((a, b) => {
      const retA = a.expectedNetReturnPct ?? 0;
      const retB = b.expectedNetReturnPct ?? 0;
      if (retB !== retA) return retB - retA;
      return (b.targetProbability ?? 0) - (a.targetProbability ?? 0);
    });

    const responsePayload: SwingOpportunitiesResponse & { snapshot?: any } = {
      data: filtered,
      portfolioMetrics,
      horizon,
      source: 'Axion Multi-Session Swing Engine (LightGBM + Isotonic Calibration)',
      explanation:
        'Identifies liquid NSE cash equities poised for a +10% move from a confirmed breakout entry before hitting an invalidation stop within 20 trading sessions. Net returns deduct 0.15% roundtrip friction.',
      fetchedAt: generatedAt,
      count: filtered.length,
      scanCoverage: {
        ...scanCoverage,
        breakoutSetupsActive: filtered.length,
      },
      ...(metaSnapshot ? { snapshot: metaSnapshot } : {}),
    };

    return NextResponse.json(responsePayload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error retrieving swing opportunities.' },
      { status: 500 }
    );
  }
}
