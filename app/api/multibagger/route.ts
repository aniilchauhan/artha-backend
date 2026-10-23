import { NextRequest, NextResponse } from 'next/server';
import { getMultiBaggerCandidates } from '../../../lib/multibagger-engine';

export const dynamic = 'force-dynamic';

let cachedResponse: any = null;
let cacheTime = 0;
let pendingPromise: Promise<any> | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60s cache

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sector = searchParams.get('sector') || 'All';
    const conviction = searchParams.get('conviction') || 'All';
    const marketCap = searchParams.get('marketCap') || 'All';
    const minScoreStr = searchParams.get('minScore');
    const minScore = minScoreStr ? parseInt(minScoreStr, 10) : 0;
    const forceRefresh = searchParams.get('refresh') === 'true';

    const now = Date.now();
    let baseResponse = cachedResponse;

    if (forceRefresh || !baseResponse || (now - cacheTime > CACHE_TTL_MS)) {
      if (!pendingPromise || forceRefresh) {
        pendingPromise = getMultiBaggerCandidates()
          .then(res => {
            cachedResponse = res;
            cacheTime = Date.now();
            return res;
          })
          .finally(() => {
            pendingPromise = null;
          });
      }
      baseResponse = await pendingPromise;
    }

    // Apply filters on the fast, cached base response
    let list = [...(baseResponse.data || [])];
    if (sector !== 'All') {
      list = list.filter((c: any) => c.sector.toLowerCase().includes(sector.toLowerCase()));
    }
    if (conviction !== 'All') {
      list = list.filter((c: any) => c.convictionTier === conviction);
    }
    if (marketCap !== 'All') {
      list = list.filter((c: any) => c.marketCapCategory === marketCap);
    }
    if (minScore > 0) {
      list = list.filter((c: any) => c.multiBaggerScore >= minScore);
    }

    const avgScore = list.length > 0
      ? Math.round(list.reduce((acc: number, c: any) => acc + c.multiBaggerScore, 0) / list.length)
      : 0;

    return NextResponse.json({
      ...baseResponse,
      count: list.length,
      marketContext: {
        ...baseResponse.marketContext,
        averageScore: avgScore,
      },
      data: list,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('[MultiBagger API Error]:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to generate multi-bagger predictions' },
      { status: 500 }
    );
  }
}
