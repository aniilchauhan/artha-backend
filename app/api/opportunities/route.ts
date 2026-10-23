import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot, snapshotMetadata } from '../../../lib/backend-snapshots';
import type { OpportunitiesSnapshotData } from '../../../lib/backend-opportunities';
import type { OpportunitiesResponse } from '../../../lib/opportunity-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const horizon = request.nextUrl.searchParams.get('horizon') || 'next';
  if (horizon !== 'today' && horizon !== 'next') {
    return NextResponse.json({ error: 'Horizon must be today or next.' }, { status: 400 });
  }

  const universe = request.nextUrl.searchParams.get('universe') || 'curated';

  try {
    const snapshot = await readSnapshot<OpportunitiesSnapshotData>('opportunities');
    const selected = universe === 'full'
      ? snapshot.data.full
      : (horizon === 'today' ? snapshot.data.today : snapshot.data.next);

    let data = selected.data || [];
    const search = (request.nextUrl.searchParams.get('search') || '').trim().toLowerCase();
    if (search) {
      data = data.filter(d =>
        d.ticker.toLowerCase().includes(search) ||
        d.name.toLowerCase().includes(search)
      );
    }

    const limitParam = request.nextUrl.searchParams.get('limit');
    if (limitParam) {
      const limit = Math.max(1, Math.min(100, parseInt(limitParam, 10) || 40));
      data = data.slice(0, limit);
    }

    const result: OpportunitiesResponse & { snapshot?: any; universe?: string } = {
      success: true,
      horizon,
      universe,
      fetchedAt: snapshot.generatedAt,
      source: horizon === 'next'
        ? 'Axion Dual-Direction Engine (Long Breakouts + Short/PE Breakdowns)'
        : 'Yahoo Finance 500-stock current-session scan with live Option & Leverage overlays',
      explanation: horizon === 'next'
        ? 'Estimates reflect calibrated win probabilities and breakdown conviction. Each setup includes 1x Cash, 5x MIS Intraday, and Supercharged ATM Options (CE/PE) leverage specifications.'
        : 'Intraday momentum discovery evaluated across the entire 500-stock universe. Target = displayed quote × 1.02, equipped with 1x Cash, 5x MIS, and Options contract overlays.',
      coverage: horizon === 'next'
        ? `${data.length} calibrated two-way setups evaluated across Nifty 500 stocks (Long Breakouts & Bearish Puts).`
        : `${data.length} stocks evaluated across the 500-stock universe.`,
      scanCoverage: selected.scanCoverage,
      quoteAgeSummary: selected.quoteAgeSummary,
      data,
      snapshot: await snapshotMetadata(snapshot),
    };

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { error: 'No published opportunities scan. The backend worker must complete an update.' },
      { status: 503 }
    );
  }
}
