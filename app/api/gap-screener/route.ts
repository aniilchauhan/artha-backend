import { NextRequest, NextResponse } from 'next/server';
import {readSnapshot,snapshotMetadata} from '../../../lib/backend-snapshots';
import type {GapScreenSummary,GapItem,GapScanSource} from '../../../lib/gap-types';
import type { GapScreenerResponse } from '../../../lib/gap-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const directionParam = searchParams.get('direction') || 'all';
    const magnitudeParam = searchParams.get('magnitude') || 'all';
    const statusParam = searchParams.get('status') || 'all';
    const setupParam = searchParams.get('setup') || 'all';
    const categoryParam = searchParams.get('category') || 'all';
    const searchQuery = (searchParams.get('search') || '').trim().toLowerCase();
    const limit = Math.min(200, Math.max(10, parseInt(searchParams.get('limit') || '100', 10)));

    const snapshot=await readSnapshot<{summary:GapScreenSummary;items:GapItem[];source?:GapScanSource}>('gap-screener');
    const {summary,items,source}=snapshot.data;
    if (source?.dataSource !== 'provider' || !source.sessionDate || !Number.isFinite(Date.parse(source.quoteAsOf || '')) || !Number.isFinite(Date.parse(source.latestQuoteAsOf || '')) || !source.evaluated || !source.total) {
      throw new Error('Published gap scan predates provider-backed observations.');
    }

    let filtered = items;

    // Filter Direction
    if (directionParam === 'up') {
      filtered = filtered.filter(i => i.direction === 'GAP_UP');
    } else if (directionParam === 'down') {
      filtered = filtered.filter(i => i.direction === 'GAP_DOWN');
    }

    // Filter Magnitude
    if (magnitudeParam === 'extreme') {
      filtered = filtered.filter(i => Math.abs(i.gapPercent) >= 3.0);
    } else if (magnitudeParam === 'moderate') {
      filtered = filtered.filter(i => Math.abs(i.gapPercent) >= 1.0 && Math.abs(i.gapPercent) < 3.0);
    } else if (magnitudeParam === 'mild') {
      filtered = filtered.filter(i => Math.abs(i.gapPercent) < 1.0);
    }

    // Filter Fill Status
    if (statusParam === 'filled') {
      filtered = filtered.filter(i => i.fillStatus === 'FILLED');
    } else if (statusParam === 'unfilled') {
      filtered = filtered.filter(i => i.fillStatus === 'UNFILLED');
    } else if (statusParam === 'partial') {
      filtered = filtered.filter(i => i.fillStatus === 'PARTIALLY_FILLED');
    }

    // Filter Setup Type
    if (setupParam === 'gap_and_go') {
      filtered = filtered.filter(i => i.setupType === 'GAP_AND_GO');
    } else if (setupParam === 'gap_fade') {
      filtered = filtered.filter(i => i.setupType === 'GAP_FADE');
    } else if (setupParam === 'breakaway') {
      filtered = filtered.filter(i => i.setupType === 'BREAKAWAY_GAP');
    }

    // Filter Market Cap Category
    if (categoryParam === 'large') {
      filtered = filtered.filter(i => i.marketCapCategory === 'LARGE_CAP');
    } else if (categoryParam === 'mid') {
      filtered = filtered.filter(i => i.marketCapCategory === 'MID_CAP');
    } else if (categoryParam === 'small') {
      filtered = filtered.filter(i => i.marketCapCategory === 'SMALL_CAP');
    } else if (categoryParam === 'unknown') {
      filtered = filtered.filter(i => i.marketCapCategory === 'UNKNOWN');
    }

    // Search query
    if (searchQuery) {
      filtered = filtered.filter(
        i =>
          i.symbol.toLowerCase().includes(searchQuery) ||
          i.name.toLowerCase().includes(searchQuery) ||
          i.sector.toLowerCase().includes(searchQuery)
      );
    }

    const payload: GapScreenerResponse = {
      success: true,
      timestamp: snapshot.generatedAt,
      summary,
      items: filtered.slice(0, limit),
      source,
    };

    return NextResponse.json({...payload,snapshot:await snapshotMetadata(snapshot)}, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error: any) {
    console.error('Gap screener error:', error);
    return NextResponse.json(
      { success: false, error: 'No published gap scan. The backend worker must complete an update.' },
      { status: 503 }
    );
  }
}
